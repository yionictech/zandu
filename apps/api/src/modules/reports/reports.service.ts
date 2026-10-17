import { naturalBalance, PlatformAccounts } from '@zandu/domain';
import type { Db } from '../../db/pool.js';

/** Les journées comptables sont celles du Congo (UTC+1, sans heure d'été). */
export const REPORT_TIME_ZONE = 'Africa/Brazzaville';

/** Statuts où l'argent de la commande est encore au séquestre (commission pas encore acquise). */
const IN_ESCROW = `('paid', 'preparing', 'ready_for_pickup', 'in_delivery', 'awaiting_collection', 'delivered', 'disputed')`;

export interface Period {
  /** Premier jour, AAAA-MM-JJ (heure du Congo). */
  from: string;
  /** Dernier jour inclus. */
  to: string;
}

/** Bornes de la période en instants : $1 = premier jour, $2 = dernier jour (inclus). */
const PAID_IN_PERIOD = (column: string) =>
  `${column} >= ($1::date)::timestamp AT TIME ZONE '${REPORT_TIME_ZONE}'
   AND ${column} < ($2::date + 1)::timestamp AT TIME ZONE '${REPORT_TIME_ZONE}'`;

/** Mois civil en cours au Congo, de son premier jour à aujourd'hui. */
export function currentMonth(now: Date): Period {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIME_ZONE }).format(now);
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/**
 * Rapport d'activité d'une période (F16) :
 *   - ventes : commandes PAYÉES dans la période (date du paiement), y compris celles annulées
 *     ou remboursées depuis — leur part apparaît dans les remboursements ;
 *   - revenus : écritures du grand livre de la période — la commission n'est acquise qu'à la
 *     libération du séquestre, d'où la ligne « commissions à venir » ;
 *   - reversements et séquestre : état au moment du rapport.
 */
