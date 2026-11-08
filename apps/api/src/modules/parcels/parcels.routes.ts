import { isInCongo, parseCongoMobile } from '@zandu/domain';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { withTx, type Db, type Tx } from '../../db/pool.js';
import { addMinutes } from '../../lib/clock.js';
import { publicOrderRef } from '../../lib/crypto.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { claimIdempotency, completeIdempotency } from '../../lib/idempotency.js';
import { actor, currentUser, requireAuth } from '../auth/guards.js';
import { applyOrderEvent, lockOrder, orderViews } from '../orders/orders.service.js';

const IdParam = z.object({ id: z.uuid() });
const Code4 = z.object({ code: z.string().regex(/^\d{4}$/) });

/**
 * Tailles d'envoi (moto) : supplément ajouté au tarif de livraison entre les deux quartiers, et
 * part du supplément qui revient au livreur. Au-delà de « large », c'est un déménagement.
 */
export const PARCEL_SIZES = {
  small: { surcharge: 0, courierExtra: 0 }, // enveloppe, sachet, téléphone (jusqu'à 2 kg)
  medium: { surcharge: 500, courierExtra: 400 }, // carton à chaussures, sac (jusqu'à 10 kg)
  large: { surcharge: 1500, courierExtra: 1200 }, // gros carton tenu sur la moto (jusqu'à 25 kg)
} as const;
export type ParcelSize = keyof typeof PARCEL_SIZES;
const Size = z.enum(Object.keys(PARCEL_SIZES) as [ParcelSize, ...ParcelSize[]]);

const Point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).optional(),
});
const Place = z.object({
  zoneId: z.uuid(),
  landmark: z.string().trim().min(5).max(300),
  phone: z.string().trim().min(6).max(20),
  location: Point.optional(),
});

const ParcelBody = z.object({
  size: Size,
  description: z.string().trim().min(2).max(120),
  pickup: Place.extend({ name: z.string().trim().min(2).max(80) }),
  recipient: Place.extend({ name: z.string().trim().min(2).max(80) }),
});

const roundPoint = (p: z.infer<typeof Point> | undefined) => {
  if (!p) return null;
  if (!isInCongo(p))
    throw new HttpError(422, 'location_out_of_area', 'Le repère sur la carte est hors du Congo');
  return {
    lat: Math.round(p.lat * 1e6) / 1e6,
    lng: Math.round(p.lng * 1e6) / 1e6,
    ...(p.accuracy !== undefined ? { accuracy: Math.round(p.accuracy) } : {}),
  };
};

/** Prix d'un envoi entre deux quartiers : tarif de livraison à domicile + supplément de taille. */
export async function parcelQuote(db: Db, fromZoneId: string, toZoneId: string, size: ParcelSize) {
  const { rows } = await db.query<{ price: number; courier_share: number }>(
    `SELECT r.price::int AS price, r.courier_share::int AS courier_share
     FROM delivery_rates r
     JOIN delivery_zones f ON f.id = r.from_zone_id AND f.active
     JOIN delivery_zones t ON t.id = r.to_zone_id AND t.active
     WHERE r.from_zone_id = $1 AND r.to_zone_id = $2 AND r.mode = 'home' AND r.active`,
    [fromZoneId, toZoneId],
  );
  const rate = rows[0];
  if (!rate)
    throw new HttpError(
      422,
      'delivery_unavailable',
      'Zandu ne livre pas encore entre ces quartiers',
    );
  const extra = PARCEL_SIZES[size];
  return {
    price: rate.price + extra.surcharge,
    courierShare: rate.courier_share + extra.courierExtra,
  };
}

/**
 * Boutique de la plateforme qui porte les envois (« Zandu Envois ») : créée au premier envoi,
 * avec un compte système sans connexion possible. Elle ne vend rien et ne reçoit jamais
 * d'argent (un envoi n'a pas d'articles).
 */
