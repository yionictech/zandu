import { parseCongoMobile } from '@zandu/domain';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { requireAuth, requireStaff } from '../auth/guards.js';
import { orderViews } from '../orders/orders.service.js';

const IdParam = z.object({ id: z.uuid() });
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
/** Fenêtre des alertes de reversement et de remboursement en échec. */
const ALERT_DAYS = 30;

/** Journée en cours à Pointe-Noire (UTC+1), quelle que soit l'horloge du serveur. */
const TODAY = `date_trunc('day', $1::timestamptz AT TIME ZONE 'Africa/Brazzaville') AT TIME ZONE 'Africa/Brazzaville'`;

const ALERTS_SQL = `
  SELECT 'payout_failed' AS kind, p.id, p.order_id AS "orderId", o.public_ref AS "publicRef",
         p.amount, p.last_error AS message, p.updated_at AS "at"
  FROM payouts p LEFT JOIN orders o ON o.id = p.order_id
  WHERE p.status = 'failed' AND p.updated_at > $1::timestamptz - make_interval(days => $2)
  UNION ALL
  SELECT 'refund_failed', r.id, r.order_id, o.public_ref, r.amount, r.last_error, r.updated_at
  FROM refunds r LEFT JOIN orders o ON o.id = r.order_id
  WHERE r.status = 'failed' AND r.updated_at > $1::timestamptz - make_interval(days => $2)
  UNION ALL
  SELECT 'dispute_overdue', d.id, d.order_id, o.public_ref, o.total,
         'Litige sans décision au-delà de 72 h', d.sla_due_at
  FROM disputes d JOIN orders o ON o.id = d.order_id
  WHERE d.status = 'open' AND d.sla_due_at < $1`;

/**
 * Back-office (F16) : files de travail du support, recherche de commandes, alertes.
 * Lecture seule ; les décisions passent par les routes d'action existantes (journalisées).
 */
