import { DomainError, isInCongo, parseCongoMobile, rideQuote, type LatLng } from '@zandu/domain';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { withTx } from '../../db/pool.js';
import { addMinutes } from '../../lib/clock.js';
import { publicOrderRef } from '../../lib/crypto.js';
import { HttpError } from '../../lib/errors.js';
import { claimIdempotency, completeIdempotency } from '../../lib/idempotency.js';
import { currentUser, requireAuth } from '../auth/guards.js';
import { orderViews } from '../orders/orders.service.js';
import { errandActions, platformShop } from '../parcels/parcels.routes.js';

const Point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).optional(),
});
const Stop = z.object({
  zoneId: z.uuid(),
  landmark: z.string().trim().min(3).max(300),
  location: Point,
});
const RideBody = z.object({
  pickup: Stop,
  destination: Stop,
  /** Numéro du passager s'il diffère du compte (course pour un proche). */
  phone: z.string().trim().min(6).max(20).optional(),
  passengerName: z.string().trim().min(2).max(80).optional(),
});

const round = (p: z.infer<typeof Point>) => ({
  lat: Math.round(p.lat * 1e6) / 1e6,
  lng: Math.round(p.lng * 1e6) / 1e6,
  ...(p.accuracy !== undefined ? { accuracy: Math.round(p.accuracy) } : {}),
});

/** Prix d'une course (erreurs du domaine en 422). */
function quote(from: LatLng, to: LatLng) {
  if (!isInCongo(from) || !isInCongo(to))
    throw new HttpError(422, 'location_out_of_area', 'Le départ ou l’arrivée est hors du Congo');
  try {
    return rideQuote(from, to);
  } catch (error) {
    if (error instanceof DomainError) throw new HttpError(422, error.code, error.message);
    throw error;
  }
}

/**
 * Moto-taxi : le passager pose le départ et l'arrivée sur la carte, voit le prix, paie par
 * Mobile Money (séquestre). Un conducteur (livreur Zandu) accepte la course, montre son code
 * de retrait au passager qui le saisit en montant ; à l'arrivée, le passager lui donne le code
 * reçu par SMS. Le conducteur est payé à la fin, comme pour une livraison.
 */
export function rideRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const now = () => ctx.clock.now();

    app.get('/v1/rides/quote', async (request) => {
      const q = z
        .object({
          fromLat: z.coerce.number(),
          fromLng: z.coerce.number(),
          toLat: z.coerce.number(),
          toLng: z.coerce.number(),
        })
        .parse(request.query);
      const r = quote({ lat: q.fromLat, lng: q.fromLng }, { lat: q.toLat, lng: q.toLng });
      return {
        price: r.price,
        currency: 'XAF',
        distanceMeters: r.distanceMeters,
        etaMinutes: r.etaMinutes,
      };
    });

    app.post('/v1/rides', async (request, reply) => {
      const body = RideBody.parse(request.body);
      const user = currentUser(request);
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
      const r = quote(body.pickup.location, body.destination.location);
      const phone = parseCongoMobile(body.phone ?? user.phone).e164;
      const checkoutId = await withTx(ctx.pool, async (tx) => {
        const previous = await claimIdempotency(tx, {
          userId: user.id,
          key: idempotencyKey,
          method: 'POST',
          path: '/v1/rides',
          body,
        });
        if (previous) return previous;
        const zones = await tx.query(
          'SELECT 1 FROM delivery_zones WHERE id = ANY($1::uuid[]) AND active',
          [[body.pickup.zoneId, body.destination.zoneId]],
        );
        if ((zones.rowCount ?? 0) < (body.pickup.zoneId === body.destination.zoneId ? 1 : 2))
          throw new HttpError(422, 'delivery_unavailable', 'Quartier non desservi');
        const { rows: names } = await tx.query<{ full_name: string | null }>(
          'SELECT full_name FROM users WHERE id = $1',
          [user.id],
        );
        const name = body.passengerName ?? names[0]?.full_name?.trim() ?? 'Passager Zandu';
        const t = now();
        const shopId = await platformShop(tx, body.pickup.zoneId);
        const { rows: checkouts } = await tx.query<{ id: string }>(
          `INSERT INTO checkouts (buyer_id, items_total, delivery_total, grand_total, expires_at, created_at)
           VALUES ($1, 0, $2, $2, $3, $4) RETURNING id`,
          [user.id, r.price, addMinutes(t, ctx.config.payments.ttlMinutes), t],
        );
        const id = checkouts[0]!.id;
        const { rows: orders } = await tx.query<{ id: string }>(
          `INSERT INTO orders (public_ref, checkout_id, buyer_id, seller_id, kind, items_subtotal, delivery_fee,
                               courier_share, commission_total, total, delivery_mode, delivery_zone_id,
                               shipping_address, pickup_zone_id, pickup_address, trip, created_at)
           VALUES ($1, $2, $3, $4, 'ride', 0, $5, $6, 0, $5, 'home', $7, $8, $9, $10, $11, $12)
           RETURNING id`,
          [
            publicOrderRef(),
            id,
            user.id,
            shopId,
            r.price,
            r.courierShare,
            body.destination.zoneId,
            {
              recipientName: name,
              phone,
              landmark: body.destination.landmark,
              location: round(body.destination.location),
            },
            body.pickup.zoneId,
            {
              name,
              phone,
              landmark: body.pickup.landmark,
              location: round(body.pickup.location),
            },
            { distanceMeters: r.distanceMeters, etaMinutes: r.etaMinutes },
            t,
          ],
        );
        await tx.query(
          `INSERT INTO order_status_history (order_id, from_status, to_status, event, actor_id, actor_role, created_at)
           VALUES ($1, NULL, 'pending_payment', 'ride_created', $2, 'buyer', $3)`,
          [orders[0]!.id, user.id, t],
        );
        await completeIdempotency(tx, user.id, idempotencyKey!, id);
        return id;
      });
      const [order] = await orderViews(ctx.pool, 'o.checkout_id = $1', [checkoutId]);
      return reply.status(201).send({ checkoutId, orderId: order!.id, total: order!.total });
    });

    app.get('/v1/rides', async (request) => {
      const items = await orderViews(ctx.pool, `o.buyer_id = $1 AND o.kind = 'ride'`, [
        currentUser(request).id,
      ]);
      return { items };
    });

    app.register(errandActions(ctx, '/v1/rides', 'ride'));
  };
}
