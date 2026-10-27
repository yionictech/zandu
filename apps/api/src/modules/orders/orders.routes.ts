import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { arrivalMinutes, distanceMeters, formatXaf, type LatLng } from '@zandu/domain';
import type { Actor, AppContext } from '../../context.js';
import { withTx, type Db, type Tx } from '../../db/pool.js';
import { addHours } from '../../lib/clock.js';
import { randomDigits } from '../../lib/crypto.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { audit } from '../admin/audit.js';
import {
  actor,
  currentUser,
  requireAuth,
  requireRole,
  requireStaff,
  staffActor,
} from '../auth/guards.js';
import { publish } from '../notifications/outbox.js';
import { PrepMinutes } from '../seller/seller.routes.js';
import { consumeUpload } from '../uploads/uploads.service.js';
import {
  applyOrderEvent,
  handoverHash,
  lockOrder,
  orderViews,
  sellerOrderViews,
  type OrderRow,
} from './orders.service.js';

const IdParam = z.object({ id: z.uuid() });

/**
 * Détail vendeur : livreur attribué (prénom et initiale, pas de téléphone), litige et sa
 * réponse, avis laissés sur la commande.
 */
async function sellerOrderExtras(db: Db, orderId: string) {
  const { rows: riders } = await db.query<{ name: string | null }>(
    `SELECT u.full_name AS name FROM deliveries d JOIN riders r ON r.id = d.rider_id
     JOIN users u ON u.id = r.user_id WHERE d.order_id = $1`,
    [orderId],
  );
  // Où en est le livreur : à confirmer avec son code de retrait, ou colis à reprendre (retour).
  const { rows: deliveries } = await db.query(
    `SELECT status, pickup_confirmed_at AS "pickupConfirmedAt", return_confirmed_at AS "returnConfirmedAt",
            returned_at AS "returnedAt", failure_reason AS "failureReason"
     FROM deliveries WHERE order_id = $1`,
    [orderId],
  );
  const { rows: disputes } = await db.query(
    `SELECT d.id, d.reason, d.description, d.status, d.resolution, d.sla_due_at AS "slaDueAt",
            d.seller_choice AS "sellerChoice", d.seller_message AS "sellerMessage",
            d.seller_responded_at AS "sellerRespondedAt",
            coalesce(split_part(u.full_name, ' ', 1), 'Acheteur') AS "buyerName",
            (SELECT count(*)::int FROM dispute_evidence e WHERE e.dispute_id = d.id AND e.uploaded_by = d.opened_by) AS "buyerEvidenceCount",
            (SELECT count(*)::int FROM dispute_evidence e WHERE e.dispute_id = d.id AND e.uploaded_by <> d.opened_by) AS "sellerEvidenceCount"
     FROM disputes d JOIN users u ON u.id = d.opened_by WHERE d.order_id = $1`,
    [orderId],
  );
  const { rows: reviews } = await db.query(
    `SELECT r.id, r.rating, r.comment, r.tags, r.created_at AS "createdAt",
            coalesce(split_part(u.full_name, ' ', 1), 'Acheteur') AS "authorName",
            r.seller_reply AS reply
     FROM reviews r JOIN order_items oi ON oi.id = r.order_item_id JOIN users u ON u.id = r.buyer_id
     WHERE oi.order_id = $1 AND NOT r.hidden ORDER BY r.created_at`,
    [orderId],
  );
  const name = riders[0]?.name?.trim();
  return {
    rider: riders[0] ? { name: name ? shortName(name) : 'Livreur Zandu' } : null,
    delivery: deliveries[0] ?? null,
    dispute: disputes[0] ?? null,
    reviews,
  };
}

/** « Junior Mabiala » → « Junior M. » */
function shortName(full: string): string {
  const [first, ...rest] = full.split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first!;
}

async function sellerIdOf(db: Db, userId: string | null): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM seller_profiles WHERE user_id = $1',
    [userId],
  );
  if (!rows[0]) throw new HttpError(403, 'no_shop', "Vous n'avez pas de boutique");
  return rows[0].id;
}

