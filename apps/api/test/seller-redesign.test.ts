import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addProduct,
  approveAndNotify,
  buyAndDeliver,
  call,
  CATEGORIES,
  checkout,
  createTestEnv,
  login,
  orderStatus,
  pay,
  setupMarketplace,
  uploadFile,
  ZONES,
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

async function paidOrder(): Promise<string> {
  const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
  const payment = await pay(env, m.buyer, co.id);
  await approveAndNotify(env, payment.body.id);
  return co.orders[0].id;
}

describe('Espace vendeur, nouvelle direction visuelle', () => {
  it('ouverture en 3 étapes : boutique, puis compte Mobile Money et conditions', async () => {
    const owner = await login(env, '05 404 40 40');
    const opened = await call(env, owner, {
      method: 'POST',
      url: '/v1/seller/shop',
      payload: {
        shopName: 'Mama Grâce Électro',
        city: 'Pointe-Noire',
        pickupZoneId: ZONES.lumumba,
        soldCategoryIds: [CATEGORIES.maison, CATEGORIES.maison],
        openingHours: 'Lun – Sam · 08:00 – 18:00',
      },
    });
    expect(opened.status).toBe(201);
    const shop = await call(env, owner, { method: 'GET', url: '/v1/seller/shop' });
    // Sans compte indiqué : le numéro du gérant et l'opérateur deviné (05 = Airtel).
    expect(shop.body).toMatchObject({
      payoutPhone: '+242054044040',
      payoutOperator: 'airtel',
      soldCategoryIds: [CATEGORIES.maison],
      openingHours: 'Lun – Sam · 08:00 – 18:00',
      isOpen: true,
      defaultPrepMinutes: 30,
      termsAccepted: false,
    });

    const lonely = await call(env, owner, {
      method: 'PATCH',
      url: '/v1/seller/shop',
      payload: { payoutPhone: '06 404 40 40' },
    });
    expect(lonely.status).toBe(400); // numéro sans opérateur

    const step3 = await call(env, owner, {
      method: 'PATCH',
      url: '/v1/seller/shop',
      payload: {
        payoutPhone: '06 404 40 40',
        payoutOperator: 'mtn',
        payoutAccountName: 'Grâce Nkounkou',
        acceptTerms: true,
      },
    });
    expect(step3.status).toBe(200);
    expect(step3.body).toMatchObject({
      payoutPhone: '+242064044040',
      payoutOperator: 'mtn',
      payoutAccountName: 'Grâce Nkounkou',
      termsAccepted: true,
    });
    // Avant la vérification, changer de numéro ne déclenche pas la carence des reversements.
    const { rows } = await env.pool.query(
      'SELECT payout_msisdn_changed_at FROM seller_profiles WHERE id = $1',
      [opened.body.id],
    );
    expect(rows[0].payout_msisdn_changed_at).toBeNull();
  });

  it('boutique en congé : produits masqués du catalogue, achat refusé', async () => {
    const closed = await call(env, m.seller, {
      method: 'PATCH',
      url: '/v1/seller/shop',
      payload: { isOpen: false },
    });
    expect(closed.body.isOpen).toBe(false);
    const list = await call(env, null, { method: 'GET', url: '/v1/products?q=ventilateur' });
    expect(list.body.items).toHaveLength(0);
    const product = await call(env, null, { method: 'GET', url: `/v1/products/${m.productId}` });
    expect(product.body.seller.open).toBe(false);
    const co = await call(env, m.buyer, {
      method: 'POST',
      url: '/v1/checkouts',
      headers: { 'idempotency-key': 'conges-0001' },
      payload: {
        items: [{ productId: m.productId, quantity: 1 }],
        delivery: {
          mode: 'home',
          zoneId: ZONES.tieTie,
          recipientName: 'Grâce M.',
          phone: '05 555 55 55',
          landmark: 'Derrière le marché',
        },
      },
    });
    expect(co.status).toBe(409);
    expect(co.body.error.code).toBe('shop_closed');
  });

  it('état du produit et alerte de stock bas au tableau de bord', async () => {
    const id = await addProduct(env, m.seller, {
      title: 'Écouteurs Bluetooth sans fil',
      price: 12_500,
      stock: 2,
      condition: 'refurbished',
      lowStockThreshold: 3,
    });
    const mine = await call(env, m.seller, { method: 'GET', url: `/v1/seller/products/${id}` });
    expect(mine.body).toMatchObject({ condition: 'refurbished', lowStockThreshold: 3 });
    const card = await call(env, null, { method: 'GET', url: `/v1/products/${id}` });
    expect(card.body.condition).toBe('refurbished');

    await paidOrder();
    const dash = await call(env, m.seller, { method: 'GET', url: '/v1/seller/dashboard' });
    expect(dash.body).toMatchObject({
      todaySales: 50_000,
      todayOrders: 1,
      toAccept: { count: 1 },
      productCount: 2,
    });
    expect(dash.body.toAccept.nextDeadline).not.toBeNull();
    expect(dash.body.lowStock).toEqual([
      { id, title: 'Écouteurs Bluetooth sans fil', stock: 2, lowStockThreshold: 3 },
    ]);
  });

  it('« Prêt dans » promis à l’acceptation, rupture de stock remboursée en préparation', async () => {
    const orderId = await paidOrder();
    const accepted = await call(env, m.seller, {
      method: 'POST',
      url: `/v1/seller/orders/${orderId}/accept`,
      payload: { readyInMinutes: 60 },
    });
    expect(accepted.status).toBe(200);
    const view = await call(env, m.seller, {
      method: 'GET',
      url: `/v1/seller/orders/${orderId}`,
    });
    const promised = new Date(view.body.readyPromisedAt).getTime();
    expect(promised - env.clock.now().getTime()).toBe(60 * 60_000);
    expect(view.body).toMatchObject({ rider: null, dispute: null, reviews: [] });

    const cancelled = await call(env, m.seller, {
      method: 'POST',
      url: `/v1/seller/orders/${orderId}/reject`,
      payload: { reason: 'Rupture de stock' },
    });
    expect(cancelled.status).toBe(200);
    expect(await orderStatus(env, orderId)).toBe('cancelled');
    const { rows } = await env.pool.query('SELECT amount FROM refunds WHERE order_id = $1', [
      orderId,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('acceptation sans durée : préparation par défaut de la boutique', async () => {
    await call(env, m.seller, {
      method: 'PATCH',
      url: '/v1/seller/shop',
      payload: { defaultPrepMinutes: 15 },
    });
    const orderId = await paidOrder();
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/accept` });
    const view = await call(env, m.seller, { method: 'GET', url: `/v1/seller/orders/${orderId}` });
    const promised = new Date(view.body.readyPromisedAt).getTime();
    expect(promised - env.clock.now().getTime()).toBe(15 * 60_000);
  });

  it('avis : liste, répartition, réponse publique du vendeur', async () => {
    const orderId = await buyAndDeliver(env, m);
    const order = await call(env, m.buyer, { method: 'GET', url: `/v1/orders/${orderId}` });
    await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/order-items/${order.body.items[0].itemId}/review`,
      payload: { rating: 4, comment: 'Bien emballé.', tags: ['bien_emballe'] },
    });
    const reviews = await call(env, m.seller, { method: 'GET', url: '/v1/seller/reviews' });
    expect(reviews.body).toMatchObject({
      average: 4,
      count: 1,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 },
    });
    const reviewId = reviews.body.items[0].id;
    expect(reviews.body.items[0]).toMatchObject({ reply: null, tags: ['bien_emballe'] });

    const other = await login(env, '06 777 77 70');
    const stranger = await call(env, other, {
      method: 'POST',
      url: `/v1/seller/reviews/${reviewId}/reply`,
      payload: { text: 'Merci !' },
    });
    expect(stranger.status).toBe(403); // pas de boutique : rôle vendeur absent

    const replied = await call(env, m.seller, {
      method: 'POST',
      url: `/v1/seller/reviews/${reviewId}/reply`,
      payload: { text: 'Merci, à bientôt chez nous !' },
    });
    expect(replied.status).toBe(200);
    const pub = await call(env, null, {
      method: 'GET',
      url: `/v1/products/${m.productId}/reviews`,
    });
    expect(pub.body.items[0].sellerReply).toBe('Merci, à bientôt chez nous !');
    const detail = await call(env, m.seller, {
      method: 'GET',
      url: `/v1/seller/orders/${orderId}`,
    });
    expect(detail.body.reviews[0]).toMatchObject({
      rating: 4,
      reply: 'Merci, à bientôt chez nous !',
    });
    expect(detail.body.rider).toEqual({ name: expect.any(String) });
  });

  it('litige : le vendeur répond avec preuves, le support le voit', async () => {
    const orderId = await buyAndDeliver(env, m);
    const none = await call(env, m.seller, {
      method: 'POST',
      url: `/v1/seller/orders/${orderId}/dispute-response`,
      payload: { choice: 'exchange' },
    });
    expect(none.status).toBe(409);

    const opened = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/orders/${orderId}/disputes`,
      payload: { reason: 'not_as_described', description: "J'ai reçu un modèle différent." },
    });
    expect(opened.status).toBe(201);
    const response = await call(env, m.seller, {
      method: 'POST',
      url: `/v1/seller/orders/${orderId}/dispute-response`,
      payload: { choice: 'contest', message: 'Le bon modèle a été testé devant le livreur.' },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ sellerChoice: 'contest', buyerEvidenceCount: 0 });

    const uploadId = await uploadFile(env, m.seller, 'dispute_evidence');
    const evidence = await call(env, m.seller, {
      method: 'POST',
      url: `/v1/seller/orders/${orderId}/dispute-evidence`,
      payload: { uploadId },
    });
    expect(evidence.status).toBe(201);

    const staff = await call(env, m.admin, {
      method: 'GET',
      url: `/v1/support/disputes/${opened.body.id}`,
    });
    expect(staff.body).toMatchObject({
      sellerChoice: 'contest',
      sellerMessage: 'Le bon modèle a été testé devant le livreur.',
    });
    expect(staff.body.evidence.map((e: { from: string }) => e.from)).toEqual(['seller']);
  });

  it('mon argent : bloqué, libéré, versé, compte de reversement', async () => {
    const orderId = await buyAndDeliver(env, m);
    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${orderId}/confirm-receipt` });
    const money = await call(env, m.seller, { method: 'GET', url: '/v1/seller/balance' });
    expect(money.body.payoutAccount).toEqual({ operator: 'mtn', phone: '+242061111111' });
    const kinds = money.body.movements.map((mv: { kind: string }) => mv.kind);
    expect(kinds).toContain('released');
    expect(kinds).not.toContain('held');
  });
});