export async function activityReport(db: Db, period: Period) {
  const params = [period.from, period.to];

  const sales = await db.query<{
    orders: number;
    gmv: number;
    items: number;
    delivery: number;
    commission: number;
    cancelled: number;
  }>(
    `SELECT count(*)::int AS orders, coalesce(sum(total), 0)::bigint AS gmv,
            coalesce(sum(items_subtotal), 0)::bigint AS items,
            coalesce(sum(delivery_fee), 0)::bigint AS delivery,
            coalesce(sum(commission_total), 0)::bigint AS commission,
            (count(*) FILTER (WHERE status IN ('cancelled', 'refunded')))::int AS cancelled
     FROM orders WHERE ${PAID_IN_PERIOD('paid_at')}`,
    params,
  );
  const refunds = await db.query<{ count: number; amount: number }>(
    `SELECT count(*)::int AS count, coalesce(sum(amount), 0)::bigint AS amount
     FROM refunds WHERE status = 'succeeded' AND ${PAID_IN_PERIOD('succeeded_at')}`,
    params,
  );
  const ledger = await db.query<{ code: string; total: number }>(
    `SELECT a.code, coalesce(sum(e.amount), 0)::bigint AS total
     FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
     WHERE a.code = ANY($3) AND ${PAID_IN_PERIOD('e.created_at')}
     GROUP BY a.code`,
    [
      ...params,
      [
        PlatformAccounts.commissionRevenue,
        PlatformAccounts.deliveryRevenue,
        PlatformAccounts.paymentFees,
      ],
    ],
  );
  const booked = (code: string) =>
    naturalBalance(code, ledger.rows.find((r) => r.code === code)?.total ?? 0);
  const commission = booked(PlatformAccounts.commissionRevenue);
  const deliveryMargin = booked(PlatformAccounts.deliveryRevenue);
  const paymentFees = booked(PlatformAccounts.paymentFees);

  const daily = await db.query<{ date: string; orders: number; gmv: number }>(
    `SELECT to_char(d, 'YYYY-MM-DD') AS date, count(o.id)::int AS orders,
            coalesce(sum(o.total), 0)::bigint AS gmv
     FROM generate_series($1::date, $2::date, interval '1 day') AS d
     LEFT JOIN orders o ON o.paid_at IS NOT NULL
       AND (o.paid_at AT TIME ZONE '${REPORT_TIME_ZONE}')::date = d::date
     GROUP BY d ORDER BY d`,
    params,
  );

  // Catégories ramenées à leur racine (« Téléphones » compte dans « Électronique »).
  const categories = await db.query<{
    categoryId: string;
    name: string;
    orders: number;
    sales: number;
    commission: number;
  }>(
    `WITH RECURSIVE roots AS (
       SELECT id, id AS root FROM categories WHERE parent_id IS NULL
       UNION ALL
       SELECT c.id, r.root FROM categories c JOIN roots r ON c.parent_id = r.id
     )
     SELECT r.root AS "categoryId", c.name, count(DISTINCT o.id)::int AS orders,
            sum(i.line_total)::bigint AS sales, sum(i.commission_amount)::bigint AS commission
     FROM orders o
     JOIN order_items i ON i.order_id = o.id
     JOIN products p ON p.id = i.product_id
     JOIN roots r ON r.id = p.category_id
     JOIN categories c ON c.id = r.root
     WHERE ${PAID_IN_PERIOD('o.paid_at')}
     GROUP BY r.root, c.name ORDER BY sales DESC`,
    params,
  );
  const shops = await db.query<{
    sellerId: string;
    shopName: string;
    orders: number;
    sales: number;
    commission: number;
  }>(
    `SELECT s.id AS "sellerId", s.shop_name AS "shopName", count(*)::int AS orders,
            sum(o.items_subtotal)::bigint AS sales, sum(o.commission_total)::bigint AS commission
     FROM orders o JOIN seller_profiles s ON s.id = o.seller_id
     WHERE ${PAID_IN_PERIOD('o.paid_at')}
     GROUP BY s.id, s.shop_name ORDER BY sales DESC, s.shop_name LIMIT 10`,
    params,
  );

  const payouts = await db.query<{
    sent_count: number;
    sent_amount: number;
    failed_count: number;
    failed_amount: number;
    pending_count: number;
    pending_amount: number;
  }>(
    `SELECT (count(*) FILTER (WHERE status = 'succeeded' AND ${PAID_IN_PERIOD('succeeded_at')}))::int AS sent_count,
            coalesce(sum(amount) FILTER (WHERE status = 'succeeded' AND ${PAID_IN_PERIOD('succeeded_at')}), 0)::bigint AS sent_amount,
            (count(*) FILTER (WHERE status = 'failed' AND ${PAID_IN_PERIOD('updated_at')}))::int AS failed_count,
            coalesce(sum(amount) FILTER (WHERE status = 'failed' AND ${PAID_IN_PERIOD('updated_at')}), 0)::bigint AS failed_amount,
            (count(*) FILTER (WHERE status IN ('pending', 'processing')))::int AS pending_count,
            coalesce(sum(amount) FILTER (WHERE status IN ('pending', 'processing')), 0)::bigint AS pending_amount
     FROM payouts`,
    params,
  );
  const balances = await db.query<{ code: string; total: number }>(
    `SELECT a.code, coalesce(sum(e.amount), 0)::bigint AS total
     FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
     WHERE a.code = $1 OR a.code LIKE 'liability:seller_payable:%'
     GROUP BY a.code`,
    [PlatformAccounts.escrow],
  );
  const upcoming = await db.query<{ commission: number }>(
    `SELECT coalesce(sum(commission_total), 0)::bigint AS commission
     FROM orders WHERE status IN ${IN_ESCROW}`,
  );

  const s = sales.rows[0]!;
  const p = payouts.rows[0]!;
  return {
    period: { ...period, timeZone: REPORT_TIME_ZONE },
    sales: {
      paidOrders: s.orders,
      gmv: s.gmv,
      itemsSubtotal: s.items,
      deliveryFees: s.delivery,
      averageBasket: s.orders ? Math.round(s.gmv / s.orders) : 0,
      expectedCommission: s.commission,
      cancelledOrRefundedOrders: s.cancelled,
      refunds: refunds.rows[0]!,
    },
    revenue: {
      commission,
      deliveryMargin,
      paymentFees,
      net: commission + deliveryMargin - paymentFees,
      upcomingCommission: upcoming.rows[0]!.commission,
    },
    daily: daily.rows,
    categories: categories.rows.map((c) => ({
      ...c,
      averageRateBps: c.sales ? Math.round((c.commission * 10_000) / c.sales) : 0,
    })),
    topShops: shops.rows,
    payouts: {
      sent: { count: p.sent_count, amount: p.sent_amount },
      failed: { count: p.failed_count, amount: p.failed_amount },
      pending: { count: p.pending_count, amount: p.pending_amount },
      owedToSellers: balances.rows
        .filter((b) => b.code !== PlatformAccounts.escrow)
        .reduce((total, b) => total + naturalBalance(b.code, b.total), 0),
      inEscrow: naturalBalance(
        PlatformAccounts.escrow,
        balances.rows.find((b) => b.code === PlatformAccounts.escrow)?.total ?? 0,
      ),
    },
  };
}

