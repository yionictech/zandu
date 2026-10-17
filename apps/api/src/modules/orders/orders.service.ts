import {
  releaseEscrow,
  transitionOrder,
  type OrderEffect,
  type OrderEvent,
  type OrderSnapshot,
  type OrderStatus,
} from '@zandu/domain';
import type { Actor, AppContext } from '../../context.js';
import type { Db, Tx } from '../../db/pool.js';
import { hmac, randomDigits } from '../../lib/crypto.js';
import { notFound } from '../../lib/errors.js';
import { audit } from '../admin/audit.js';
import { postJournal } from '../ledger/ledger.repository.js';
import { publish } from '../notifications/outbox.js';
import { createRefund } from '../payments/refunds.service.js';
import { schedulePayout } from '../payouts/payouts.service.js';

export interface OrderRow {
  id: string;
  public_ref: string;
  checkout_id: string;
  buyer_id: string;
  seller_id: string;
  status: OrderStatus;
  items_subtotal: number;
  delivery_fee: number;
  courier_share: number;
  commission_total: number;
  total: number;
  refunded_amount: number;
  currency: string;
  delivery_mode: 'home' | 'pickup_point';
  delivery_zone_id: string;
  pickup_point_id: string | null;
  shipping_address: Record<string, unknown>;
  seller_accept_deadline: Date | null;
  dispute_window_ends_at: Date | null;
  paid_at: Date | null;
  delivered_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  version: number;
  created_at: Date;
}

export async function lockOrder(tx: Tx, orderId: string): Promise<OrderRow> {
  const { rows } = await tx.query<OrderRow>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [
    orderId,
  ]);
  if (!rows[0]) throw notFound('Commande');
  return rows[0];
}

export function toSnapshot(row: OrderRow): OrderSnapshot {
  return {
    status: row.status,
    itemsSubtotal: row.items_subtotal,
    deliveryFee: row.delivery_fee,
    total: row.total,
    refundedAmount: row.refunded_amount,
    deliveryMode: row.delivery_mode,
    sellerAcceptDeadline: row.seller_accept_deadline,
    disputeWindowEndsAt: row.dispute_window_ends_at,
  };
}

const PATCH_COLUMNS = {
  paidAt: 'paid_at',
  deliveredAt: 'delivered_at',
  completedAt: 'completed_at',
  cancelledAt: 'cancelled_at',
  cancelReason: 'cancel_reason',
  sellerAcceptDeadline: 'seller_accept_deadline',
  disputeWindowEndsAt: 'dispute_window_ends_at',
  refundedAmount: 'refunded_amount',
} as const;

/**
 * Point d'entrée UNIQUE pour faire évoluer une commande : verrouille la ligne, demande au
 * domaine si la transition est permise, enregistre le nouveau statut, l'historique et
 * l'audit, puis exécute les effets (argent, stock, livraison, notifications) dans la même
 * transaction. Soit tout est fait, soit rien.
 */
