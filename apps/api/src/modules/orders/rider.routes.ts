import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Actor, AppContext } from '../../context.js';
import { withTx, type Db, type Tx } from '../../db/pool.js';
import { addHours, addMinutes } from '../../lib/clock.js';
import { randomDigits, safeEqualHex } from '../../lib/crypto.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { actor, currentUser, requireAuth, requireRole, requireStaff } from '../auth/guards.js';
import { publish } from '../notifications/outbox.js';
import { applyOrderEvent, handoverHash, lockOrder } from './orders.service.js';

const IdParam = z.object({ id: z.uuid() });
const Code4 = z.object({ code: z.string().regex(/^\d{4}$/) });

/** Courses en cours : à récupérer, en route, au point relais, ou à rapporter au vendeur. */
const ACTIVE = `('assigned', 'picked_up', 'at_pickup_point', 'returning')`;
const TODAY = `date_trunc('day', $2::timestamptz AT TIME ZONE 'Africa/Brazzaville') AT TIME ZONE 'Africa/Brazzaville'`;

const INCIDENTS = {
  breakdown: 'Panne de moto',
  accident: 'Accident',
  not_ready: 'Colis pas prêt chez le vendeur',
  damaged: 'Colis abîmé',
  other: 'Autre problème',
} as const;

async function riderOf(
  db: Db,
  userId: string | null,
): Promise<{ id: string; courier_partner_id: string }> {
  const { rows } = await db.query<{ id: string; courier_partner_id: string }>(
    'SELECT id, courier_partner_id FROM riders WHERE user_id = $1 AND active',
    [userId],
  );
  if (!rows[0]) throw new HttpError(403, 'not_a_rider', "Vous n'êtes pas livreur partenaire");
  return rows[0];
}

/**
 * Mission vue par le livreur : où enlever (boutique, téléphone pour s'annoncer, code de retrait
 * à montrer), quoi vérifier, où livrer (repère, téléphone du destinataire), où en est l'attente
 * chez le client, et le code de retour s'il rapporte le colis. Le paiement est déjà fait : le
 * livreur n'encaisse jamais d'argent.
 */
async function riderMissions(
  ctx: AppContext,
  where: string,
  params: unknown[],
): Promise<Array<Record<string, unknown>>> {
  const { rows } = await ctx.pool.query<
    { handoverAttempts: number; arrivedAt: Date | null } & Record<string, unknown>
  >(
    `SELECT d.order_id AS "orderId", d.status, o.status AS "orderStatus", o.public_ref AS "publicRef",
            o.delivery_mode AS "deliveryMode", o.shipping_address AS "recipient",
            json_build_object('shopName', s.shop_name, 'phone', su.phone, 'city', s.city, 'zone', pz.name) AS "pickup",
            json_build_object('city', dz.city, 'zone', dz.name,
                              'pickupPoint', CASE WHEN pp.id IS NULL THEN NULL
                                                  ELSE json_build_object('name', pp.name, 'landmark', pp.landmark) END) AS "destination",
            (SELECT coalesce(sum(oi.quantity), 0)::int FROM order_items oi WHERE oi.order_id = o.id) AS "itemCount",
            (SELECT coalesce(json_agg(json_build_object('title', oi.title_snapshot, 'quantity', oi.quantity) ORDER BY oi.id), '[]')
               FROM order_items oi WHERE oi.order_id = o.id) AS "items",
            d.handover_attempts AS "handoverAttempts", d.assigned_at AS "assignedAt", d.picked_up_at AS "pickedUpAt",
            CASE WHEN d.status = 'assigned' THEN d.pickup_code END AS "pickupCode",
            d.pickup_confirmed_at AS "pickupConfirmedAt", d.arrived_at AS "arrivedAt",
            CASE WHEN d.status = 'returning' THEN d.return_code END AS "returnCode",
            d.return_confirmed_at AS "returnConfirmedAt", d.delivered_at AS "deliveredAt",
            d.returned_at AS "returnedAt", d.failure_reason AS "failureReason",
            (SELECT coalesce(json_agg(json_build_object('kind', e.kind, 'at', e.created_at) ORDER BY e.id), '[]')
               FROM delivery_events e WHERE e.delivery_id = d.id AND e.kind IN ('call', 'sms')) AS "contacts"
     FROM deliveries d JOIN orders o ON o.id = d.order_id
     JOIN seller_profiles s ON s.id = o.seller_id JOIN users su ON su.id = s.user_id
     JOIN delivery_zones pz ON pz.id = s.pickup_zone_id JOIN delivery_zones dz ON dz.id = o.delivery_zone_id
     LEFT JOIN pickup_points pp ON pp.id = o.pickup_point_id
     WHERE ${where}
     ORDER BY d.assigned_at`,
    params,
  );
  return rows.map(({ handoverAttempts, ...mission }) => ({
    ...mission,
    handoverAttemptsLeft: Math.max(0, ctx.config.handoverMaxAttempts - handoverAttempts),
    absentAllowedAt: mission.arrivedAt
      ? addMinutes(mission.arrivedAt, ctx.config.riderAbsentWaitMinutes)
      : null,
  }));
}