export function supportRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    app.addHook('preHandler', requireStaff(ctx));
    const now = () => ctx.clock.now();

    /** Tableau de bord : taille de chaque file et activité du jour. */
    app.get('/v1/support/overview', async () => {
      const { rows } = await ctx.pool.query(
        `SELECT
           (SELECT count(*)::int FROM seller_profiles WHERE verification_status = 'pending_review') AS "kycPending",
           (SELECT count(*)::int FROM products WHERE status = 'pending_review') AS "productsPending",
           (SELECT count(*)::int FROM deliveries d JOIN orders o ON o.id = d.order_id
             WHERE d.status = 'awaiting_assignment' AND o.status IN ('preparing', 'ready_for_pickup')) AS "deliveriesToAssign",
           (SELECT count(*)::int FROM disputes WHERE status = 'open') AS "disputesOpen",
           (SELECT count(*)::int FROM disputes WHERE status = 'open' AND sla_due_at < $1) AS "disputesOverdue",
           (SELECT count(*)::int FROM (${ALERTS_SQL}) a) AS "alerts",
           (SELECT count(*)::int FROM orders WHERE paid_at >= ${TODAY}) AS "paidOrders",
           (SELECT coalesce(sum(total), 0)::bigint FROM orders WHERE paid_at >= ${TODAY}) AS "paidAmount",
           (SELECT count(*)::int FROM orders WHERE completed_at >= ${TODAY}) AS "completedOrders",
           (SELECT count(*)::int FROM seller_profiles WHERE created_at >= ${TODAY}) AS "newShops"`,
        [now(), ALERT_DAYS],
      );
      const r = rows[0]!;
      return {
        queues: {
          kycPending: r.kycPending,
          productsPending: r.productsPending,
          deliveriesToAssign: r.deliveriesToAssign,
          disputesOpen: r.disputesOpen,
          disputesOverdue: r.disputesOverdue,
          alerts: r.alerts,
        },
        today: {
          paidOrders: r.paidOrders,
          paidAmount: Number(r.paidAmount),
          completedOrders: r.completedOrders,
          newShops: r.newShops,
        },
      };
    });

    /** Livraisons à assigner : colis prêts d'abord, puis commandes en préparation. */
    app.get('/v1/support/deliveries', async () => {
      const { rows } = await ctx.pool.query(
        `SELECT o.id AS "orderId", o.public_ref AS "publicRef", o.status AS "orderStatus",
                o.delivery_mode AS "deliveryMode", s.shop_name AS "shopName", pz.name AS "pickupZone",
                dz.name AS "destinationZone", dz.city, pp.name AS "pickupPoint", o.paid_at AS "paidAt",
                (SELECT max(h.created_at) FROM order_status_history h
                  WHERE h.order_id = o.id AND h.to_status = 'ready_for_pickup') AS "readyAt",
                (SELECT coalesce(sum(oi.quantity), 0)::int FROM order_items oi WHERE oi.order_id = o.id) AS "itemCount"
         FROM deliveries d JOIN orders o ON o.id = d.order_id
         JOIN seller_profiles s ON s.id = o.seller_id
         JOIN delivery_zones pz ON pz.id = s.pickup_zone_id
         JOIN delivery_zones dz ON dz.id = o.delivery_zone_id
         LEFT JOIN pickup_points pp ON pp.id = o.pickup_point_id
         WHERE d.status = 'awaiting_assignment' AND o.status IN ('preparing', 'ready_for_pickup')
         ORDER BY o.status = 'ready_for_pickup' DESC, o.paid_at
         LIMIT 200`,
      );
      return { items: rows };
    });

    /** Livreurs actifs et leur charge (missions en cours). */
    app.get('/v1/support/riders', async () => {
      const { rows } = await ctx.pool.query(
        `SELECT r.id, u.phone, u.full_name AS "name", cp.name AS "partner", z.name AS "zone",
                (SELECT count(*)::int FROM deliveries d
                  WHERE d.rider_id = r.id AND d.status IN ('assigned', 'picked_up', 'at_pickup_point')) AS "activeMissions"
         FROM riders r JOIN users u ON u.id = r.user_id
         JOIN courier_partners cp ON cp.id = r.courier_partner_id
         LEFT JOIN delivery_zones z ON z.id = r.zone_id
         WHERE r.active AND u.status = 'active'
         ORDER BY "activeMissions", u.phone`,
      );
      return { items: rows };
    });

    /**
     * Recherche universelle : référence (ZD-…) ou numéro de téléphone (acheteur, vendeur ou
     * destinataire). Sans critère : les 50 dernières commandes.
     */
    app.get('/v1/support/orders', async (request) => {
      const { q, status } = z
        .object({
          q: z.string().trim().max(40).optional(),
          /** Onglet de la liste : un ou plusieurs statuts séparés par des virgules. */
          status: z
            .string()
            .optional()
            .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
            .pipe(z.array(z.enum(ORDER_STATUSES)).optional()),
        })
        .parse(request.query);
      const statusFilter = status?.length ? status : null;
      let items;
      if (!q) {
        items = statusFilter
          ? await orderViews(ctx.pool, 'o.status = ANY($1::order_status[])', [statusFilter])
          : (await orderViews(ctx.pool, 'true', [])).slice(0, 50);
      } else {
        // « ZD-7K3M9Q2P », « zd7k3m9q2p » ou « 7K3M9Q2P » (8 caractères dont une lettre :
        // sinon c'est un numéro de téléphone saisi sans le 0).
        const compact = q.toUpperCase().replace(/[\s-]/g, '');
        const ref = compact.startsWith('ZD') ? compact.slice(2) : compact;
        if (/^[0-9A-Z]{8}$/.test(ref) && (compact.startsWith('ZD') || /[A-Z]/.test(ref))) {
          items = await orderViews(ctx.pool, 'o.public_ref = $1', [`ZD-${ref}`]);
        } else {
          let phone: string;
          try {
            phone = parseCongoMobile(q).e164;
          } catch {
            throw new HttpError(
              400,
              'invalid_search',
              'Saisissez une référence de commande (ZD-…) ou un numéro de téléphone',
            );
          }
          items = await orderViews(
            ctx.pool,
            `(o.buyer_id = (SELECT id FROM users WHERE phone = $1)
              OR s.user_id = (SELECT id FROM users WHERE phone = $1)
              OR o.shipping_address->>'phone' = $1)`,
            [phone],
          );
        }
        if (statusFilter) items = items.filter((o) => statusFilter.includes(o.status));
      }
      // Colonnes du tableau (maquette « Commandes ») : acheteur, livreur, opérateur payé.
      const { rows: extra } = await ctx.pool.query<{
        id: string;
        buyerName: string | null;
        riderName: string | null;
        operator: string | null;
      }>(
        `SELECT o.id, coalesce(b.full_name, o.shipping_address->>'recipientName') AS "buyerName",
                ru.full_name AS "riderName",
                (SELECT p.operator FROM payments p WHERE p.checkout_id = o.checkout_id AND p.status = 'succeeded'
                 ORDER BY p.succeeded_at DESC LIMIT 1) AS operator
         FROM orders o JOIN users b ON b.id = o.buyer_id
         LEFT JOIN deliveries d ON d.order_id = o.id LEFT JOIN riders r ON r.id = d.rider_id
         LEFT JOIN users ru ON ru.id = r.user_id
         WHERE o.id = ANY($1::uuid[])`,
        [items.map((o) => o.id)],
      );
      const byId = new Map(extra.map((e) => [e.id, e]));
      const { rows: counts } = await ctx.pool.query<{ status: string; n: number }>(
        'SELECT status, count(*)::int AS n FROM orders GROUP BY status',
      );
      return {
        counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
        items: items.map((o) => {
          const e = byId.get(o.id);
          return {
            ...o,
            buyerName: e?.buyerName ?? null,
            riderName: e?.riderName ?? null,
            operator: e?.operator ?? null,
          };
        }),
      };
    });

    /** Dossier complet d'une commande : argent (paiements, remboursements, reversement), livraison, litige. */
    app.get('/v1/support/orders/:id', async (request) => {
      const { id } = IdParam.parse(request.params);
      const [order] = await orderViews(ctx.pool, 'o.id = $1', [id]);
      if (!order) throw notFound('Commande');
      const q = async (sql: string) => (await ctx.pool.query(sql, [id])).rows;
      const [history, people, payments, refunds, payouts, deliveries, disputes] = await Promise.all(
        [
          q(`SELECT to_status AS status, event, created_at AS "at" FROM order_status_history
             WHERE order_id = $1 ORDER BY id`),
          q(`SELECT b.id AS "buyerId", b.phone AS "buyerPhone", b.full_name AS "buyerName",
                    su.phone AS "sellerPhone", s.verification_status AS "sellerVerification"
             FROM orders o JOIN users b ON b.id = o.buyer_id
             JOIN seller_profiles s ON s.id = o.seller_id JOIN users su ON su.id = s.user_id
             WHERE o.id = $1`),
          q(`SELECT p.id, p.status, p.operator, p.msisdn, p.amount, p.provider, p.late_success AS "lateSuccess",
                    p.failure_code AS "failureCode", p.failure_message AS "failureMessage",
                    p.created_at AS "createdAt", p.succeeded_at AS "succeededAt"
             FROM payments p JOIN orders o ON o.checkout_id = p.checkout_id
             WHERE o.id = $1 ORDER BY p.created_at`),
          q(`SELECT id, amount, status, reason, last_error AS "lastError", created_at AS "createdAt",
                    succeeded_at AS "succeededAt"
             FROM refunds WHERE order_id = $1 ORDER BY created_at`),
          q(`SELECT id, amount, status, operator, msisdn, attempts, last_error AS "lastError",
                    created_at AS "createdAt", succeeded_at AS "succeededAt"
             FROM payouts WHERE order_id = $1 ORDER BY created_at`),
          q(`SELECT d.status, d.handover_attempts AS "handoverAttempts", d.assigned_at AS "assignedAt",
                    d.picked_up_at AS "pickedUpAt", d.delivered_at AS "deliveredAt",
                    d.failure_reason AS "failureReason", u.phone AS "riderPhone", u.full_name AS "riderName"
             FROM deliveries d LEFT JOIN riders r ON r.id = d.rider_id LEFT JOIN users u ON u.id = r.user_id
             WHERE d.order_id = $1`),
          q(`SELECT id, status, reason, resolution, refund_amount AS "refundAmount",
                    sla_due_at AS "slaDueAt", created_at AS "createdAt",
                    seller_choice AS "sellerChoice", seller_message AS "sellerMessage",
                    seller_responded_at AS "sellerRespondedAt"
             FROM disputes WHERE order_id = $1`),
        ],
      );
      const p = people[0]!;
      return {
        ...order,
        history,
        buyer: { id: p.buyerId, phone: p.buyerPhone, name: p.buyerName },
        sellerContact: { phone: p.sellerPhone, verificationStatus: p.sellerVerification },
        payments,
        refunds,
        payouts,
        delivery: deliveries[0] ?? null,
        dispute: disputes[0] ?? null,
      };
    });

    /** Ce qui exige une intervention humaine : argent bloqué en échec, litiges en retard. */
    app.get('/v1/support/alerts', async () => {
      const { rows } = await ctx.pool.query(`${ALERTS_SQL} ORDER BY "at" LIMIT 200`, [
        now(),
        ALERT_DAYS,
      ]);
      return { items: rows.map((r) => ({ ...r, amount: Number(r.amount) })) };
    });
  };
}