export async function applyOrderEvent(
  ctx: AppContext,
  tx: Tx,
  orderId: string,
  event: OrderEvent,
  actor: Actor,
): Promise<OrderRow> {
  const current = await lockOrder(tx, orderId);
  const now = ctx.clock.now();
  const result = transitionOrder(toSnapshot(current), event, {
    actor: actor.role,
    now,
    policy: ctx.config.orderPolicy,
  });

  const params: unknown[] = [orderId, result.to];
  const sets = ['status = $2', 'version = version + 1'];
  for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
    const value = result.patch[key as keyof typeof PATCH_COLUMNS];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  const { rows } = await tx.query<OrderRow>(
    `UPDATE orders SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  );
  const updated = rows[0]!;

  const note =
    'reason' in event
      ? event.reason
      : 'resolution' in event
        ? JSON.stringify(event.resolution)
        : null;
  await tx.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, event, actor_id, actor_role, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [orderId, result.from, result.to, event.type, actor.userId, actor.role, note, now],
  );
  if (actor.userId) {
    await audit(
      tx,
      actor,
      `order.${event.type}`,
      { type: 'order', id: orderId },
      { from: result.from, to: result.to, note },
    );
  }

  await runEffects(ctx, tx, updated, result.effects, actor);
  return updated;
}

async function runEffects(
  ctx: AppContext,
  tx: Tx,
  order: OrderRow,
  effects: OrderEffect[],
  actor: Actor,
): Promise<void> {
  const now = ctx.clock.now();
  let sellerNet: number | null = null;

  for (const effect of effects) {
    switch (effect.type) {
      case 'restock':
        await tx.query(
          `UPDATE products p SET stock = p.stock + agg.quantity
           FROM (SELECT product_id, sum(quantity)::int AS quantity FROM order_items
                 WHERE order_id = $1 GROUP BY product_id) agg
           WHERE p.id = agg.product_id`,
          [order.id],
        );
        break;

      case 'create_delivery': {
        const code = randomDigits(6);
        await tx.query('INSERT INTO deliveries (order_id, handover_code_hash) VALUES ($1, $2)', [
          order.id,
          handoverHash(ctx, order.id, code),
        ]);
        // Le code en clair ne vit que le temps de l'envoi (outbox purgée après traitement).
        await publish(tx, 'order.handover_code', { type: 'order', id: order.id }, { code }, now);
        break;
      }

      case 'refund_buyer': {
        const paymentId = await effectivePaymentId(tx, order.checkout_id);
        await createRefund(ctx, tx, {
          paymentId,
          orderId: order.id,
          amount: effect.amount,
          reason: effect.reason,
          decidedBy: actor.userId,
        });
        break;
      }

      case 'release_escrow': {
        const { rows } = await tx.query<{ courier_partner_id: string | null }>(
          'SELECT courier_partner_id FROM deliveries WHERE order_id = $1',
          [order.id],
        );
        const release = releaseEscrow({
          orderId: order.id,
          sellerId: order.seller_id,
          courierPartnerId: rows[0]?.courier_partner_id ?? null,
          itemsSubtotal: order.items_subtotal,
          deliveryFee: order.delivery_fee,
          courierShare: order.courier_share,
          commissionTotal: order.commission_total,
          refundedAmount: order.refunded_amount,
        });
        await postJournal(tx, release.journal);
        sellerNet = release.sellerNet;
        // F8 : reversement automatique après réception, dans la limite de la politique vendeur.
        if (release.sellerNet > 0) {
          await schedulePayout(ctx, tx, order.seller_id, {
            orderId: order.id,
            maxAmount: release.sellerNet,
          });
        }
        break;
      }

      case 'notify':
        await publish(
          tx,
          effect.topic,
          { type: 'order', id: order.id },
          sellerNet === null ? {} : { sellerNet },
          now,
        );
        break;
    }
  }
}

export function handoverHash(ctx: AppContext, orderId: string, code: string): string {
  return hmac(ctx.config.appSecret, `handover:${orderId}:${code}`);
}

async function effectivePaymentId(db: Db, checkoutId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM payments WHERE checkout_id = $1 AND status = 'succeeded' AND NOT late_success`,
    [checkoutId],
  );
  if (!rows[0]) throw new Error(`Aucun paiement effectif pour le checkout ${checkoutId}`);
  return rows[0].id;
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export interface OrderView {
  id: string;
  publicRef: string;
  checkoutId: string;
  status: OrderStatus;
  seller: { id: string; shopName: string };
  items: Array<{
    itemId: string;
    productId: string;
    title: string;
    reviewed: boolean;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }>;
  itemsSubtotal: number;
  deliveryFee: number;
  total: number;
  refundedAmount: number;
  currency: string;
  deliveryMode: 'home' | 'pickup_point';
  shippingAddress: Record<string, unknown>;
  sellerAcceptDeadline: Date | null;
  disputeWindowEndsAt: Date | null;
  createdAt: Date;
  paidAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
}

export async function orderViews(db: Db, where: string, params: unknown[]): Promise<OrderView[]> {
  const { rows } = await db.query<OrderRow & { shop_name: string; items: OrderView['items'] }>(
    `SELECT o.*, s.shop_name,
            (SELECT json_agg(json_build_object(
                'itemId', oi.id, 'productId', oi.product_id, 'title', oi.title_snapshot,
                'unitPrice', oi.unit_price, 'quantity', oi.quantity, 'lineTotal', oi.line_total,
                'reviewed', EXISTS (SELECT 1 FROM reviews r WHERE r.order_item_id = oi.id))
                ORDER BY oi.title_snapshot)
             FROM order_items oi WHERE oi.order_id = o.id) AS items
     FROM orders o JOIN seller_profiles s ON s.id = o.seller_id
     WHERE ${where}
     ORDER BY o.created_at DESC, o.id
     LIMIT 100`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    publicRef: r.public_ref,
    checkoutId: r.checkout_id,
    status: r.status,
    seller: { id: r.seller_id, shopName: r.shop_name },
    items: r.items ?? [],
    itemsSubtotal: r.items_subtotal,
    deliveryFee: r.delivery_fee,
    total: r.total,
    refundedAmount: r.refunded_amount,
    currency: r.currency,
    deliveryMode: r.delivery_mode,
    shippingAddress: r.shipping_address,
    sellerAcceptDeadline: r.seller_accept_deadline,
    disputeWindowEndsAt: r.dispute_window_ends_at,
    createdAt: r.created_at,
    paidAt: r.paid_at,
    deliveredAt: r.delivered_at,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
  }));
}
