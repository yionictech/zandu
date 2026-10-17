import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processPayouts } from '../src/modules/payouts/payouts.service.js';
import {
  addProduct,
  approveAndNotify,
  buyAndDeliver,
  call,
  checkout,
  createTestEnv,
  homeDelivery,
  login,
  openShop,
  pay,
  setupMarketplace,
  uploadFile,
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

const get = (url: string) => call(env, m.admin, { method: 'GET', url });

async function paidOrder(delivery = homeDelivery): Promise<{ id: string; publicRef: string }> {
  const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }], delivery);
  await approveAndNotify(env, (await pay(env, m.buyer, co.id)).body.id);
  return co.orders[0];
}

describe('Tableau de bord du support', () => {
  it('compte chaque file et l’activité du jour', async () => {
    // Une boutique non vérifiée au dossier complet, avec un produit en modération.
    const shop = await openShop(env, m.admin, '06 333 33 33', false);
    for (const type of ['national_id', 'selfie']) {
      await call(env, shop, {
        method: 'POST',
        url: '/v1/seller/kyc-documents',
        payload: { uploadId: await uploadFile(env, shop, 'kyc_document'), type },
      });
    }
    await addProduct(env, shop, { title: 'Radio solaire' });
    // Une commande prête à partir, une autre litigieuse.
    const ready = await paidOrder();
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${ready.id}/accept` });
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${ready.id}/ready` });
    const disputed = await buyAndDeliver(env, m);
    await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/orders/${disputed}/disputes`,
      payload: { reason: 'damaged', description: 'Le pied est cassé à la livraison' },
    });

    const overview = await get('/v1/support/overview');
    expect(overview.status).toBe(200);
    expect(overview.body).toEqual({
      queues: {
        kycPending: 1,
        productsPending: 1,
        deliveriesToAssign: 1,
        disputesOpen: 1,
        disputesOverdue: 0,
        alerts: 0,
      },
      today: { paidOrders: 2, paidAmount: 103_000, completedOrders: 0, newShops: 2 },
    });

    env.clock.advanceHours(73);
    m.admin = await login(env, '06 999 99 99'); // la session du personnel dure 12 h
    const late = await get('/v1/support/overview');
    expect(late.body.queues).toMatchObject({ disputesOverdue: 1, alerts: 1 });
    const alerts = await get('/v1/support/alerts');
    expect(alerts.body.items).toEqual([
      expect.objectContaining({ kind: 'dispute_overdue', orderId: disputed, amount: 51_500 }),
    ]);
  });

  it('réservé au personnel', async () => {
    for (const url of ['/v1/support/overview', '/v1/support/orders', '/v1/admin/products']) {
      expect((await call(env, m.buyer, { method: 'GET', url })).status).toBe(403);
      expect((await call(env, m.seller, { method: 'GET', url })).status).toBe(403);
    }
  });
});

describe('Files de travail', () => {
  it('modération : produit, photos et boutique ; la décision le retire de la file', async () => {
    const shop = await openShop(env, m.admin, '06 333 33 33', false);
    const productId = await addProduct(env, shop, { title: 'Radio solaire', publish: false });
    await call(env, shop, {
      method: 'POST',
      url: `/v1/seller/products/${productId}/photos`,
      payload: { uploadId: await uploadFile(env, shop, 'product_photo') },
    });
    await call(env, shop, {
      method: 'PATCH',
      url: `/v1/seller/products/${productId}`,
      payload: { status: 'published' },
    });

    const queue = await get('/v1/admin/products');
    expect(queue.body.items).toEqual([
      expect.objectContaining({
        id: productId,
        title: 'Radio solaire',
        category: 'Maison et électroménager',
        shopName: 'Boutique 3 33',
        sellerVerification: 'unverified',
        photos: [expect.stringMatching(/^http:\/\/api\.test\/dev\/storage\/public\/products\//)],
      }),
    ]);
    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/admin/products/${productId}/moderation`,
      payload: { decision: 'rejected', reason: 'Photo floue' },
    });
    expect((await get('/v1/admin/products')).body.items).toEqual([]);
    expect((await get('/v1/admin/products?status=rejected')).body.items[0]).toMatchObject({
      id: productId,
      rejectionReason: 'Photo floue',
    });
  });

  it('fiche boutique pour la vérification', async () => {
    const shop = await openShop(env, m.admin, '06 333 33 33', false);
    const res = await get(`/v1/admin/sellers/${shop.sellerId}`);
    expect(res.body).toMatchObject({
      shopName: 'Boutique 3 33',
      phone: '+242063333333',
      payoutPhone: '+242063333333',
      pickupZone: 'Lumumba (Centre-ville)',
      verificationStatus: 'unverified',
      productCount: 0,
      orderCount: 0,
    });
  });

  it('livraisons : colis prêts d’abord ; un livreur assigné voit sa charge augmenter', async () => {
    const preparing = await paidOrder();
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${preparing.id}/accept` });
    const ready = await paidOrder();
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${ready.id}/accept` });
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${ready.id}/ready` });

    const queue = await get('/v1/support/deliveries');
    expect(queue.body.items.map((d: { orderId: string }) => d.orderId)).toEqual([
      ready.id,
      preparing.id,
    ]);
    expect(queue.body.items[0]).toMatchObject({
      orderStatus: 'ready_for_pickup',
      shopName: 'Boutique 1 11',
      pickupZone: 'Lumumba (Centre-ville)',
      destinationZone: 'Tié-Tié',
      itemCount: 1,
      readyAt: expect.any(String),
    });

    const riders = await get('/v1/support/riders');
    expect(riders.body.items).toEqual([
      expect.objectContaining({ id: m.rider.riderId, phone: '+242068888888', activeMissions: 0 }),
    ]);
    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/deliveries/${ready.id}/assign`,
      payload: { riderId: m.rider.riderId },
    });
    expect((await get('/v1/support/deliveries')).body.items).toHaveLength(1);
    expect((await get('/v1/support/riders')).body.items[0].activeMissions).toBe(1);
  });
});

