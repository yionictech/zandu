import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addProduct,
  approveAndNotify,
  balance,
  call,
  checkout,
  createTestEnv,
  handoverCodeFor,
  homeDelivery,
  idemKey,
  openShop,
  orderStatus,
  pay,
  setupMarketplace,
  sweep,
  trialBalance,
  type Marketplace,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
let m: Marketplace;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  m = await setupMarketplace(env);
});

describe("Parcours d'achat de bout en bout (jalon « commande de bout en bout »)", () => {
  it('du panier au reversement du vendeur, avec un grand livre équilibré à chaque étape', async () => {
    // 1. Panier -> checkout : 50 000 + livraison Lumumba -> Tié-Tié (1 500 dont 1 300 au livreur).
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
    expect(co).toMatchObject({
      status: 'awaiting_payment',
      itemsTotal: 50_000,
      deliveryTotal: 1_500,
      grandTotal: 51_500,
    });
    expect(co.orders).toHaveLength(1);
    const orderId = co.orders[0].id;
    expect(co.orders[0].publicRef).toMatch(/^ZD-[0-9A-HJKMNP-TV-Z]{8}$/);
    const stock = await env.pool.query('SELECT stock FROM products WHERE id = $1', [m.productId]);
    expect(stock.rows[0].stock).toBe(4); // stock réservé

    // 2. Paiement MTN MoMo : la demande part sur le téléphone, en attente du code PIN.
    const payment = await pay(env, m.buyer, co.id);
    expect(payment.status).toBe(201);
    expect(payment.body).toMatchObject({
      status: 'pending',
      amount: 51_500,
      operator: 'mtn',
      msisdn: '+242055555555',
    });

    // 3. L'acheteur valide ; webhook signé. Rejouer le même webhook ne fait rien.
    const hook = env.simulator.signWebhook(
      env.simulator.customerResponds(payment.body.id, 'approve'),
      env.clock.now(),
    );
    const first = await call(env, null, {
      method: 'POST',
      url: '/v1/webhooks/payments/simulator',
      headers: hook.headers,
      payload: hook.body,
    });
    const replay = await call(env, null, {
      method: 'POST',
      url: '/v1/webhooks/payments/simulator',
      headers: hook.headers,
      payload: hook.body,
    });
    expect(first.body.outcome).toBe('processed');
    expect(replay.body.outcome).toBe('duplicate');

    expect(
      (await call(env, m.buyer, { method: 'GET', url: `/v1/payments/${payment.body.id}` })).body
        .status,
    ).toBe('succeeded');
    expect(await orderStatus(env, orderId)).toBe('paid');
    expect(await balance(env, 'asset:provider_cash:simulator')).toBe(51_500);
    expect(await balance(env, 'liability:escrow')).toBe(51_500);

    // 4. Notifications : le vendeur est prévenu, l'acheteur reçoit son code de remise par SMS.
    const code = await handoverCodeFor(env, m.buyer.phone);
    expect(code).toMatch(/^\d{6}$/);
    expect(env.notifier.lastTo(m.seller.phone, 'seller_new_order')).toBeDefined();
    expect(env.notifier.lastTo(m.buyer.phone, 'buyer_handover_code')!.channel).toBe('sms');

    // 5. Vendeur : accepte puis prépare.
    expect(
      (await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/accept` }))
        .body.status,
    ).toBe('preparing');
    expect(
      (await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/ready` }))
        .body.status,
    ).toBe('ready_for_pickup');

    // 6. Livraison : assignation, collecte, remise avec code (un mauvais code est refusé).
    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/deliveries/${orderId}/assign`,
      payload: { riderId: m.rider.riderId },
    });
    expect(
      (await call(env, m.rider, { method: 'POST', url: `/v1/rider/deliveries/${orderId}/pickup` }))
        .body.status,
    ).toBe('in_delivery');
    const wrong = await call(env, m.rider, {
      method: 'POST',
      url: `/v1/rider/deliveries/${orderId}/handover`,
      payload: { code: code === '000000' ? '111111' : '000000' },
    });
    expect(wrong.status).toBe(422);
    const handed = await call(env, m.rider, {
      method: 'POST',
      url: `/v1/rider/deliveries/${orderId}/handover`,
      payload: { code },
    });
    expect(handed.body.status).toBe('delivered');

    // 7. L'acheteur confirme : séquestre libéré, vendeur crédité de 45 000 (commission 10 %).
    const confirmed = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/orders/${orderId}/confirm-receipt`,
    });
    expect(confirmed.body.status).toBe('completed');
    expect(await balance(env, 'liability:escrow')).toBe(0);
    expect(await balance(env, 'revenue:commission')).toBe(5_000);
    expect(await balance(env, 'revenue:delivery_margin')).toBe(200);
    expect(
      await balance(env, `liability:courier_payable:40000000-0000-4000-8000-000000000001`),
    ).toBe(1_300);
    expect(await balance(env, 'liability:payouts_in_transit')).toBe(45_000); // reversement automatique réservé

    // 8. Le worker envoie le reversement sur le compte MTN du vendeur.
    await sweep(env);
    const sellerBalance = await call(env, m.seller, { method: 'GET', url: '/v1/seller/balance' });
    expect(sellerBalance.body).toMatchObject({ available: 0, inEscrow: 0 });
    expect(sellerBalance.body.payouts).toEqual([
      expect.objectContaining({ amount: 45_000, status: 'succeeded', orderId }),
    ]);
    expect(await balance(env, 'liability:payouts_in_transit')).toBe(0);
    expect(await balance(env, 'asset:provider_cash:simulator')).toBe(6_500); // commission + livraison
    expect(env.notifier.lastTo(m.seller.phone, 'seller_payout_sent')).toBeDefined();
    expect(await trialBalance(env)).toBe(0);

    // 9. Historique complet, consultable par l'acheteur.
    const detail = await call(env, m.buyer, { method: 'GET', url: `/v1/orders/${orderId}` });
    expect(detail.body.history.map((h: { status: string }) => h.status)).toEqual([
      'pending_payment',
      'paid',
      'preparing',
      'ready_for_pickup',
      'in_delivery',
      'delivered',
      'completed',
    ]);
    const audit = await env.pool.query(
      `SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id`,
      [orderId],
    );
    expect(audit.rows.map((r) => r.action)).toContain('order.handover_confirmed');
  });

  it('un panier multi-vendeurs : un seul paiement, une commande et un séquestre par vendeur', async () => {
    const other = await openShop(env, m.admin, '06 222 22 22');
    const otherProduct = await addProduct(env, other, {
      title: 'Pagne wax 6 yards',
      price: 12_000,
      stock: 10,
    });
    const co = await checkout(env, m.buyer, [
      { productId: m.productId, quantity: 1 },
      { productId: otherProduct, quantity: 2 },
    ]);
    expect(co.orders).toHaveLength(2);
    expect(co.grandTotal).toBe(50_000 + 1_500 + 24_000 + 1_500);

    const payment = await pay(env, m.buyer, co.id);
    await approveAndNotify(env, payment.body.id);

    const escrow = await env.pool.query(
      `SELECT o.items_subtotal + o.delivery_fee AS expected, -sum(e.amount)::bigint AS held
       FROM orders o JOIN ledger_entries e ON e.order_id = o.id
       JOIN ledger_accounts a ON a.id = e.account_id AND a.code = 'liability:escrow'
       WHERE o.checkout_id = $1 GROUP BY o.id`,
      [co.id],
    );
    expect(escrow.rows).toHaveLength(2);
    for (const row of escrow.rows) expect(row.held).toBe(row.expected);
  });

  it("l'acheteur peut passer commande au point relais", async () => {
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }], {
      ...homeDelivery,
      mode: 'pickup_point',
      pickupPointId: '30000000-0000-4000-8000-000000000002',
    });
    expect(co.deliveryTotal).toBe(700);
  });

  it('la même clé d’idempotence renvoie le même panier ; un autre corps est refusé', async () => {
    const key = idemKey();
    const payload = { items: [{ productId: m.productId, quantity: 1 }], delivery: homeDelivery };
    const a = await call(env, m.buyer, {
      method: 'POST',
      url: '/v1/checkouts',
      headers: { 'idempotency-key': key },
      payload,
    });
    const b = await call(env, m.buyer, {
      method: 'POST',
      url: '/v1/checkouts',
      headers: { 'idempotency-key': key },
      payload,
    });
    expect(b.body.id).toBe(a.body.id);
    const c = await call(env, m.buyer, {
      method: 'POST',
      url: '/v1/checkouts',
      headers: { 'idempotency-key': key },
      payload: { ...payload, items: [{ productId: m.productId, quantity: 2 }] },
    });
    expect(c.status).toBe(422);
    const stock = await env.pool.query('SELECT stock FROM products WHERE id = $1', [m.productId]);
    expect(stock.rows[0].stock).toBe(4); // réservé une seule fois
  });

  it('refuse un stock insuffisant et l’achat de ses propres produits', async () => {
    const tooMany = await call(env, m.buyer, {
      method: 'POST',
      url: '/v1/checkouts',
      headers: { 'idempotency-key': idemKey() },
      payload: { items: [{ productId: m.productId, quantity: 6 }], delivery: homeDelivery },
    });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe('out_of_stock');
    const own = await call(env, m.seller, {
      method: 'POST',
      url: '/v1/checkouts',
      headers: { 'idempotency-key': idemKey() },
      payload: { items: [{ productId: m.productId, quantity: 1 }], delivery: homeDelivery },
    });
    expect(own.body.error.code).toBe('own_product');
  });

  it('recherche plein texte tolérante aux accents et aux fautes de frappe', async () => {
    await addProduct(env, m.seller, {
      title: 'Téléphone Samsung Galaxy A15',
      categoryId: '10000000-0000-4000-8000-000000000002',
      price: 95_000,
    });
    const byAccentless = await call(env, null, { method: 'GET', url: '/v1/products?q=telephone' });
    expect(byAccentless.body.items.map((p: { title: string }) => p.title)).toContain(
      'Téléphone Samsung Galaxy A15',
    );
    const byTypo = await call(env, null, { method: 'GET', url: '/v1/products?q=samsumg' });
    expect(byTypo.body.items[0].title).toBe('Téléphone Samsung Galaxy A15');
    const byCategory = await call(env, null, {
      method: 'GET',
      url: '/v1/products?categoryId=10000000-0000-4000-8000-000000000001',
    });
    expect(byCategory.body.items).toHaveLength(1); // « Électronique » inclut ses sous-catégories
    const byPrice = await call(env, null, {
      method: 'GET',
      url: '/v1/products?maxPrice=60000&sort=price_asc',
    });
    expect(byPrice.body.items.map((p: { price: number }) => p.price)).toEqual([50_000]);
  });
});