interface DeliveryRow {
  id: string;
  status: string;
  handover_code_hash: string;
  handover_attempts: number;
  pickup_code: string | null;
  pickup_confirmed_at: Date | null;
  arrived_at: Date | null;
  return_code: string | null;
  return_confirmed_at: Date | null;
}

async function riderDelivery(tx: Tx, orderId: string, a: Actor): Promise<DeliveryRow> {
  const rider = await riderOf(tx, a.userId);
  const { rows } = await tx.query<DeliveryRow>(
    'SELECT * FROM deliveries WHERE order_id = $1 AND rider_id = $2 FOR UPDATE',
    [orderId, rider.id],
  );
  if (!rows[0]) throw notFound('Livraison');
  return rows[0];
}

/** Livraison d'une commande du vendeur connecté (verrouillée). */
async function sellerDelivery(tx: Tx, orderId: string, a: Actor): Promise<DeliveryRow> {
  const order = await lockOrder(tx, orderId);
  const { rows: shop } = await tx.query<{ id: string }>(
    'SELECT id FROM seller_profiles WHERE user_id = $1',
    [a.userId],
  );
  if (order.seller_id !== shop[0]?.id) throw notFound('Commande');
  const { rows } = await tx.query<DeliveryRow>(
    'SELECT * FROM deliveries WHERE order_id = $1 FOR UPDATE',
    [orderId],
  );
  if (!rows[0]) throw notFound('Livraison');
  return rows[0];
}