export async function platformShop(tx: Tx, zoneId: string): Promise<string> {
  const existing = await tx.query<{ id: string }>(
    'SELECT id FROM seller_profiles WHERE is_platform',
  );
  if (existing.rows[0]) return existing.rows[0].id;
  await tx.query('LOCK TABLE seller_profiles IN SHARE ROW EXCLUSIVE MODE');
  const again = await tx.query<{ id: string }>('SELECT id FROM seller_profiles WHERE is_platform');
  if (again.rows[0]) return again.rows[0].id;
  const { rows: users } = await tx.query<{ id: string }>(
    `INSERT INTO users (phone, full_name, roles, status)
     VALUES ('+242000000001', 'Zandu Envois', '{seller}', 'suspended')
     ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id`,
  );
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO seller_profiles (user_id, shop_name, slug, city, pickup_zone_id, payout_msisdn,
                                  payout_operator, verification_status, verified_at, is_platform)
     SELECT $1, 'Zandu Envois', 'zandu-envois', z.city, z.id, '+242000000001', 'mtn', 'verified', now(), true
     FROM delivery_zones z WHERE z.id = $2
     RETURNING id`,
    [users[0]!.id, zoneId],
  );
  return rows[0]!.id;
}

/** Envoi de l'expéditeur connecté, verrouillé, avec sa livraison. */
async function ownErrand(tx: Tx, orderId: string, userId: string, kind: 'parcel' | 'ride') {
  const order = await lockOrder(tx, orderId);
  const { rows } = await tx.query<{ kind: string }>('SELECT kind FROM orders WHERE id = $1', [
    orderId,
  ]);
  if (order.buyer_id !== userId || rows[0]?.kind !== kind)
    throw notFound(kind === 'ride' ? 'Course' : 'Envoi');
  const { rows: deliveries } = await tx.query<{
    id: string;
    status: string;
    pickup_code: string | null;
    pickup_confirmed_at: Date | null;
    return_code: string | null;
    return_confirmed_at: Date | null;
  }>('SELECT * FROM deliveries WHERE order_id = $1 FOR UPDATE', [orderId]);
  return { order, delivery: deliveries[0] ?? null };
}

const sameCode = (expected: string | null, given: string) =>
  expected !== null && expected === given;

/**
 * Envoi de colis entre particuliers. L'expéditeur paie (Mobile Money, en séquestre) ; un
 * livreur Zandu enlève le colis chez lui contre son code de retrait et le remet au
 * destinataire contre le code reçu par SMS. Le livreur est payé à la fin, comme pour une
 * commande ; l'expéditeur est remboursé si l'envoi est annulé avant l'enlèvement.
 */
export function parcelRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const now = () => ctx.clock.now();

    /** Prix avant de commander, selon les deux quartiers et la taille. */
    app.get('/v1/parcels/quote', async (request) => {
      const q = z
        .object({ fromZoneId: z.uuid(), toZoneId: z.uuid(), size: Size })
        .parse(request.query);
      const quote = await parcelQuote(ctx.pool, q.fromZoneId, q.toZoneId, q.size);
      return { price: quote.price, currency: 'XAF', size: q.size };
    });

    /** Créer l'envoi : renvoie le panier à payer (même paiement Mobile Money qu'un achat). */
    app.post('/v1/parcels', async (request, reply) => {
      const body = ParcelBody.parse(request.body);
      const userId = currentUser(request).id;
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
      const pickupPhone = parseCongoMobile(body.pickup.phone);
      const recipientPhone = parseCongoMobile(body.recipient.phone);
      if (pickupPhone.e164 === recipientPhone.e164)
        throw new HttpError(
          422,
          'same_phone',
          "Le destinataire doit avoir un autre numéro que l'expéditeur",
        );
      const pickupLocation = roundPoint(body.pickup.location);
      const recipientLocation = roundPoint(body.recipient.location);

      const result = await withTx(ctx.pool, async (tx) => {
        const previous = await claimIdempotency(tx, {
          userId,
          key: idempotencyKey,
          method: 'POST',
          path: '/v1/parcels',
          body,
        });
        if (previous) return previous;
        const t = now();
        const quote = await parcelQuote(tx, body.pickup.zoneId, body.recipient.zoneId, body.size);
        const shopId = await platformShop(tx, body.pickup.zoneId);
        const { rows: checkouts } = await tx.query<{ id: string }>(
          `INSERT INTO checkouts (buyer_id, items_total, delivery_total, grand_total, expires_at, created_at)
           VALUES ($1, 0, $2, $2, $3, $4) RETURNING id`,
          [userId, quote.price, addMinutes(t, ctx.config.payments.ttlMinutes), t],
        );
        const checkoutId = checkouts[0]!.id;
        const { rows: orders } = await tx.query<{ id: string }>(
          `INSERT INTO orders (public_ref, checkout_id, buyer_id, seller_id, kind, items_subtotal, delivery_fee,
                               courier_share, commission_total, total, delivery_mode, delivery_zone_id,
                               shipping_address, pickup_zone_id, pickup_address, parcel, created_at)
           VALUES ($1, $2, $3, $4, 'parcel', 0, $5, $6, 0, $5, 'home', $7, $8, $9, $10, $11, $12)
           RETURNING id`,
          [
            publicOrderRef(),
            checkoutId,
            userId,
            shopId,
            quote.price,
            quote.courierShare,
            body.recipient.zoneId,
            {
              recipientName: body.recipient.name,
              phone: recipientPhone.e164,
              landmark: body.recipient.landmark,
              ...(recipientLocation ? { location: recipientLocation } : {}),
            },
            body.pickup.zoneId,
            {
              name: body.pickup.name,
              phone: pickupPhone.e164,
              landmark: body.pickup.landmark,
              ...(pickupLocation ? { location: pickupLocation } : {}),
            },
            { size: body.size, description: body.description },
            t,
          ],
        );
        await tx.query(
          `INSERT INTO order_status_history (order_id, from_status, to_status, event, actor_id, actor_role, created_at)
           VALUES ($1, NULL, 'pending_payment', 'parcel_created', $2, 'buyer', $3)`,
          [orders[0]!.id, userId, t],
        );
        await completeIdempotency(tx, userId, idempotencyKey!, checkoutId);
        return checkoutId;
      });
      const [order] = await orderViews(ctx.pool, 'o.checkout_id = $1', [result]);
      return reply
        .status(201)
        .send({ checkoutId: result, orderId: order!.id, total: order!.total });
    });

    /** Mes envois, les plus récents d'abord. */
    app.get('/v1/parcels', async (request) => {
      const items = await orderViews(ctx.pool, `o.buyer_id = $1 AND o.kind = 'parcel'`, [
        currentUser(request).id,
      ]);
      return { items };
    });

    app.register(errandActions(ctx, '/v1/parcels', 'parcel'));
  };
}

/**
 * Actions du client sur un envoi ou une course : confirmer le code de retrait du livreur (il
 * prend le colis, ou le passager monte), le code de retour, annuler avant l'enlèvement.
 */
export function errandActions(
  ctx: AppContext,
  prefix: string,
  kind: 'parcel' | 'ride',
): FastifyPluginAsync {
  return async (app) => {
    const now = () => ctx.clock.now();
    /** Le livreur montre son code de retrait : l'expéditeur le saisit et lui donne le colis. */
    app.post(`${prefix}/:id/rider-pickup`, async (request) => {
      const { id } = IdParam.parse(request.params);
      const { code } = Code4.parse(request.body);
      const userId = currentUser(request).id;
      const confirmedAt = await withTx(ctx.pool, async (tx) => {
        const { delivery } = await ownErrand(tx, id, userId, kind);
        if (delivery?.status !== 'assigned')
          throw new HttpError(409, 'no_rider_expected', 'Aucun livreur attendu pour ce colis');
        if (!sameCode(delivery.pickup_code, code))
          throw new HttpError(422, 'invalid_pickup_code', 'Code de retrait incorrect');
        if (delivery.pickup_confirmed_at) return delivery.pickup_confirmed_at;
        await tx.query('UPDATE deliveries SET pickup_confirmed_at = $2 WHERE id = $1', [
          delivery.id,
          now(),
        ]);
        return now();
      });
      return { orderId: id, pickupConfirmedAt: confirmedAt };
    });

    /** Colis rapporté (destinataire absent) : l'expéditeur saisit le code de retour du livreur. */
    app.post(`${prefix}/:id/rider-return`, async (request) => {
      const { id } = IdParam.parse(request.params);
      const { code } = Code4.parse(request.body);
      const userId = currentUser(request).id;
      const confirmedAt = await withTx(ctx.pool, async (tx) => {
        const { delivery } = await ownErrand(tx, id, userId, kind);
        if (delivery?.status !== 'returning')
          throw new HttpError(409, 'no_return_expected', 'Aucun retour en cours');
        if (!sameCode(delivery.return_code, code))
          throw new HttpError(422, 'invalid_return_code', 'Code de retour incorrect');
        if (delivery.return_confirmed_at) return delivery.return_confirmed_at;
        await tx.query('UPDATE deliveries SET return_confirmed_at = $2 WHERE id = $1', [
          delivery.id,
          now(),
        ]);
        return now();
      });
      return { orderId: id, returnConfirmedAt: confirmedAt };
    });

    /** Annuler tant que le livreur n'a pas le colis : remboursement complet. */
    app.post(`${prefix}/:id/cancel`, async (request) => {
      const { id } = IdParam.parse(request.params);
      const a = actor(request, 'buyer');
      const o = await withTx(ctx.pool, async (tx) => {
        const { delivery } = await ownErrand(tx, id, a.userId!, kind);
        if (delivery?.pickup_confirmed_at)
          throw new HttpError(
            409,
            'already_handed_over',
            kind === 'ride' ? 'Vous êtes déjà en route' : 'Le livreur a déjà votre colis',
          );
        const order = await applyOrderEvent(ctx, tx, id, { type: 'sender_cancelled' }, a);
        if (delivery)
          await tx.query(`UPDATE deliveries SET status = 'cancelled' WHERE id = $1`, [delivery.id]);
        return order;
      });
      return { id: o.id, status: o.status };
    });
  };
}
