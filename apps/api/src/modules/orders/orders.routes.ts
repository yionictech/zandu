import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { formatXaf } from '@zandu/domain';
import type { Actor, AppContext } from '../../context.js';
import { withTx, type Db, type Tx } from '../../db/pool.js';
import { addHours } from '../../lib/clock.js';
import { randomDigits, safeEqualHex } from '../../lib/crypto.js';
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

/**
 * Mission vue par le livreur : où enlever (boutique, téléphone pour s'annoncer), où livrer
 * (repère, téléphone du destinataire), combien de codes erronés restent permis.
 * Le paiement est déjà fait : le livreur n'encaisse jamais d'argent.
 */
async function riderMissions(
  ctx: AppContext,
  where: string,
  params: unknown[],
): Promise<Array<Record<string, unknown>>> {
  const { rows } = await ctx.pool.query<{ handoverAttempts: number } & Record<string, unknown>>(
    `SELECT d.order_id AS "orderId", d.status, o.status AS "orderStatus", o.public_ref AS "publicRef",
            o.delivery_mode AS "deliveryMode", o.shipping_address AS "recipient",
            json_build_object('shopName', s.shop_name, 'phone', su.phone, 'city', s.city, 'zone', pz.name) AS "pickup",
            json_build_object('city', dz.city, 'zone', dz.name,
                              'pickupPoint', CASE WHEN pp.id IS NULL THEN NULL
                                                  ELSE json_build_object('name', pp.name, 'landmark', pp.landmark) END) AS "destination",
            (SELECT coalesce(sum(oi.quantity), 0)::int FROM order_items oi WHERE oi.order_id = o.id) AS "itemCount",
            d.handover_attempts AS "handoverAttempts", d.assigned_at AS "assignedAt", d.picked_up_at AS "pickedUpAt"
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
  }));
}

async function riderDelivery(tx: Tx, orderId: string, a: Actor) {
  const rider = await riderOf(tx, a.userId);
  const { rows } = await tx.query<{
    id: string;
    status: string;
    handover_code_hash: string;
    handover_attempts: number;
  }>(
    'SELECT id, status, handover_code_hash, handover_attempts FROM deliveries WHERE order_id = $1 AND rider_id = $2 FOR UPDATE',
    [orderId, rider.id],
  );
  if (!rows[0]) throw notFound('Livraison');
  return rows[0];
}

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

    // ---------------- Livreur partenaire ----------------
    app.register(async (rider) => {
      rider.addHook('preHandler', requireRole('rider'));

      rider.get('/v1/rider/deliveries', async (request) => {
        const r = await riderOf(ctx.pool, currentUser(request).id);
        return {
          items: await riderMissions(
            ctx,
            `d.rider_id = $1 AND d.status IN ('assigned', 'picked_up', 'at_pickup_point')`,
            [r.id],
          ),
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

      rider.post('/v1/rider/deliveries/:id/pickup', async (request) => {
        const { id } = IdParam.parse(request.params);
        const a = actor(request, 'rider');
        const o = await withTx(ctx.pool, async (tx) => {
          const d = await riderDelivery(tx, id, a);
          if (d.status !== 'assigned')
            throw new HttpError(409, 'invalid_delivery_status', 'Colis déjà récupéré');
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
          await tx.query(`UPDATE deliveries SET status = 'at_pickup_point' WHERE id = $1`, [d.id]);
          return applyOrderEvent(ctx, tx, id, { type: 'arrived_at_pickup_point' }, a);
        });
        return { id: o.id, status: o.status };
      });

      /** Remise en main propre : le livreur saisit le code que l'acheteur lui donne. */
      rider.post('/v1/rider/deliveries/:id/handover', async (request) => {
        const { id } = IdParam.parse(request.params);
        const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(request.body);
        const a = actor(request, 'rider');
        const result = await withTx(ctx.pool, async (tx) => {
          const d = await riderDelivery(tx, id, a);
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
          const order = await applyOrderEvent(ctx, tx, id, { type: 'delivery_failed', reason }, a);
          await tx.query(
            `INSERT INTO disputes (order_id, opened_by, reason, description, sla_due_at, created_at)
             VALUES ($1, $2, 'not_received', $3, $4, $5)`,
            [
              id,
              a.userId,
              `Livraison impossible : ${reason}`,
              addHours(now(), ctx.config.disputeSlaHours),
              now(),
            ],
          );
          return order;
        });
        return { id: o.id, status: o.status };
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
            `UPDATE deliveries SET rider_id = $2, courier_partner_id = $3, status = 'assigned', assigned_at = $4
             WHERE order_id = $1 AND status IN ('awaiting_assignment', 'assigned')`,
            [id, riderId, rows[0].courier_partner_id, now()],
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
      staff.get('/v1/support/disputes', async () => {
        const { rows } = await ctx.pool.query(
          `SELECT d.id, d.reason, d.status, d.sla_due_at AS "slaDueAt", d.created_at AS "createdAt",
                  o.id AS "orderId", o.public_ref AS "publicRef", o.total
           FROM disputes d JOIN orders o ON o.id = d.order_id
           WHERE d.status = 'open' ORDER BY d.sla_due_at LIMIT 200`,
        );
        return { items: rows };
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
