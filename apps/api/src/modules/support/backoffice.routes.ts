import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { withTx } from '../../db/pool.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { audit } from '../admin/audit.js';
import { currentUser, requireAuth, requireStaff, staffActor } from '../auth/guards.js';
import { publish } from '../notifications/outbox.js';
import { ACCEPTANCE_CHOICES, acceptanceSetting } from '../settings/settings.js';

const IdParam = z.object({ id: z.uuid() });
const Period = z.object({ period: z.enum(['today', '7d', '30d']).default('today') });
const PERIOD_DAYS = { today: 1, '7d': 7, '30d': 30 } as const;

/** Début de la période, en jours entiers à l'heure de Brazzaville ($1 = maintenant, $2 = jours). */
const SINCE = `(date_trunc('day', $1::timestamptz AT TIME ZONE 'Africa/Brazzaville')
                 - make_interval(days => $2::int - 1)) AT TIME ZONE 'Africa/Brazzaville'`;

/** Commandes dont l'argent est encore en séquestre (payées, pas encore terminées). */
const IN_ESCROW = `('paid', 'preparing', 'ready_for_pickup', 'in_delivery', 'awaiting_collection', 'delivered', 'disputed')`;

/**
 * Écrans du back-office redessiné (maquettes Admin, docs/ux/03 §9) : vue d'ensemble, paiements,
 * clients, relance d'un vendeur, réglages en lecture. Les décisions restent sur les routes
 * d'action existantes, journalisées.
 */
