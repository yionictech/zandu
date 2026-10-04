import {
  lineCommission,
  parseCongoMobile,
  resolveCommissionRate,
  sum,
  type CommissionRule,
} from '@zandu/domain';
import type { AppContext } from '../../context.js';
import { withTx, type Db } from '../../db/pool.js';
import { addMinutes } from '../../lib/clock.js';
import { publicOrderRef } from '../../lib/crypto.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { claimIdempotency, completeIdempotency } from '../../lib/idempotency.js';
import { orderViews } from '../orders/orders.service.js';

export interface CheckoutInput {
  items: Array<{ productId: string; quantity: number }>;
  delivery: {
    mode: 'home' | 'pickup_point';
    zoneId: string;
    pickupPointId?: string | undefined;
    recipientName: string;
    phone: string;
    /** Adresse par repères : « Quartier Tié-Tié, derrière l'école Saint-Pierre, portail bleu ». */
    landmark: string;
  };
}

interface ProductRow {
  id: string;
  title: string;
  price: number;
  stock: number;
  status: string;
  category_id: string;
  seller_id: string;
  seller_user_id: string;
  seller_status: string;
  pickup_zone_id: string;
}

/**
 * Transforme un panier en commandes : un checkout (un seul paiement) découpé en une
 * commande par vendeur, chacune avec sa livraison, son séquestre, son litige, son
 * reversement. Le stock est réservé immédiatement et libéré si le paiement n'aboutit pas.
 */
