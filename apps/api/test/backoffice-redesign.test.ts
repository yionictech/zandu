import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { productAlerts } from '../src/modules/admin/admin.routes.js';
import {
  addProduct,
  approveAndNotify,
  buyAndDeliver,
  call,
  checkout,
  createTestEnv,
  login,
  pay,
  setupMarketplace,
  sweep,
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
  await approveAndNotify(env, (await pay(env, m.buyer, co.id)).body.id);
  return co.orders[0].id;
}

describe('Back-office, nouvelle direction visuelle', () => {
  it('vue d’ensemble : volume, argent bloqué, litiges, 14 jours ; commissions pour l’admin seulement', async () => {
    await paidOrder();
    const admin = await call(env, m.admin, { method: 'GET', url: '/v1/support/dashboard' });
    expect(admin.status).toBe(200);
    expect(admin.body).toMatchObject({
      period: 'today',
      volume: { paidOrders: 1 },
      escrow: { orders: 1 },
      disputes: { open: 0 },
    });
    expect(admin.body.volume.amount).toBeGreaterThan(50_000);
    expect(admin.body.commission.amount).toBeGreaterThan(0);
    expect(admin.body.daily).toHaveLength(14);
    expect(admin.body.daily.at(-1).orders).toBe(1);

    const support = await login(env, '06 444 44 44', ['buyer', 'support']);
    const view = await call(env, support, {
      method: 'GET',
      url: '/v1/support/dashboard?period=7d',
    });
    expect(view.body.commission).toBeNull();
    const buyer = await call(env, m.buyer, { method: 'GET', url: '/v1/support/dashboard' });
    expect(buyer.status).toBe(403);
  });

  it('commandes : onglets par statut avec compteurs, acheteur, opérateur', async () => {
    const orderId = await paidOrder();
    const list = await call(env, m.admin, {
      method: 'GET',
      url: '/v1/support/orders?status=paid,preparing',
    });
    expect(list.body.counts.paid).toBe(1);
    expect(list.body.items.map((o: { id: string }) => o.id)).toEqual([orderId]);
    expect(list.body.items[0]).toMatchObject({ operator: 'mtn', riderName: null });
    const none = await call(env, m.admin, {
      method: 'GET',
      url: '/v1/support/orders?status=refunded',
    });
    expect(none.body.items).toEqual([]);
    const bad = await call(env, m.admin, {
      method: 'GET',
      url: '/v1/support/orders?status=inconnu',
    });
    expect(bad.status).toBe(400);
  });

  it('paiements : encaissé, séquestre, reversé, par opérateur, mouvements', async () => {
    const orderId = await buyAndDeliver(env, m);
    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${orderId}/confirm-receipt` });
    await sweep(env);
    const p = await call(env, m.admin, { method: 'GET', url: '/v1/support/payments' });
    expect(p.status).toBe(200);
    expect(p.body.collected.count).toBe(1);
    expect(p.body.byOperator).toEqual([{ operator: 'mtn', amount: p.body.collected.amount }]);
    const kinds = new Set(p.body.movements.map((mv: { kind: string }) => mv.kind));
    expect(kinds.has('collection')).toBe(true);
    const out = await call(env, m.admin, { method: 'GET', url: '/v1/support/payments?kind=out' });
    expect(out.body.movements.every((mv: { kind: string }) => mv.kind !== 'collection')).toBe(true);
  });

  it('clients : recherche, fiche, blocage qui ferme les sessions', async () => {
    await paidOrder();
    await env.pool.query("UPDATE users SET full_name = 'Grâce Mabiala' WHERE id = $1", [
      m.buyer.userId,
    ]);
    const byName = await call(env, m.admin, {
      method: 'GET',
      url: '/v1/support/customers?q=grace',
    });
    expect(byName.body.items.map((c: { id: string }) => c.id)).toEqual([m.buyer.userId]);
    const byPhone = await call(env, m.admin, {
      method: 'GET',
      url: '/v1/support/customers?q=05 555',
    });
    expect(byPhone.body.items[0]).toMatchObject({ orders: 1, disputes: 0, status: 'active' });

    const card = await call(env, m.admin, {
      method: 'GET',
      url: `/v1/support/customers/${m.buyer.userId}`,
    });
    expect(card.body.addresses[0]).toMatchObject({ zone: 'Tié-Tié' });
    expect(card.body.recentOrders).toHaveLength(1);

    const short = await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/customers/${m.buyer.userId}/status`,
      payload: { status: 'suspended', reason: 'x' },
    });
    expect(short.status).toBe(400);
    const blocked = await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/customers/${m.buyer.userId}/status`,
      payload: { status: 'suspended', reason: 'Fausses réclamations répétées' },
    });
    expect(blocked.status).toBe(200);
    const me = await call(env, m.buyer, { method: 'GET', url: '/v1/me' });
    expect(me.status).toBe(401);
    // Un livreur est aussi acheteur : il peut être bloqué ; un membre du personnel, jamais.
    const staff = await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/customers/${m.rider.userId}/status`,
      payload: { status: 'suspended', reason: 'Essai sur un livreur' },
    });
    expect(staff.status).toBe(200); // un livreur est aussi acheteur
    const adminBlock = await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/customers/${m.admin.userId}/status`,
      payload: { status: 'suspended', reason: 'Essai sur soi-même' },
    });
    expect(adminBlock.status).toBe(409);
  });

  it('litige : relancer le vendeur une fois, pas après sa réponse', async () => {
    const orderId = await buyAndDeliver(env, m);
    const dispute = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/orders/${orderId}/disputes`,
      payload: { reason: 'damaged', description: 'Le ventilateur ne tourne pas du tout.' },
    });
    const reminded = await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/disputes/${dispute.body.id}/remind-seller`,
    });
    expect(reminded.status).toBe(200);
    await sweep(env);
    expect(env.notifier.lastTo(m.seller.phone, 'seller_dispute_reminder')).toBeDefined();
    await call(env, m.seller, {
      method: 'POST',
      url: `/v1/seller/orders/${orderId}/dispute-response`,
      payload: { choice: 'exchange' },
    });
    const again = await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/disputes/${dispute.body.id}/remind-seller`,
    });
    expect(again.status).toBe(409);
  });

  it('catalogue : compteurs des onglets et alertes calculées', async () => {
    for (const price of [50_000, 52_000, 48_000]) {
      const id = await addProduct(env, m.seller, { price, title: `Ventilateur ${price}` });
      await env.pool.query("UPDATE products SET status = 'published' WHERE id = $1", [id]);
    }
    const suspect = await addProduct(env, m.seller, { price: 9_000, description: '' });
    await env.pool.query("UPDATE products SET status = 'pending_review' WHERE id = $1", [suspect]);
    const queue = await call(env, m.admin, { method: 'GET', url: '/v1/admin/products' });
    expect(queue.body.counts.pending_review).toBe(1);
    const item = queue.body.items.find((p: { id: string }) => p.id === suspect);
    expect(item.alerts).toEqual(['low_price', 'single_photo', 'no_description']);

    expect(productAlerts(50_000, 'Bon état, garanti 6 mois', 3, 52_000)).toEqual([]);
    expect(productAlerts(10_000, 'Bon état, garanti 6 mois', 3, null)).toEqual([]);
  });

  it('vendeurs : compteurs et dossier complet ; réglages en lecture pour l’admin', async () => {
    const list = await call(env, m.admin, {
      method: 'GET',
      url: '/v1/admin/sellers?status=verified',
    });
    expect(list.body.counts.verified).toBe(1);
    expect(list.body.items[0]).toHaveProperty('documentsComplete');
    const detail = await call(env, m.admin, {
      method: 'GET',
      url: `/v1/admin/sellers/${m.seller.sellerId}`,
    });
    expect(detail.body).toHaveProperty('payoutAccountName');
    expect(detail.body.soldCategories).toEqual([]);

    const settings = await call(env, m.admin, { method: 'GET', url: '/v1/admin/settings' });
    expect(settings.status).toBe(200);
    expect(settings.body.delays).toMatchObject({ disputeSlaHours: 72 });
    expect(settings.body.money.deliveryRates.length).toBeGreaterThan(0);
    const support = await login(env, '06 444 44 45', ['buyer', 'support']);
    const denied = await call(env, support, { method: 'GET', url: '/v1/admin/settings' });
    expect(denied.status).toBe(403);
  });
});