export function backofficeRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    app.addHook('preHandler', requireStaff(ctx));
    const now = () => ctx.clock.now();
    const isAdmin = (request: Parameters<typeof currentUser>[0]) =>
      currentUser(request).roles.includes('admin');

    /**
     * Vue d'ensemble : volume, argent bloqué, commissions (administrateurs), litiges ; commandes
     * des 14 derniers jours ; ce qui attend une action.
     */
    app.get('/v1/support/dashboard', async (request) => {
      const { period } = Period.parse(request.query);
      const days = PERIOD_DAYS[period];
      const { rows } = await ctx.pool.query(
        `SELECT
           (SELECT count(*)::int FROM orders WHERE paid_at >= ${SINCE}) AS "paidOrders",
           (SELECT coalesce(sum(total), 0)::bigint FROM orders WHERE paid_at >= ${SINCE}) AS "volume",
           (SELECT coalesce(sum(commission_total), 0)::bigint FROM orders
             WHERE paid_at >= ${SINCE} AND status NOT IN ('cancelled', 'refunded')) AS "commission",
           (SELECT coalesce(sum(items_subtotal), 0)::bigint FROM orders
             WHERE paid_at >= ${SINCE} AND status NOT IN ('cancelled', 'refunded')) AS "itemsSubtotal",
           (SELECT count(*)::int FROM orders WHERE status IN ${IN_ESCROW}) AS "escrowOrders",
           (SELECT coalesce(sum(total - refunded_amount), 0)::bigint FROM orders
             WHERE status IN ${IN_ESCROW}) AS "escrowAmount",
           (SELECT count(*)::int FROM disputes WHERE status = 'open') AS "disputesOpen",
           (SELECT count(*)::int FROM disputes WHERE status = 'open'
             AND sla_due_at < date_trunc('day', $1::timestamptz AT TIME ZONE 'Africa/Brazzaville')
                              AT TIME ZONE 'Africa/Brazzaville' + interval '1 day') AS "disputesDueToday",
           (SELECT count(*)::int FROM seller_profiles WHERE verification_status = 'pending_review') AS "kycPending",
           (SELECT count(*)::int FROM products WHERE status = 'pending_review') AS "productsPending",
           (SELECT count(*)::int FROM deliveries d JOIN orders o ON o.id = d.order_id
             WHERE d.status = 'awaiting_assignment' AND o.status IN ('preparing', 'ready_for_pickup')) AS "deliveriesToAssign",
           (SELECT count(*)::int FROM payouts WHERE status = 'failed') +
           (SELECT count(*)::int FROM refunds WHERE status = 'failed') AS "moneyFailures"`,
        [now(), days],
      );
      const r = rows[0]!;
      const { rows: firstDispute } = await ctx.pool.query(
        `SELECT o.public_ref AS "publicRef", d.reason, d.id FROM disputes d JOIN orders o ON o.id = d.order_id
         WHERE d.status = 'open' ORDER BY d.sla_due_at LIMIT 1`,
      );
      const { rows: daily } = await ctx.pool.query(
        `SELECT to_char(day, 'YYYY-MM-DD') AS date,
                (SELECT count(*)::int FROM orders o
                  WHERE (o.paid_at AT TIME ZONE 'Africa/Brazzaville')::date = day) AS orders
         FROM generate_series(($1::timestamptz AT TIME ZONE 'Africa/Brazzaville')::date - 13,
                              ($1::timestamptz AT TIME ZONE 'Africa/Brazzaville')::date, interval '1 day') AS day
         ORDER BY day`,
        [now()],
      );
      const admin = isAdmin(request);
      return {
        period,
        volume: { amount: Number(r.volume), paidOrders: r.paidOrders },
        escrow: { amount: Number(r.escrowAmount), orders: r.escrowOrders },
        // Chiffre d'affaires : administrateurs seulement (comme les rapports).
        commission: admin
          ? {
              amount: Number(r.commission),
              rateBps:
                Number(r.itemsSubtotal) > 0
                  ? Math.round((Number(r.commission) / Number(r.itemsSubtotal)) * 10_000)
                  : 0,
            }
          : null,
        disputes: {
          open: r.disputesOpen,
          dueToday: r.disputesDueToday,
          first: firstDispute[0] ?? null,
        },
        todo: {
          kycPending: r.kycPending,
          productsPending: r.productsPending,
          deliveriesToAssign: r.deliveriesToAssign,
          moneyFailures: r.moneyFailures,
        },
        daily,
      };
    });

    /**
     * Paiements : encaissé, en séquestre, libéré aux vendeurs, échecs ; répartition par
     * opérateur ; mouvements (encaissements, reversements, remboursements).
     */
    app.get('/v1/support/payments', async (request) => {
      const { period, kind } = Period.extend({
        kind: z.enum(['all', 'in', 'out']).default('all'),
      }).parse(request.query);
      const days = PERIOD_DAYS[period];
      const params = [now(), days];
      const { rows } = await ctx.pool.query(
        `SELECT
           (SELECT coalesce(sum(amount), 0)::bigint FROM payments WHERE status = 'succeeded' AND succeeded_at >= ${SINCE}) AS collected,
           (SELECT count(*)::int FROM payments WHERE status = 'succeeded' AND succeeded_at >= ${SINCE}) AS "collectedCount",
           (SELECT coalesce(sum(total - refunded_amount), 0)::bigint FROM orders WHERE status IN ${IN_ESCROW}) AS escrow,
           (SELECT coalesce(sum(amount), 0)::bigint FROM payouts WHERE status = 'succeeded' AND succeeded_at >= ${SINCE}) AS released,
           (SELECT count(DISTINCT seller_id)::int FROM payouts WHERE status = 'succeeded' AND succeeded_at >= ${SINCE}) AS "releasedSellers",
           (SELECT count(*)::int FROM payouts WHERE status IN ('pending', 'processing')) AS "payoutsPending",
           (SELECT count(*)::int FROM payouts WHERE status = 'failed') +
           (SELECT count(*)::int FROM refunds WHERE status = 'failed') AS failures`,
        params,
      );
      const { rows: operators } = await ctx.pool.query<{ operator: string; amount: string }>(
        `SELECT operator, coalesce(sum(amount), 0)::bigint AS amount FROM payments
         WHERE status = 'succeeded' AND succeeded_at >= ${SINCE} GROUP BY operator ORDER BY operator`,
        params,
      );
      const inSql = `SELECT 'collection' AS kind, coalesce(p.succeeded_at, p.created_at) AS at,
                       (SELECT string_agg(o.public_ref, ', ') FROM orders o WHERE o.checkout_id = p.checkout_id) AS reference,
                       NULL::text AS beneficiary, p.operator::text AS operator, p.amount, p.status::text AS status
                     FROM payments p WHERE p.status IN ('succeeded', 'failed')`;
      const outSql = `SELECT 'payout' AS kind, coalesce(po.succeeded_at, po.created_at) AS at, o.public_ref AS reference,
                        s.shop_name AS beneficiary, po.operator::text AS operator, -po.amount AS amount, po.status::text AS status
                      FROM payouts po JOIN seller_profiles s ON s.id = po.seller_id LEFT JOIN orders o ON o.id = po.order_id
                      UNION ALL
                      SELECT 'refund', coalesce(r.succeeded_at, r.created_at), o.public_ref,
                        coalesce(b.full_name, o.shipping_address->>'recipientName'), pa.operator::text, -r.amount, r.status::text
                      FROM refunds r JOIN payments pa ON pa.id = r.payment_id LEFT JOIN orders o ON o.id = r.order_id
                      LEFT JOIN users b ON b.id = pa.buyer_id`;
      const movementsSql =
        kind === 'in' ? inSql : kind === 'out' ? outSql : `${inSql} UNION ALL ${outSql}`;
      const { rows: movements } = await ctx.pool.query(
        `SELECT * FROM (${movementsSql}) m ORDER BY at DESC LIMIT 100`,
      );
      const r = rows[0]!;
      return {
        period,
        collected: { amount: Number(r.collected), count: r.collectedCount },
        escrow: Number(r.escrow),
        released: { amount: Number(r.released), sellers: r.releasedSellers },
        payoutsPending: r.payoutsPending,
        failures: r.failures,
        byOperator: operators.map((o) => ({ operator: o.operator, amount: Number(o.amount) })),
        movements: movements.map((m) => ({ ...m, amount: Number(m.amount) })),
      };
    });

    /** Clients (acheteurs) : recherche par nom ou numéro ; commandes, montant payé, litiges. */
    app.get('/v1/support/customers', async (request) => {
      const { q } = z.object({ q: z.string().trim().max(60).optional() }).parse(request.query);
      const digits = q?.replace(/\D/g, '') ?? '';
      const { rows } = await ctx.pool.query(
        `SELECT u.id, u.full_name AS name, u.phone, u.status, u.created_at AS "createdAt",
                (SELECT z.city FROM orders o JOIN delivery_zones z ON z.id = o.delivery_zone_id
                  WHERE o.buyer_id = u.id ORDER BY o.created_at DESC LIMIT 1) AS city,
                (SELECT count(*)::int FROM orders o WHERE o.buyer_id = u.id AND o.paid_at IS NOT NULL) AS orders,
                (SELECT coalesce(sum(o.total - o.refunded_amount), 0)::bigint FROM orders o
                  WHERE o.buyer_id = u.id AND o.paid_at IS NOT NULL) AS paid,
                (SELECT count(*)::int FROM disputes d JOIN orders o ON o.id = d.order_id WHERE o.buyer_id = u.id) AS disputes
         FROM users u
         WHERE 'buyer' = ANY(u.roles) AND NOT u.roles && ARRAY['support', 'admin']::user_role[]
           AND ($1::text = '' OR f_unaccent(lower(coalesce(u.full_name, ''))) LIKE '%' || f_unaccent(lower($1)) || '%'
                OR ($2::text <> '' AND u.phone LIKE '%' || $2 || '%'))
           AND (EXISTS (SELECT 1 FROM orders o WHERE o.buyer_id = u.id) OR $1::text <> '')
         ORDER BY (SELECT max(o.created_at) FROM orders o WHERE o.buyer_id = u.id) DESC NULLS LAST
         LIMIT 100`,
        [q ?? '', digits.length >= 3 ? digits.replace(/^0/, '') : ''],
      );
      return { items: rows.map((r) => ({ ...r, paid: Number(r.paid) })) };
    });

    /** Fiche d'un client : adresses de livraison déjà utilisées, dernière activité, commandes. */
    app.get('/v1/support/customers/:id', async (request) => {
      const { id } = IdParam.parse(request.params);
      const { rows } = await ctx.pool.query(
        `SELECT u.id, u.full_name AS name, u.phone, u.status, u.created_at AS "createdAt",
                (SELECT count(*)::int FROM orders o WHERE o.buyer_id = u.id AND o.paid_at IS NOT NULL) AS orders,
                (SELECT coalesce(sum(o.total - o.refunded_amount), 0)::bigint FROM orders o
                  WHERE o.buyer_id = u.id AND o.paid_at IS NOT NULL) AS paid,
                (SELECT count(*)::int FROM disputes d JOIN orders o ON o.id = d.order_id WHERE o.buyer_id = u.id) AS disputes
         FROM users u WHERE u.id = $1 AND 'buyer' = ANY(u.roles)`,
        [id],
      );
      if (!rows[0]) throw notFound('Client');
      const { rows: addresses } = await ctx.pool.query(
        `SELECT DISTINCT ON (z.id, o.shipping_address->>'landmark')
                z.name AS zone, z.city, o.shipping_address->>'landmark' AS landmark
         FROM orders o JOIN delivery_zones z ON z.id = o.delivery_zone_id
         WHERE o.buyer_id = $1 AND o.delivery_mode = 'home'
         ORDER BY z.id, o.shipping_address->>'landmark', o.created_at DESC LIMIT 5`,
        [id],
      );
      const { rows: recent } = await ctx.pool.query(
        `SELECT o.id, o.public_ref AS "publicRef", o.status, o.total, o.created_at AS "createdAt",
                s.shop_name AS "shopName",
                (SELECT d.id FROM disputes d WHERE d.order_id = o.id) AS "disputeId",
                (SELECT d.reason FROM disputes d WHERE d.order_id = o.id) AS "disputeReason"
         FROM orders o JOIN seller_profiles s ON s.id = o.seller_id
         WHERE o.buyer_id = $1 ORDER BY o.created_at DESC LIMIT 10`,
        [id],
      );
      await audit(ctx.pool, staffActor(request), 'customer.viewed', { type: 'user', id });
      return {
        ...rows[0],
        paid: Number(rows[0].paid),
        addresses,
        recentOrders: recent.map((o) => ({ ...o, total: Number(o.total) })),
      };
    });

    /**
     * Bloquer ou débloquer un compte client (fraude, comportement abusif) : ses sessions sont
     * fermées. Motif obligatoire, journalisé.
     */
    app.post('/v1/support/customers/:id/status', async (request) => {
      const { id } = IdParam.parse(request.params);
      const body = z
        .object({
          status: z.enum(['active', 'suspended']),
          reason: z.string().trim().min(5).max(500),
        })
        .parse(request.body);
      const a = staffActor(request);
      if (a.userId === id)
        throw new HttpError(409, 'self_block', 'Vous ne pouvez pas bloquer votre compte');
      await withTx(ctx.pool, async (tx) => {
        const { rows } = await tx.query<{ roles: string[] }>(
          `UPDATE users SET status = $2::user_status WHERE id = $1 AND 'buyer' = ANY(roles)
             AND NOT roles && ARRAY['support', 'admin']::user_role[]
           RETURNING roles`,
          [id, body.status],
        );
        if (!rows[0]) throw notFound('Client');
        if (body.status === 'suspended') {
          await tx.query(
            'UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL',
            [id, now()],
          );
        }
        await audit(
          tx,
          a,
          body.status === 'suspended' ? 'customer.blocked' : 'customer.unblocked',
          { type: 'user', id },
          { reason: body.reason },
        );
      });
      return { id, status: body.status };
    });

    /** « Relancer le vendeur » : rappel de répondre au litige avant l'échéance. */
    app.post('/v1/support/disputes/:id/remind-seller', async (request) => {
      const { id } = IdParam.parse(request.params);
      const a = staffActor(request);
      await withTx(ctx.pool, async (tx) => {
        const { rows } = await tx.query<{
          order_id: string;
          sla_due_at: Date;
          seller_choice: string | null;
        }>(
          `SELECT order_id, sla_due_at, seller_choice FROM disputes WHERE id = $1 AND status = 'open' FOR UPDATE`,
          [id],
        );
        const dispute = rows[0];
        if (!dispute) throw new HttpError(409, 'dispute_closed', 'Litige déjà tranché');
        if (dispute.seller_choice)
          throw new HttpError(409, 'seller_answered', 'Le vendeur a déjà répondu');
        await publish(
          tx,
          'order.dispute_reminder',
          { type: 'order', id: dispute.order_id },
          { slaDueAt: dispute.sla_due_at.toISOString() },
          now(),
        );
        await audit(tx, a, 'dispute.seller_reminded', { type: 'dispute', id });
      });
      return { id, reminded: true };
    });

    /**
     * Réglages en vigueur (lecture) : commission par défaut, tarifs de livraison, délais. Ils se
     * changent aujourd'hui par la configuration et les règles de commission ; le réglage à
     * l'écran viendra avec le délai d'acceptation (docs/ux/03 §4.4).
     */
    const settings = async () => {
      const { rows: rule } = await ctx.pool.query<{ rate_bps: number }>(
        `SELECT rate_bps FROM commission_rules
         WHERE scope = 'default' AND valid_from <= $1 AND (valid_to IS NULL OR valid_to > $1)
         ORDER BY valid_from DESC LIMIT 1`,
        [now()],
      );
      const { rows: rates } = await ctx.pool.query<{
        city: string;
        mode: 'home' | 'pickup_point';
        min: string;
        max: string;
      }>(
        `SELECT z.city, r.mode, min(r.price)::bigint AS min, max(r.price)::bigint AS max
         FROM delivery_rates r JOIN delivery_zones z ON z.id = r.to_zone_id
         WHERE r.active GROUP BY z.city, r.mode ORDER BY z.city, r.mode`,
      );
      const policy = ctx.config.orderPolicy;
      const acceptance = await acceptanceSetting(ctx, ctx.pool);
      return {
        money: {
          defaultCommissionBps: rule[0]?.rate_bps ?? null,
          deliveryRates: rates.map((r) => ({
            city: r.city,
            mode: r.mode,
            min: Number(r.min),
            max: Number(r.max),
          })),
          newSellerPayoutCap: ctx.config.payoutPolicy.newSellerCapAmount,
        },
        delays: {
          sellerAcceptanceHours: acceptance.minutes / 60,
          sellerAcceptance: { ...acceptance, choices: [...ACCEPTANCE_CHOICES] },
          disputeWindowHours: policy.disputeWindowHours,
          disputeSlaHours: ctx.config.disputeSlaHours,
          pushFallbackMinutes: ctx.config.pushFallbackMinutes,
        },
      };
    };

    /** Réglages en vigueur (administrateurs). */
    app.get('/v1/admin/settings', async (request) => {
      if (!isAdmin(request)) throw new HttpError(403, 'forbidden', 'Réservé aux administrateurs');
      return settings();
    });

    /**
     * Délai d'acceptation du vendeur (docs/ux/03 §4.4) : choisi parmi des valeurs fixes, avec un
     * motif, journalisé. Il s'applique aux commandes payées après le changement ; les délais
     * déjà donnés aux vendeurs ne bougent pas.
     */
    app.patch('/v1/admin/settings', async (request) => {
      if (!isAdmin(request)) throw new HttpError(403, 'forbidden', 'Réservé aux administrateurs');
      const body = z
        .object({
          sellerAcceptanceMinutes: z
            .number()
            .int()
            .refine((m) => (ACCEPTANCE_CHOICES as readonly number[]).includes(m), {
              message: `Valeurs possibles : ${ACCEPTANCE_CHOICES.join(', ')} minutes`,
            }),
          reason: z.string().trim().min(5).max(300),
        })
        .parse(request.body);
      const a = staffActor(request);
      await withTx(ctx.pool, async (tx) => {
        const before = await acceptanceSetting(ctx, tx);
        await tx.query(
          `INSERT INTO platform_settings (key, value, updated_by, updated_at)
           VALUES ('seller_acceptance_minutes', $1::jsonb, $2, $3)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by,
                                           updated_at = EXCLUDED.updated_at`,
          [JSON.stringify(body.sellerAcceptanceMinutes), a.userId, now()],
        );
        await audit(
          tx,
          a,
          'settings.seller_acceptance',
          { type: 'setting', id: 'seller_acceptance_minutes' },
          { from: before.minutes, to: body.sellerAcceptanceMinutes, reason: body.reason },
        );
      });
      return settings();
    });
  };
}