export async function createCheckout(
  ctx: AppContext,
  buyerId: string,
  input: CheckoutInput,
  idempotencyKey: string | undefined,
): Promise<string> {
  const now = ctx.clock.now();
  const recipientPhone = parseCongoMobile(input.delivery.phone);

  return withTx(ctx.pool, async (tx) => {
    const previous = await claimIdempotency(tx, {
      userId: buyerId,
      key: idempotencyKey,
      method: 'POST',
      path: '/v1/checkouts',
      body: input,
    });
    if (previous) return previous;

    // Quantités regroupées par produit, produits verrouillés dans un ordre stable (pas d'interblocage).
    const quantities = new Map<string, number>();
    for (const item of input.items)
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    const { rows: products } = await tx.query<ProductRow>(
      `SELECT p.id, p.title, p.price, p.stock, p.status, p.category_id, p.seller_id,
              s.user_id AS seller_user_id, s.verification_status AS seller_status, s.pickup_zone_id
       FROM products p JOIN seller_profiles s ON s.id = p.seller_id
       WHERE p.id = ANY($1::uuid[]) ORDER BY p.id FOR UPDATE OF p`,
      [[...quantities.keys()]],
    );
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const [productId, quantity] of quantities) {
      const p = byId.get(productId);
      if (!p || p.status !== 'published' || p.seller_status === 'suspended') {
        throw new HttpError(
          409,
          'product_unavailable',
          "Un produit du panier n'est plus disponible",
          { productId },
        );
      }
      if (p.seller_user_id === buyerId) {
        throw new HttpError(409, 'own_product', 'Vous ne pouvez pas acheter vos propres produits', {
          productId,
        });
      }
      if (p.stock < quantity) {
        throw new HttpError(409, 'out_of_stock', 'Stock insuffisant', {
          productId,
          available: p.stock,
        });
      }
    }

    const zone = await tx.query('SELECT 1 FROM delivery_zones WHERE id = $1 AND active', [
      input.delivery.zoneId,
    ]);
    if (!zone.rowCount)
      throw new HttpError(422, 'delivery_unavailable', 'Zone de livraison non desservie');
    if (input.delivery.mode === 'pickup_point') {
      const point = await tx.query(
        'SELECT 1 FROM pickup_points WHERE id = $1 AND zone_id = $2 AND active',
        [input.delivery.pickupPointId ?? null, input.delivery.zoneId],
      );
      if (!point.rowCount)
        throw new HttpError(
          422,
          'pickup_point_unavailable',
          'Point relais indisponible dans cette zone',
        );
    }

    const rules = await loadCommissionRules(tx);
    const categoryPaths = await loadCategoryPaths(tx);

    // Une commande par vendeur.
    const bySeller = new Map<string, ProductRow[]>();
    for (const p of products) bySeller.set(p.seller_id, [...(bySeller.get(p.seller_id) ?? []), p]);

    const drafts = [];
    for (const [sellerId, sellerProducts] of bySeller) {
      const rate = await tx.query<{ price: number; courier_share: number }>(
        `SELECT price, courier_share FROM delivery_rates
         WHERE from_zone_id = $1 AND to_zone_id = $2 AND mode = $3 AND active`,
        [sellerProducts[0]!.pickup_zone_id, input.delivery.zoneId, input.delivery.mode],
      );
      if (!rate.rows[0]) {
        throw new HttpError(
          422,
          'delivery_unavailable',
          'Ce vendeur ne livre pas encore dans votre zone',
          { sellerId },
        );
      }
      const lines = sellerProducts.map((p) => {
        const quantity = quantities.get(p.id)!;
        const lineTotal = p.price * quantity;
        const rateBps = resolveCommissionRate(
          rules,
          { sellerId, categoryPath: categoryPaths.get(p.category_id) ?? [] },
          now,
        );
        return {
          product: p,
          quantity,
          lineTotal,
          rateBps,
          commission: lineCommission(lineTotal, rateBps),
        };
      });
      drafts.push({
        sellerId,
        lines,
        itemsSubtotal: sum(lines.map((l) => l.lineTotal)),
        commissionTotal: sum(lines.map((l) => l.commission)),
        deliveryFee: rate.rows[0].price,
        courierShare: rate.rows[0].courier_share,
      });
    }

    const itemsTotal = sum(drafts.map((d) => d.itemsSubtotal));
    const deliveryTotal = sum(drafts.map((d) => d.deliveryFee));
    const { rows: checkoutRows } = await tx.query<{ id: string }>(
      `INSERT INTO checkouts (buyer_id, items_total, delivery_total, grand_total, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        buyerId,
        itemsTotal,
        deliveryTotal,
        itemsTotal + deliveryTotal,
        addMinutes(now, ctx.config.payments.ttlMinutes),
        now,
      ],
    );
    const checkoutId = checkoutRows[0]!.id;
    const address = {
      recipientName: input.delivery.recipientName,
      phone: recipientPhone.e164,
      landmark: input.delivery.landmark,
    };

    for (const d of drafts) {
      const { rows: orderRows } = await tx.query<{ id: string }>(
        `INSERT INTO orders (public_ref, checkout_id, buyer_id, seller_id, items_subtotal, delivery_fee, courier_share,
                             commission_total, total, delivery_mode, delivery_zone_id, pickup_point_id, shipping_address, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
        [
          publicOrderRef(),
          checkoutId,
          buyerId,
          d.sellerId,
          d.itemsSubtotal,
          d.deliveryFee,
          d.courierShare,
          d.commissionTotal,
          d.itemsSubtotal + d.deliveryFee,
          input.delivery.mode,
          input.delivery.zoneId,
          input.delivery.pickupPointId ?? null,
          address,
          now,
        ],
      );
      const orderId = orderRows[0]!.id;
      for (const l of d.lines) {
        await tx.query(
          `INSERT INTO order_items (order_id, product_id, title_snapshot, unit_price, quantity, line_total,
                                    commission_rate_bps, commission_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            orderId,
            l.product.id,
            l.product.title,
            l.product.price,
            l.quantity,
            l.lineTotal,
            l.rateBps,
            l.commission,
          ],
        );
        await tx.query('UPDATE products SET stock = stock - $2 WHERE id = $1', [
          l.product.id,
          l.quantity,
        ]);
      }
      await tx.query(
        `INSERT INTO order_status_history (order_id, from_status, to_status, event, actor_id, actor_role, created_at)
         VALUES ($1, NULL, 'pending_payment', 'checkout_created', $2, 'buyer', $3)`,
        [orderId, buyerId, now],
      );
    }

    await completeIdempotency(tx, buyerId, idempotencyKey!, checkoutId);
    return checkoutId;
  });
}

async function loadCommissionRules(db: Db): Promise<CommissionRule[]> {
  const { rows } = await db.query<{
    scope: CommissionRule['scope'];
    rate_bps: number;
    category_id: string | null;
    seller_id: string | null;
    valid_from: Date;
    valid_to: Date | null;
  }>('SELECT scope, rate_bps, category_id, seller_id, valid_from, valid_to FROM commission_rules');
  return rows.map((r) => ({
    scope: r.scope,
    rateBps: r.rate_bps,
    categoryId: r.category_id,
    sellerId: r.seller_id,
    validFrom: r.valid_from,
    validTo: r.valid_to,
  }));
}

/** Chemin de chaque catégorie vers la racine : [smartphones, electronique]. */
async function loadCategoryPaths(db: Db): Promise<Map<string, string[]>> {
  const { rows } = await db.query<{ id: string; parent_id: string | null }>(
    'SELECT id, parent_id FROM categories',
  );
  const parent = new Map(rows.map((r) => [r.id, r.parent_id]));
  const paths = new Map<string, string[]>();
  for (const { id } of rows) {
    const path: string[] = [];
    for (let cur: string | null | undefined = id; cur && path.length < 10; cur = parent.get(cur))
      path.push(cur);
    paths.set(id, path);
  }
  return paths;
}

export async function checkoutView(db: Db, checkoutId: string, buyerId: string) {
  const { rows } = await db.query<{
    id: string;
    status: string;
    items_total: number;
    delivery_total: number;
    grand_total: number;
    currency: string;
    expires_at: Date;
    paid_at: Date | null;
  }>('SELECT * FROM checkouts WHERE id = $1 AND buyer_id = $2', [checkoutId, buyerId]);
  const c = rows[0];
  if (!c) throw notFound('Panier');
  return {
    id: c.id,
    status: c.status,
    itemsTotal: c.items_total,
    deliveryTotal: c.delivery_total,
    grandTotal: c.grand_total,
    currency: c.currency,
    expiresAt: c.expires_at,
    paidAt: c.paid_at,
    orders: await orderViews(db, 'o.checkout_id = $1', [checkoutId]),
  };
}