/** Vérifie que l'acteur a le droit d'agir sur CETTE commande (protection contre les IDOR). */
async function ownedOrder(tx: Tx, orderId: string, a: Actor): Promise<OrderRow> {
  const order = await lockOrder(tx, orderId);
  if (a.role === 'buyer' && order.buyer_id !== a.userId) throw notFound('Commande');
  if (a.role === 'seller' && order.seller_id !== (await sellerIdOf(tx, a.userId)))
    throw notFound('Commande');
  return order;
}

const orderHistory = async (db: Db, orderId: string) =>
  (
    await db.query(
      `SELECT to_status AS status, event, created_at AS "at" FROM order_status_history WHERE order_id = $1 ORDER BY id`,
      [orderId],
    )
  ).rows;

const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'preparing',
  'ready_for_pickup',
  'in_delivery',
  'awaiting_collection',
  'delivered',
  'completed',
  'disputed',
  'refunded',
  'cancelled',
] as const;

/** `?status=paid,preparing` : un ou plusieurs statuts séparés par des virgules. */
const StatusFilter = z.object({
  status: z
    .string()
    .max(200)
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(z.enum(ORDER_STATUSES)).min(1))
    .optional(),
});

export function orderRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const now = () => ctx.clock.now();

    // ---------------- Acheteur ----------------
    app.get('/v1/orders', async (request) => ({
      items: await orderViews(ctx.pool, 'o.buyer_id = $1', [currentUser(request).id]),
    }));

    app.get('/v1/orders/:id', async (request) => {
      const { id } = IdParam.parse(request.params);
      const user = currentUser(request);
      // Le vendeur passe par /v1/seller/orders/{id}, qui ne montre pas le téléphone de l'acheteur.
      const [order] = await orderViews(ctx.pool, `o.id = $1 AND (o.buyer_id = $2 OR $3)`, [
        id,
        user.id,
        user.roles.includes('support') || user.roles.includes('admin'),
      ]);
      if (!order) throw notFound('Commande');
      return { ...order, history: await orderHistory(ctx.pool, id) };
    });

    /**
     * Livreur en route (docs/ux/03 §15) : prénom, téléphone pour l'appeler, dernière position
     * si elle a moins de 10 minutes. Rien avant la prise en charge ni après la remise.
     */
    app.get('/v1/orders/:id/tracking', async (request) => {
      const { id } = IdParam.parse(request.params);
      const user = currentUser(request);
      const { rows } = await ctx.pool.query<{
        status: string;
        delivery_status: string | null;
        rider_name: string | null;
        rider_phone: string | null;
        lat: number | null;
        lng: number | null;
        accuracy_m: number | null;
        recorded_at: Date | null;
        destination: LatLng | null;
      }>(
        `SELECT o.status, d.status AS delivery_status, u.full_name AS rider_name, u.phone AS rider_phone,
                p.lat, p.lng, p.accuracy_m, p.recorded_at,
                CASE WHEN o.pickup_point_id IS NULL THEN o.shipping_address->'location'
                     WHEN pp.lat IS NOT NULL THEN jsonb_build_object('lat', pp.lat, 'lng', pp.lng) END AS destination
         FROM orders o
         LEFT JOIN pickup_points pp ON pp.id = o.pickup_point_id
         LEFT JOIN deliveries d ON d.order_id = o.id
         LEFT JOIN riders r ON r.id = d.rider_id LEFT JOIN users u ON u.id = r.user_id
         LEFT JOIN rider_positions p ON p.delivery_id = d.id
         WHERE o.id = $1 AND o.buyer_id = $2`,
        [id, user.id],
      );
      const row = rows[0];
      if (!row) throw notFound('Commande');
      const onTheWay = row.delivery_status === 'picked_up';
      const fresh =
        onTheWay &&
        row.recorded_at !== null &&
        ctx.clock.now().getTime() - row.recorded_at.getTime() <= 10 * 60_000;
      const name = row.rider_name?.trim();
      const destination = row.destination
        ? { lat: row.destination.lat, lng: row.destination.lng }
        : null;
      const position = fresh ? { lat: row.lat!, lng: row.lng! } : null;
      return {
        onTheWay,
        rider:
          onTheWay && row.rider_phone
            ? { name: name ? shortName(name) : 'Livreur Zandu', phone: row.rider_phone }
            : null,
        position: fresh
          ? { lat: row.lat!, lng: row.lng!, accuracy: row.accuracy_m, at: row.recorded_at! }
          : null,
        destination,
        // Estimation à vol d'oiseau, détour compris (docs/ux/03 §16) : seulement avec les deux points.
        distanceMeters: position && destination ? distanceMeters(position, destination) : null,
        etaMinutes: position && destination ? arrivalMinutes(position, destination) : null,
      };
    });

    app.post('/v1/orders/:id/cancel', async (request) => {
      const { id } = IdParam.parse(request.params);
      const a = actor(request, 'buyer');
      return withTx(ctx.pool, async (tx) => {
        await ownedOrder(tx, id, a);
        return applyOrderEvent(ctx, tx, id, { type: 'buyer_cancelled' }, a);
      }).then((o) => ({ id: o.id, status: o.status }));
    });

    /** « J'ai reçu ma commande, tout est conforme » : libère le séquestre sans attendre 48 h. */
    app.post('/v1/orders/:id/confirm-receipt', async (request) => {
      const { id } = IdParam.parse(request.params);
      const a = actor(request, 'buyer');
      const o = await withTx(ctx.pool, async (tx) => {
        await ownedOrder(tx, id, a);
        return applyOrderEvent(ctx, tx, id, { type: 'buyer_confirmed_receipt' }, a);
      });
      return { id: o.id, status: o.status };
    });

    /** F12 : signaler un problème dans les 48 h suivant la remise. Le reversement est gelé. */
    app.post('/v1/orders/:id/disputes', async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const body = z
        .object({
          reason: z.enum([
            'not_received',
            'not_as_described',
            'damaged',
            'counterfeit',
            'missing_items',
            'other',
          ]),
          description: z.string().trim().min(10).max(2000),
        })
        .parse(request.body);
      const a = actor(request, 'buyer');
      const dispute = await withTx(ctx.pool, async (tx) => {
        await ownedOrder(tx, id, a);
        await applyOrderEvent(ctx, tx, id, { type: 'dispute_opened' }, a);
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO disputes (order_id, opened_by, reason, description, sla_due_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [
            id,
            a.userId,
            body.reason,
            body.description,
            addHours(now(), ctx.config.disputeSlaHours),
            now(),
          ],
        );
        return rows[0]!;
      });
      return reply.status(201).send({ id: dispute.id, status: 'open' });
    });

    /** SMS perdu : nouveau code de remise (l'ancien devient invalide). */
    app.post('/v1/orders/:id/handover-code', async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const a = actor(request, 'buyer');
      await withTx(ctx.pool, async (tx) => {
        await ownedOrder(tx, id, a);
        const code = randomDigits(6);
        const { rowCount } = await tx.query(
          `UPDATE deliveries SET handover_code_hash = $2, handover_attempts = 0
           WHERE order_id = $1 AND status IN ('awaiting_assignment', 'assigned', 'picked_up', 'at_pickup_point')`,
          [id, handoverHash(ctx, id, code)],
        );
        if (!rowCount)
          throw new HttpError(
            409,
            'handover_not_pending',
            'Aucune remise en attente pour cette commande',
          );
        await publish(tx, 'order.handover_code', { type: 'order', id }, { code }, now());
      });
      return reply.status(202).send({ sent: true });
    });

    /** F11 : noter un article reçu. Un seul avis par article, réservé à l'acheteur livré. */
    app.post('/v1/order-items/:id/review', async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const body = z
        .object({
          rating: z.int().min(1).max(5),
          comment: z.string().trim().max(2000).optional(),
          tags: z
            .array(z.enum(['conforme', 'livreur_ponctuel', 'bien_emballe']))
            .max(3)
            .default([]),
        })
        .parse(request.body);
      const a = actor(request, 'buyer');
      const review = await withTx(ctx.pool, async (tx) => {
        const { rows } = await tx.query<{
          product_id: string;
          seller_id: string;
          buyer_id: string;
          status: string;
        }>(
          `SELECT oi.product_id, o.seller_id, o.buyer_id, o.status
           FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = $1`,
          [id],
        );
        const item = rows[0];
        if (!item || item.buyer_id !== a.userId) throw notFound('Article');
        if (!['delivered', 'completed'].includes(item.status)) {
          throw new HttpError(
            409,
            'not_delivered',
            'Vous pourrez noter cet article après sa réception',
          );
        }
        const inserted = await tx.query<{ id: string }>(
          `INSERT INTO reviews (order_item_id, product_id, seller_id, buyer_id, rating, comment, tags, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (order_item_id) DO NOTHING RETURNING id`,
          [
            id,
            item.product_id,
            item.seller_id,
            a.userId,
            body.rating,
            body.comment ?? null,
            [...new Set(body.tags)],
            now(),
          ],
        );
        if (!inserted.rows[0])
          throw new HttpError(409, 'already_reviewed', 'Vous avez déjà noté cet article');
        await tx.query(
          `UPDATE seller_profiles s SET rating_count = agg.n, rating_avg = agg.avg
           FROM (SELECT count(*)::int AS n, round(avg(rating), 2) AS avg FROM reviews
                 WHERE seller_id = $1 AND NOT hidden) agg
           WHERE s.id = $1`,
          [item.seller_id],
        );
        return inserted.rows[0];
      });
      return reply.status(201).send({ id: review.id });
    });

    /** Photos à l'appui d'un litige (F12), visibles seulement par le support. */
    app.post('/v1/disputes/:id/evidence', async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const { uploadId } = z.object({ uploadId: z.uuid() }).parse(request.body);
      const a = actor(request, 'buyer');
      await withTx(ctx.pool, async (tx) => {
        const { rows } = await tx.query<{ status: string; buyer_id: string }>(
          `SELECT d.status, o.buyer_id FROM disputes d JOIN orders o ON o.id = d.order_id
           WHERE d.id = $1 FOR UPDATE OF d`,
          [id],
        );
        const dispute = rows[0];
        if (!dispute || dispute.buyer_id !== a.userId) throw notFound('Litige');
        if (dispute.status !== 'open')
          throw new HttpError(409, 'dispute_closed', 'Litige déjà tranché');
        const { rows: count } = await tx.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM dispute_evidence WHERE dispute_id = $1',
          [id],
        );
        if (count[0]!.n >= 6) throw new HttpError(409, 'too_many_files', '6 photos au maximum');
        const upload = await consumeUpload(ctx, tx, {
          uploadId,
          userId: a.userId!,
          purpose: 'dispute_evidence',
        });
        await tx.query(
          `INSERT INTO dispute_evidence (dispute_id, uploaded_by, storage_key, kind, upload_id)
           VALUES ($1, $2, $3, 'photo', $4)`,
          [id, a.userId, upload.storageKey, upload.id],
        );
      });
      return reply.status(201).send({ disputeId: id });
    });

    // ---------------- Vendeur ----------------
    app.register(async (seller) => {
      seller.addHook('preHandler', requireRole('seller'));

      /** Commandes de la boutique ; `?status=paid,preparing` pour la liste « À traiter ». */
      seller.get('/v1/seller/orders', async (request) => {
        const { status } = StatusFilter.parse(request.query);
        const sellerId = await sellerIdOf(ctx.pool, currentUser(request).id);
        return {
          items: await sellerOrderViews(
            ctx.pool,
            status ? 'o.seller_id = $1 AND o.status = ANY($2::order_status[])' : 'o.seller_id = $1',
            status ? [sellerId, status] : [sellerId],
          ),
        };
      });

      seller.get('/v1/seller/orders/:id', async (request) => {
        const { id } = IdParam.parse(request.params);
        const sellerId = await sellerIdOf(ctx.pool, currentUser(request).id);
        const [order] = await sellerOrderViews(ctx.pool, 'o.id = $1 AND o.seller_id = $2', [
          id,
          sellerId,
        ]);
        if (!order) throw notFound('Commande');
        return {
          ...order,
          history: await orderHistory(ctx.pool, id),
          ...(await sellerOrderExtras(ctx.pool, id)),
        };
      });

      const sellerAction = (
        path: string,
        event: (body: unknown) => Parameters<typeof applyOrderEvent>[3],
      ) =>
        seller.post(`/v1/seller/orders/:id/${path}`, async (request) => {
          const { id } = IdParam.parse(request.params);
          const a = actor(request, 'seller');
          const o = await withTx(ctx.pool, async (tx) => {
            await ownedOrder(tx, id, a);
            return applyOrderEvent(ctx, tx, id, event(request.body), a);
          });
          return { id: o.id, status: o.status };
        });

      /** Accepter, en promettant l'heure où le colis sera prêt (préparation par défaut sinon). */
      seller.post('/v1/seller/orders/:id/accept', async (request) => {
        const { id } = IdParam.parse(request.params);
        const { readyInMinutes } = z
          .object({ readyInMinutes: PrepMinutes.optional() })
          .parse(request.body ?? {});
        const a = actor(request, 'seller');
        const o = await withTx(ctx.pool, async (tx) => {
          await ownedOrder(tx, id, a);
          const updated = await applyOrderEvent(ctx, tx, id, { type: 'seller_accepted' }, a);
          await tx.query(
            `UPDATE orders o SET ready_promised_at = $2::timestamptz + make_interval(mins =>
               coalesce($3::int, (SELECT s.default_prep_minutes FROM seller_profiles s WHERE s.id = o.seller_id)))
             WHERE o.id = $1`,
            [id, ctx.clock.now(), readyInMinutes ?? null],
          );
          return updated;
        });
        return { id: o.id, status: o.status };
      });
      sellerAction('reject', (body) => ({
        type: 'seller_rejected',
        reason: z.object({ reason: z.string().trim().min(3).max(300) }).parse(body).reason,
      }));
      sellerAction('ready', () => ({ type: 'seller_marked_ready' }));

      /**
       * Réponse du vendeur à un litige : échanger, reprendre et rembourser, ou contester avec
       * preuves. Le support la lit avant de trancher ; modifiable tant que le litige est ouvert.
       */
      seller.post('/v1/seller/orders/:id/dispute-response', async (request) => {
        const { id } = IdParam.parse(request.params);
        const body = z
          .object({
            choice: z.enum(['exchange', 'take_back_refund', 'contest']),
            message: z.string().trim().max(1000).default(''),
          })
          .parse(request.body);
        const a = actor(request, 'seller');
        await withTx(ctx.pool, async (tx) => {
          await ownedOrder(tx, id, a);
          const { rows } = await tx.query<{ id: string }>(
            `UPDATE disputes SET seller_choice = $2, seller_message = nullif($3, ''), seller_responded_at = $4
             WHERE order_id = $1 AND status = 'open' RETURNING id`,
            [id, body.choice, body.message, ctx.clock.now()],
          );
          if (!rows[0]) throw new HttpError(409, 'no_open_dispute', 'Aucun litige ouvert');
          await audit(tx, a, 'dispute.seller_responded', { type: 'dispute', id: rows[0].id });
        });
        return sellerOrderExtras(ctx.pool, id).then((e) => e.dispute);
      });

      /** Photos du vendeur à l'appui de sa réponse (prises avant la remise). */
      seller.post('/v1/seller/orders/:id/dispute-evidence', async (request, reply) => {
        const { id } = IdParam.parse(request.params);
        const { uploadId } = z.object({ uploadId: z.uuid() }).parse(request.body);
        const a = actor(request, 'seller');
        await withTx(ctx.pool, async (tx) => {
          await ownedOrder(tx, id, a);
          const { rows } = await tx.query<{ id: string }>(
            `SELECT id FROM disputes WHERE order_id = $1 AND status = 'open' FOR UPDATE`,
            [id],
          );
          if (!rows[0]) throw new HttpError(409, 'no_open_dispute', 'Aucun litige ouvert');
          const { rows: count } = await tx.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM dispute_evidence WHERE dispute_id = $1 AND uploaded_by = $2',
            [rows[0].id, a.userId],
          );
          if (count[0]!.n >= 6) throw new HttpError(409, 'too_many_files', '6 photos au maximum');
          const upload = await consumeUpload(ctx, tx, {
            uploadId,
            userId: a.userId!,
            purpose: 'dispute_evidence',
          });
          await tx.query(
            `INSERT INTO dispute_evidence (dispute_id, uploaded_by, storage_key, kind, upload_id)
             VALUES ($1, $2, $3, 'photo', $4)`,
            [rows[0].id, a.userId, upload.storageKey, upload.id],
          );
        });
        return reply.status(201).send({ orderId: id });
      });
    });

    // ---------------- Support / administration ----------------
    app.register(async (staff) => {
      staff.addHook('preHandler', requireStaff(ctx));

      staff.post('/v1/support/orders/:id/cancel', async (request) => {
        const { id } = IdParam.parse(request.params);
        const { reason } = z
          .object({ reason: z.string().trim().min(3).max(300) })
          .parse(request.body);
        const o = await withTx(ctx.pool, (tx) =>
          applyOrderEvent(ctx, tx, id, { type: 'support_cancelled', reason }, staffActor(request)),
        );
        return { id: o.id, status: o.status };
      });

      staff.post('/v1/support/deliveries/:id/assign', async (request) => {
        const { id } = IdParam.parse(request.params);
        const { riderId } = z.object({ riderId: z.uuid() }).parse(request.body);
        const a = staffActor(request);
        await withTx(ctx.pool, async (tx) => {
          const { rows } = await tx.query<{ courier_partner_id: string }>(
            'SELECT courier_partner_id FROM riders WHERE id = $1 AND active',
            [riderId],
          );
          if (!rows[0]) throw notFound('Livreur');
          const { rowCount } = await tx.query(
            // Nouveau livreur, nouveau code de retrait : l'ancien ne permet plus de prendre le colis.
            `UPDATE deliveries SET rider_id = $2, courier_partner_id = $3, status = 'assigned', assigned_at = $4,
                    pickup_code = $5, pickup_confirmed_at = NULL
             WHERE order_id = $1 AND status IN ('awaiting_assignment', 'assigned')`,
            [id, riderId, rows[0].courier_partner_id, now(), randomDigits(4)],
          );
          if (!rowCount)
            throw new HttpError(
              409,
              'delivery_not_assignable',
              'Cette livraison ne peut plus être réassignée',
            );
          await audit(tx, a, 'delivery.assigned', { type: 'order', id }, { riderId });
        });
        return { orderId: id, riderId, status: 'assigned' };
      });

      /** Décision de litige (F12, F9) : reverser au vendeur, rembourser tout ou partie. */
      /** File des litiges ouverts, les plus urgents d'abord (SLA 72 h). */
      /** Litiges ouverts (les plus proches de l'échéance d'abord) ou résolus (`?status=resolved`). */
      staff.get('/v1/support/disputes', async (request) => {
        const { status } = z
          .object({ status: z.enum(['open', 'resolved']).default('open') })
          .parse(request.query);
        const { rows } = await ctx.pool.query(
          `SELECT d.id, d.reason, d.status, d.sla_due_at AS "slaDueAt", d.created_at AS "createdAt",
                  o.id AS "orderId", o.public_ref AS "publicRef", o.total,
                  s.shop_name AS "shopName",
                  coalesce(b.full_name, o.shipping_address->>'recipientName') AS "buyerName",
                  d.seller_choice AS "sellerChoice"
           FROM disputes d JOIN orders o ON o.id = d.order_id
           JOIN seller_profiles s ON s.id = o.seller_id JOIN users b ON b.id = o.buyer_id
           WHERE d.status = $1::dispute_status
           ORDER BY CASE WHEN $1 = 'open' THEN d.sla_due_at END, d.decided_at DESC NULLS LAST
           LIMIT 200`,
          [status],
        );
        const { rows: counts } = await ctx.pool.query<{ status: string; n: number }>(
          'SELECT status, count(*)::int AS n FROM disputes GROUP BY status',
        );
        return {
          counts: {
            open: counts.find((c) => c.status === 'open')?.n ?? 0,
            resolved: counts.find((c) => c.status === 'resolved')?.n ?? 0,
          },
          items: rows,
        };
      });

      /** Détail d'un litige avec preuves (URL signées de 5 min, consultation journalisée). */
      staff.get('/v1/support/disputes/:id', async (request) => {
        const { id } = IdParam.parse(request.params);
        const { rows } = await ctx.pool.query<{ orderId: string; openedBy: string }>(
          `SELECT d.id, d.order_id AS "orderId", d.reason, d.description, d.status, d.resolution,
                  d.refund_amount AS "refundAmount", d.decision_note AS "decisionNote",
                  d.sla_due_at AS "slaDueAt", d.created_at AS "createdAt",
                  d.seller_choice AS "sellerChoice", d.seller_message AS "sellerMessage",
                  d.seller_responded_at AS "sellerRespondedAt", d.opened_by AS "openedBy"
           FROM disputes d WHERE d.id = $1`,
          [id],
        );
        const dispute = rows[0];
        if (!dispute) throw notFound('Litige');
        const { rows: files } = await ctx.pool.query<{
          id: string;
          storage_key: string;
          kind: string;
          uploaded_by: string;
        }>(
          'SELECT id, storage_key, kind, uploaded_by FROM dispute_evidence WHERE dispute_id = $1 ORDER BY created_at',
          [id],
        );
        await audit(ctx.pool, staffActor(request), 'dispute.evidence_viewed', {
          type: 'dispute',
          id,
        });
        const [order] = await orderViews(ctx.pool, 'o.id = $1', [dispute.orderId]);
        const { openedBy, ...view } = dispute;
        return {
          ...view,
          order,
          evidence: await Promise.all(
            files.map(async (f) => ({
              id: f.id,
              kind: f.kind,
              from: f.uploaded_by === openedBy ? ('buyer' as const) : ('seller' as const),
              url: await ctx.storage.presignDownload({
                bucket: 'private',
                key: f.storage_key,
                expiresInSeconds: 300,
              }),
            })),
          ),
        };
      });

      staff.post('/v1/support/disputes/:id/resolve', async (request) => {
        const { id } = IdParam.parse(request.params);
        const body = z
          .object({
            resolution: z.enum(['release_to_seller', 'refund_full', 'refund_partial']),
            refundAmount: z.int().positive().optional(),
            note: z.string().trim().min(5).max(2000),
          })
          .parse(request.body);
        if (body.resolution === 'refund_partial' && !body.refundAmount) {
          throw new HttpError(
            400,
            'refund_amount_required',
            'Montant du remboursement partiel requis',
          );
        }
        const a = staffActor(request);
        const resolution =
          body.resolution === 'refund_partial'
            ? { kind: 'refund_partial' as const, amount: body.refundAmount! }
            : { kind: body.resolution };
        const order = await withTx(ctx.pool, async (tx) => {
          const { rows } = await tx.query<{ order_id: string; status: string }>(
            'SELECT order_id, status FROM disputes WHERE id = $1 FOR UPDATE',
            [id],
          );
          const dispute = rows[0];
          if (!dispute) throw notFound('Litige');
          if (dispute.status !== 'open')
            throw new HttpError(409, 'dispute_closed', 'Litige déjà tranché');
          const o = await applyOrderEvent(
            ctx,
            tx,
            dispute.order_id,
            { type: 'dispute_resolved', resolution },
            a,
          );
          await tx.query(
            `UPDATE disputes SET status = 'resolved', resolution = $2, refund_amount = $3, decided_by = $4,
                    decided_at = $5, decision_note = $6 WHERE id = $1`,
            [id, body.resolution, body.refundAmount ?? null, a.userId, now(), body.note],
          );
          await audit(
            tx,
            a,
            'dispute.resolved',
            { type: 'dispute', id },
            {
              resolution: body.resolution,
              refund: body.refundAmount ? formatXaf(body.refundAmount) : null,
            },
          );
          return o;
        });
        return { disputeId: id, orderId: order.id, orderStatus: order.status };
      });
    });
  };
}