describe('Recherche et dossier de commande', () => {
  it('par référence, par téléphone de l’acheteur, du vendeur ou du destinataire', async () => {
    const order = await paidOrder({ ...homeDelivery, phone: '05 444 44 44' });
    const ids = async (q: string) =>
      (await get(`/v1/support/orders?q=${encodeURIComponent(q)}`)).body.items.map(
        (o: { id: string }) => o.id,
      );
    expect(await ids(order.publicRef)).toEqual([order.id]);
    expect(await ids(order.publicRef.toLowerCase().replace('-', ''))).toEqual([order.id]);
    expect(await ids(order.publicRef.slice(3))).toEqual(
      /[A-Z]/.test(order.publicRef.slice(3)) ? [order.id] : [],
    );
    expect(await ids('05 555 55 55')).toEqual([order.id]); // acheteur
    expect(await ids('+242 06 111 11 11')).toEqual([order.id]); // vendeur
    expect(await ids('054444444')).toEqual([order.id]); // destinataire
    expect(await ids('06 123 45 67')).toEqual([]);
    expect((await get('/v1/support/orders')).body.items).toHaveLength(1);
    const invalid = await get('/v1/support/orders?q=bonjour');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('invalid_search');
  });

  it('dossier complet : paiement, livraison, reversement en échec et alerte', async () => {
    const orderId = await buyAndDeliver(env, m);
    env.simulator.failNextPayouts = 3;
    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${orderId}/confirm-receipt` });
    await processPayouts(env.ctx);
    env.clock.advanceMinutes(5);
    await processPayouts(env.ctx);
    env.clock.advanceMinutes(30);
    await processPayouts(env.ctx);

    const detail = await get(`/v1/support/orders/${orderId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: orderId,
      status: 'completed',
      buyer: { phone: '+242055555555' },
      sellerContact: { phone: '+242061111111', verificationStatus: 'verified' },
      payments: [expect.objectContaining({ status: 'succeeded', operator: 'mtn', amount: 51_500 })],
      payouts: [expect.objectContaining({ status: 'failed', amount: 45_000, attempts: 3 })],
      delivery: expect.objectContaining({ status: 'delivered', riderPhone: '+242068888888' }),
      dispute: null,
    });
    expect(detail.body.history.at(-1).status).toBe('completed');

    const alerts = await get('/v1/support/alerts');
    expect(alerts.body.items).toEqual([
      expect.objectContaining({ kind: 'payout_failed', orderId, amount: 45_000 }),
    ]);
    expect((await get('/v1/support/overview')).body.queues.alerts).toBe(1);
  });

  it('commande inconnue : 404', async () => {
    const res = await get('/v1/support/orders/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });
});

describe('Accès', () => {
  it('un compte support sans rôle admin consulte les files', async () => {
    const agent = await login(env, '06 777 77 77', ['buyer', 'support']);
    expect((await call(env, agent, { method: 'GET', url: '/v1/support/overview' })).status).toBe(
      200,
    );
  });
});