const logEvent = (
  tx: Tx,
  deliveryId: string,
  kind: string,
  a: Actor,
  at: Date,
  extra: { incident?: string; note?: string } = {},
) =>
  tx.query(
    `INSERT INTO delivery_events (delivery_id, kind, incident, note, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [deliveryId, kind, extra.incident ?? null, extra.note ?? null, a.userId, at],
  );

const sameCode = (expected: string | null, given: string) =>
  expected !== null &&
  safeEqualHex(Buffer.from(expected).toString('hex'), Buffer.from(given).toString('hex'));

/**
 * Livraison manquée : la commande passe en litige (argent toujours bloqué) et le support
 * décide (nouvelle livraison hors application, remboursement…).
 */
async function failDelivery(ctx: AppContext, tx: Tx, orderId: string, reason: string, a: Actor) {
  const now = ctx.clock.now();
  const order = await applyOrderEvent(ctx, tx, orderId, { type: 'delivery_failed', reason }, a);
  await tx.query(
    `INSERT INTO disputes (order_id, opened_by, reason, description, sla_due_at, created_at)
     VALUES ($1, $2, 'not_received', $3, $4, $5)`,
    [
      orderId,
      a.userId,
      `Livraison impossible : ${reason}`,
      addHours(now, ctx.config.disputeSlaHours),
      now,
    ],
  );
  return order;
}

/**
 * Livreur partenaire (docs/ux/03 §10) : courses attribuées par le support, code de retrait
 * montré au vendeur, arrivée et attente chez le client, retour au vendeur, incident.
 * Le vendeur confirme les codes de retrait et de retour depuis son application.
 */
export function riderRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const now = () => ctx.clock.now();

    app.register(async (rider) => {
      rider.addHook('preHandler', requireRole('rider'));

      rider.get('/v1/rider/me', async (request) => {
        const r = await riderOf(ctx.pool, currentUser(request).id);
        const { rows } = await ctx.pool.query(
          `SELECT u.full_name AS "fullName", u.phone, cp.name AS "partnerName", cp.phone AS "partnerPhone",
                  z.name AS zone, z.city,
                  (SELECT count(*)::int FROM deliveries d WHERE d.rider_id = r.id AND d.status = 'delivered') AS "deliveredTotal",
                  (SELECT count(*)::int FROM deliveries d WHERE d.rider_id = r.id AND d.status = 'delivered'
                     AND d.delivered_at >= ${TODAY}) AS "deliveredToday",
                  (SELECT count(*)::int FROM deliveries d WHERE d.rider_id = r.id AND d.status IN ${ACTIVE}) AS "inProgress"
           FROM riders r JOIN users u ON u.id = r.user_id
           JOIN courier_partners cp ON cp.id = r.courier_partner_id
           LEFT JOIN delivery_zones z ON z.id = r.zone_id
           WHERE r.id = $1`,
          [r.id, now()],
        );
        return rows[0];
      });

      rider.get('/v1/rider/deliveries', async (request) => {
        const r = await riderOf(ctx.pool, currentUser(request).id);
        return {
          items: await riderMissions(ctx, `d.rider_id = $1 AND d.status IN ${ACTIVE}`, [r.id]),
        };
      });

      /** Courses terminées : livrées, rapportées au vendeur ou échouées. */
      rider.get('/v1/rider/history', async (request) => {
        const { period } = z
          .object({ period: z.enum(['7d', '30d']).default('7d') })
          .parse(request.query);
        const r = await riderOf(ctx.pool, currentUser(request).id);
        const days = period === '7d' ? 7 : 30;
        const { rows } = await ctx.pool.query<{ outcome: string; minutes: number | null }>(
          `SELECT d.order_id AS "orderId", o.public_ref AS "publicRef", pz.name AS "from", dz.name AS "to",
                  CASE WHEN d.status = 'delivered' THEN 'delivered'
                       WHEN d.returned_at IS NOT NULL THEN 'returned' ELSE 'failed' END AS outcome,
                  coalesce(d.delivered_at, d.returned_at, d.updated_at) AS "at",
                  CASE WHEN d.delivered_at IS NOT NULL AND d.picked_up_at IS NOT NULL
                       THEN round(extract(epoch FROM d.delivered_at - d.picked_up_at) / 60)::int END AS minutes,
                  d.failure_reason AS reason
           FROM deliveries d JOIN orders o ON o.id = d.order_id
           JOIN seller_profiles s ON s.id = o.seller_id
           JOIN delivery_zones pz ON pz.id = s.pickup_zone_id JOIN delivery_zones dz ON dz.id = o.delivery_zone_id
           WHERE d.rider_id = $1 AND d.status IN ('delivered', 'failed')
             AND coalesce(d.delivered_at, d.returned_at, d.updated_at)
                 >= (date_trunc('day', $2::timestamptz AT TIME ZONE 'Africa/Brazzaville')
                     - make_interval(days => $3::int - 1)) AT TIME ZONE 'Africa/Brazzaville'
           ORDER BY "at" DESC LIMIT 200`,
          [r.id, now(), days],
        );
        const durations = rows.flatMap((x) => (x.minutes === null ? [] : [x.minutes]));
        return {
          delivered: rows.filter((x) => x.outcome === 'delivered').length,
          returned: rows.filter((x) => x.outcome !== 'delivered').length,
          averageMinutes: durations.length
            ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
            : null,
          items: rows,
        };
      });

      rider.get('/v1/rider/deliveries/:id', async (request) => {
        const { id } = IdParam.parse(request.params);
        const r = await riderOf(ctx.pool, currentUser(request).id);
        const [mission] = await riderMissions(ctx, 'd.order_id = $1 AND d.rider_id = $2', [
          id,
          r.id,
        ]);
        if (!mission) throw notFound('Livraison');
        return mission;
      });

      /** Colis pris en charge, une fois le code de retrait confirmé par le vendeur. */
      rider.post('/v1/rider/deliveries/:id/pickup', async (request) => {
        const { id } = IdParam.parse(request.params);
        const a = actor(request, 'rider');
        const o = await withTx(ctx.pool, async (tx) => {
          const d = await riderDelivery(tx, id, a);
          if (d.status !== 'assigned')
            throw new HttpError(409, 'invalid_delivery_status', 'Colis déjà récupéré');
          if (!d.pickup_confirmed_at)
            throw new HttpError(
              409,
              'pickup_not_confirmed',
              'Le vendeur doit d’abord saisir votre code de retrait',
            );
          await tx.query(
            `UPDATE deliveries SET status = 'picked_up', picked_up_at = $2 WHERE id = $1`,
            [d.id, now()],
          );
          return applyOrderEvent(ctx, tx, id, { type: 'rider_picked_up' }, a);
        });
        return { id: o.id, status: o.status };
      });

      rider.post('/v1/rider/deliveries/:id/arrived-at-pickup-point', async (request) => {
        const { id } = IdParam.parse(request.params);
        const a = actor(request, 'rider');
        const o = await withTx(ctx.pool, async (tx) => {
          const d = await riderDelivery(tx, id, a);
          if (d.status !== 'picked_up')
            throw new HttpError(409, 'invalid_delivery_status', 'Colis pas en route');
          await tx.query(`UPDATE deliveries SET status = 'at_pickup_point' WHERE id = $1`, [d.id]);
          return applyOrderEvent(ctx, tx, id, { type: 'arrived_at_pickup_point' }, a);
        });
        return { id: o.id, status: o.status };
      });

      /**
       * Arrivé chez le client (livraison à domicile) : un SMS le prévient et l'attente
       * commence ; au bout de RIDER_ABSENT_WAIT_MINUTES, il pourra être déclaré absent.
       */
      rider.post('/v1/rider/deliveries/:id/arrived', async (request) => {
        const { id } = IdParam.parse(request.params);
        const a = actor(request, 'rider');
        const arrivedAt = await withTx(ctx.pool, async (tx) => {
          const d = await riderDelivery(tx, id, a);
          if (d.status !== 'picked_up')
            throw new HttpError(409, 'invalid_delivery_status', 'Colis pas en route');
          const order = await lockOrder(tx, id);
          if (order.delivery_mode !== 'home')
            throw new HttpError(409, 'not_home_delivery', 'Livraison en point relais');
          if (d.arrived_at) return d.arrived_at;
          const at = now();
          await tx.query('UPDATE deliveries SET arrived_at = $2 WHERE id = $1', [d.id, at]);
          await logEvent(tx, d.id, 'arrived', a, at);
          await logEvent(tx, d.id, 'sms', a, at);
          await publish(tx, 'order.rider_arrived', { type: 'order', id }, {}, at);
          return at;
        });
        return {
          arrivedAt,
          absentAllowedAt: addMinutes(arrivedAt, ctx.config.riderAbsentWaitMinutes),
        };
      });

      /** Appel au client pendant l'attente : gardé comme preuve des tentatives de contact. */
      rider.post('/v1/rider/deliveries/:id/contact-attempt', async (request, reply) => {
        const { id } = IdParam.parse(request.params);
        const a = actor(request, 'rider');
        await withTx(ctx.pool, async (tx) => {
          const d = await riderDelivery(tx, id, a);
          if (d.status !== 'picked_up' || !d.arrived_at)
            throw new HttpError(409, 'not_arrived', 'Indiquez d’abord que vous êtes arrivé');
          const { rows } = await tx.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM delivery_events WHERE delivery_id = $1 AND kind = 'call'`,
            [d.id],
          );
          if ((rows[0]?.n ?? 0) >= 20)
            throw new HttpError(429, 'too_many_attempts', 'Assez d’appels pour cette course');
          await logEvent(tx, d.id, 'call', a, now());
        });
        return reply.status(201).send({ recorded: true });
      });

      /**
       * Cliente absente (après l'attente) ou colis refusé : le livreur rapporte le colis au
       * vendeur, avec un code de retour. L'argent de la cliente reste bloqué.
       */
      rider.post('/v1/rider/deliveries/:id/return', async (request) => {
        const { id } = IdParam.parse(request.params);
        const body = z
          .object({
            reason: z.enum(['absent', 'refused']),
            note: z.string().trim().min(3).max(300).optional(),
          })
          .parse(request.body);
        const a = actor(request, 'rider');
        await withTx(ctx.pool, async (tx) => {
          const d = await riderDelivery(tx, id, a);
          if (d.status !== 'picked_up' || !d.arrived_at)
            throw new HttpError(409, 'not_arrived', 'Indiquez d’abord que vous êtes arrivé');
          const allowedAt = addMinutes(d.arrived_at, ctx.config.riderAbsentWaitMinutes);
          if (body.reason === 'absent' && now() < allowedAt)
            throw new HttpError(409, 'absent_wait', 'Attendez encore la cliente', {
              absentAllowedAt: allowedAt.toISOString(),
            });
          const reason =
            body.reason === 'absent'
              ? 'cliente absente'
              : `colis refusé${body.note ? ` (${body.note})` : ''}`;
          await tx.query(
            `UPDATE deliveries SET status = 'returning', return_code = $2, failure_reason = $3 WHERE id = $1`,
            [d.id, randomDigits(4), reason],
          );
          await logEvent(tx, d.id, body.reason, a, now(), { note: body.note });
          await publish(tx, 'order.delivery_returning', { type: 'order', id }, { reason }, now());
        });
        const [mission] = await riderMissions(ctx, 'd.order_id = $1', [id]);
        return mission;
      });

      /** Colis rendu : le vendeur a saisi le code de retour ; le support reprend la main. */
      rider.post('/v1/rider/deliveries/:id/returned', async (request) => {
        const { id } = IdParam.parse(request.params);
        const a = actor(request, 'rider');
        const o = await withTx(ctx.pool, async (tx) => {
          const d = await riderDelivery(tx, id, a);
          if (d.status !== 'returning')
            throw new HttpError(409, 'invalid_delivery_status', 'Aucun retour en cours');
          if (!d.return_confirmed_at)
            throw new HttpError(
              409,
              'return_not_confirmed',
              'Le vendeur doit d’abord saisir votre code de retour',
            );
          const { rows } = await tx.query<{ failure_reason: string }>(
            `UPDATE deliveries SET status = 'failed', returned_at = $2 WHERE id = $1 RETURNING failure_reason`,
            [d.id, now()],
          );
          await logEvent(tx, d.id, 'returned', a, now());
          return failDelivery(ctx, tx, id, `${rows[0]!.failure_reason}, colis rendu au vendeur`, a);
        });
        return { id: o.id, status: o.status };
      });

      /** Incident sur la route : le support est prévenu et peut confier la course à un autre. */
      rider.post('/v1/rider/deliveries/:id/incident', async (request, reply) => {
        const { id } = IdParam.parse(request.params);
        const body = z
          .object({
            kind: z.enum(Object.keys(INCIDENTS) as [keyof typeof INCIDENTS]),
            note: z.string().trim().max(500).optional(),
          })
          .parse(request.body);
        const a = actor(request, 'rider');
        await withTx(ctx.pool, async (tx) => {
          const d = await riderDelivery(tx, id, a);
          if (!['assigned', 'picked_up', 'at_pickup_point', 'returning'].includes(d.status))
            throw new HttpError(409, 'invalid_delivery_status', 'Course terminée');
          await logEvent(tx, d.id, 'incident', a, now(), {
            incident: body.kind,
            note: body.note || undefined,
          });
          const { rows } = await tx.query<{ public_ref: string }>(
            'SELECT public_ref FROM orders WHERE id = $1',
            [id],
          );
          await publish(
            tx,
            'alert.support',
            { type: 'order', id },
            {
              message: `Incident livreur sur ${rows[0]!.public_ref} : ${INCIDENTS[body.kind]}${body.note ? ` (${body.note})` : ''}`,
            },
            now(),
          );
        });
        return reply.status(201).send({ recorded: true });
      });

      /** Remise en main propre : le livreur saisit le code que l'acheteur lui donne. */
      rider.post('/v1/rider/deliveries/:id/handover', async (request) => {
        const { id } = IdParam.parse(request.params);
        const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(request.body);
        const a = actor(request, 'rider');
        const result = await withTx(ctx.pool, async (tx) => {
          const d = await riderDelivery(tx, id, a);
          if (d.status !== 'picked_up' && d.status !== 'at_pickup_point')
            return { error: 'invalid_delivery_status' as const };
          if (d.handover_attempts >= ctx.config.handoverMaxAttempts)
            return { error: 'handover_locked' as const };
          if (!safeEqualHex(d.handover_code_hash, handoverHash(ctx, id, code))) {
            await tx.query(
              'UPDATE deliveries SET handover_attempts = handover_attempts + 1 WHERE id = $1',
              [d.id],
            );
            return { error: 'invalid_handover_code' as const };
          }
          await tx.query(
            `UPDATE deliveries SET status = 'delivered', delivered_at = $2 WHERE id = $1`,
            [d.id, now()],
          );
          return applyOrderEvent(ctx, tx, id, { type: 'handover_confirmed' }, a);
        });
        if ('error' in result) {
          if (result.error === 'invalid_delivery_status')
            throw new HttpError(409, 'invalid_delivery_status', 'Pas de remise possible');
          throw result.error === 'handover_locked'
            ? new HttpError(423, 'handover_locked', 'Trop de codes erronés : contactez le support')
            : new HttpError(422, 'invalid_handover_code', 'Code de remise incorrect');
        }
        return { id: result.id, status: result.status };
      });

      rider.post('/v1/rider/deliveries/:id/failed', async (request) => {
        const { id } = IdParam.parse(request.params);
        const { reason } = z
          .object({ reason: z.string().trim().min(5).max(300) })
          .parse(request.body);
        const a = actor(request, 'rider');
        const o = await withTx(ctx.pool, async (tx) => {
          const d = await riderDelivery(tx, id, a);
          await tx.query(
            `UPDATE deliveries SET status = 'failed', failure_reason = $2 WHERE id = $1`,
            [d.id, reason],
          );
          return failDelivery(ctx, tx, id, reason, a);
        });
        return { id: o.id, status: o.status };
      });
    });

    // ---------------- Vendeur : codes du livreur ----------------
    app.register(async (seller) => {
      seller.addHook('preHandler', requireRole('seller'));

      /** Le vendeur saisit le code de retrait que le livreur lui montre, puis donne le colis. */
      seller.post('/v1/seller/orders/:id/rider-pickup', async (request) => {
        const { id } = IdParam.parse(request.params);
        const { code } = Code4.parse(request.body);
        const a = actor(request, 'seller');
        const confirmedAt = await withTx(ctx.pool, async (tx) => {
          const d = await sellerDelivery(tx, id, a);
          if (d.status !== 'assigned')
            throw new HttpError(409, 'no_rider_expected', 'Aucun livreur attendu pour ce colis');
          if (!sameCode(d.pickup_code, code))
            throw new HttpError(422, 'invalid_pickup_code', 'Code de retrait incorrect');
          if (d.pickup_confirmed_at) return d.pickup_confirmed_at;
          await tx.query('UPDATE deliveries SET pickup_confirmed_at = $2 WHERE id = $1', [
            d.id,
            now(),
          ]);
          return now();
        });
        return { orderId: id, pickupConfirmedAt: confirmedAt };
      });

      /** Retour : le vendeur saisit le code de retour du livreur quand il récupère son colis. */
      seller.post('/v1/seller/orders/:id/rider-return', async (request) => {
        const { id } = IdParam.parse(request.params);
        const { code } = Code4.parse(request.body);
        const a = actor(request, 'seller');
        const confirmedAt = await withTx(ctx.pool, async (tx) => {
          const d = await sellerDelivery(tx, id, a);
          if (d.status !== 'returning')
            throw new HttpError(409, 'no_return_expected', 'Aucun retour en cours');
          if (!sameCode(d.return_code, code))
            throw new HttpError(422, 'invalid_return_code', 'Code de retour incorrect');
          if (d.return_confirmed_at) return d.return_confirmed_at;
          await tx.query('UPDATE deliveries SET return_confirmed_at = $2 WHERE id = $1', [
            d.id,
            now(),
          ]);
          return now();
        });
        return { orderId: id, returnConfirmedAt: confirmedAt };
      });
    });

    // ---------------- Support : incidents et retours ----------------
    app.register(async (staff) => {
      staff.addHook('preHandler', requireStaff(ctx));

      /** Incidents, absences et refus des 7 derniers jours, les plus récents d'abord. */
      staff.get('/v1/support/delivery-events', async () => {
        const { rows } = await ctx.pool.query(
          `SELECT e.id::text AS id, e.kind, e.incident, e.note, e.created_at AS "at",
                  d.order_id AS "orderId", o.public_ref AS "publicRef", d.status AS "deliveryStatus",
                  u.full_name AS "riderName", u.phone AS "riderPhone"
           FROM delivery_events e JOIN deliveries d ON d.id = e.delivery_id
           JOIN orders o ON o.id = d.order_id
           LEFT JOIN riders r ON r.id = d.rider_id LEFT JOIN users u ON u.id = r.user_id
           WHERE e.kind IN ('incident', 'absent', 'refused') AND e.created_at >= $1
           ORDER BY e.id DESC LIMIT 100`,
          [addHours(now(), -7 * 24)],
        );
        return { items: rows };
      });
    });
  };
}
