import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addProduct,
  buyAndDeliver,
  call,
  createTestEnv,
  openShop,
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

describe('Parcours acheteur, nouvelle direction visuelle', () => {
  it('filtre « Vendeur vérifié » de la recherche', async () => {
    const newcomer = await openShop(env, m.admin, '06 222 22 22', false);
    const id = await addProduct(env, newcomer, { title: 'Ventilateur de table' });
    // Mis en ligne par la modération, la boutique reste non vérifiée.
    await env.pool.query(
      "UPDATE products SET status = 'published', published_at = now() WHERE id = $1",
      [id],
    );
    const all = await call(env, null, { method: 'GET', url: '/v1/products?q=ventilateur' });
    const verified = await call(env, null, {
      method: 'GET',
      url: '/v1/products?q=ventilateur&verified=true',
    });
    expect(all.body.items.length).toBeGreaterThan(verified.body.items.length);
    expect(
      verified.body.items.every((p: { seller: { verified: boolean } }) => p.seller.verified),
    ).toBe(true);
  });

  it('avis avec étiquettes, visibles sur la fiche', async () => {
    const orderId = await buyAndDeliver(env, m);
    const order = await call(env, m.buyer, { method: 'GET', url: `/v1/orders/${orderId}` });
    const itemId = order.body.items[0].itemId;
    const bad = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/order-items/${itemId}/review`,
      payload: { rating: 5, tags: ['inconnu'] },
    });
    expect(bad.status).toBe(400);
    const ok = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/order-items/${itemId}/review`,
      payload: { rating: 5, tags: ['conforme', 'livreur_ponctuel', 'conforme'] },
    });
    expect(ok.status).toBe(201);
    const reviews = await call(env, null, {
      method: 'GET',
      url: `/v1/products/${m.productId}/reviews`,
    });
    expect(reviews.body.items[0].tags).toEqual(['conforme', 'livreur_ponctuel']);
  });

  it('centre de notifications : un message une fois, code masqué, « Tout lire »', async () => {
    // Le vendeur reçoit WhatsApp ; on simule l'échec de WhatsApp : le même message part par SMS.
    env.notifier.failChannels.add('whatsapp');
    await buyAndDeliver(env, m);
    await sweep(env);
    env.notifier.failChannels.clear();

    const seller = await call(env, m.seller, { method: 'GET', url: '/v1/me/notifications' });
    const newOrders = seller.body.items.filter(
      (i: { template: string }) => i.template === 'seller_new_order',
    );
    expect(newOrders).toHaveLength(1); // WhatsApp échoué + SMS : une seule entrée
    expect(newOrders[0]).toMatchObject({ title: 'Nouvelle commande', unread: true });
    expect(newOrders[0].url).toMatch(/^\/vendeur\/commande\//);

    const buyer = await call(env, m.buyer, { method: 'GET', url: '/v1/me/notifications' });
    const code = buyer.body.items.find(
      (i: { template: string }) => i.template === 'buyer_handover_code',
    );
    expect(code.body).not.toMatch(/\d{6}/); // le code reste dans le SMS
    expect(buyer.body.items.some((i: { template: string }) => i.template === 'otp_code')).toBe(
      false,
    );
    expect(buyer.body.unread).toBeGreaterThan(0);

    env.clock.advanceMinutes(1);
    await call(env, m.buyer, { method: 'POST', url: '/v1/me/notifications/seen' });
    const after = await call(env, m.buyer, { method: 'GET', url: '/v1/me/notifications' });
    expect(after.body.unread).toBe(0);
  });
});