const STATUS_FR: Record<string, string> = {
  pending_payment: 'en attente de paiement',
  paid: 'payée',
  preparing: 'en préparation',
  ready_for_pickup: 'prête',
  in_delivery: 'en livraison',
  awaiting_collection: 'au point relais',
  delivered: 'livrée',
  completed: 'terminée',
  disputed: 'en litige',
  refunded: 'remboursée',
  cancelled: 'annulée',
};

/**
 * Cellule CSV sûre : guillemets doublés, et neutralisation des formules (une boutique nommée
 * « =HYPERLINK(…) » ne doit rien exécuter dans le tableur du comptable).
 */
function cell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Commandes payées dans la période, pour le comptable : CSV au format des tableurs français
 * (séparateur « ; », UTF-8 avec BOM), montants en FCFA entiers.
 */
export async function ordersCsv(db: Db, period: Period): Promise<string> {
  const { rows } = await db.query<{
    ref: string;
    paid: string;
    shop: string;
    status: string;
    items: number;
    delivery: number;
    total: number;
    commission: number;
    refunded: number;
    paid_out: number;
  }>(
    `SELECT o.public_ref AS ref,
            to_char(o.paid_at AT TIME ZONE '${REPORT_TIME_ZONE}', 'YYYY-MM-DD HH24:MI') AS paid,
            s.shop_name AS shop, o.status::text AS status, o.items_subtotal AS items,
            o.delivery_fee AS delivery, o.total, o.commission_total AS commission,
            o.refunded_amount AS refunded,
            (SELECT coalesce(sum(py.amount), 0)::bigint FROM payouts py
             WHERE py.order_id = o.id AND py.status = 'succeeded') AS paid_out
     FROM orders o JOIN seller_profiles s ON s.id = o.seller_id
     WHERE ${PAID_IN_PERIOD('o.paid_at')}
     ORDER BY o.paid_at, o.public_ref`,
    [period.from, period.to],
  );
  const header = [
    'Référence',
    'Payée le',
    'Boutique',
    'Statut',
    'Articles (FCFA)',
    'Livraison (FCFA)',
    'Total payé (FCFA)',
    'Commission (FCFA)',
    'Remboursé (FCFA)',
    'Versé au vendeur (FCFA)',
  ];
  const lines = rows.map((r) =>
    [
      r.ref,
      r.paid,
      r.shop,
      STATUS_FR[r.status] ?? r.status,
      r.items,
      r.delivery,
      r.total,
      r.commission,
      r.refunded,
      r.paid_out,
    ]
      .map(cell)
      .join(';'),
  );
  return `﻿${[header.map(cell).join(';'), ...lines].join('\r\n')}\r\n`;
}
