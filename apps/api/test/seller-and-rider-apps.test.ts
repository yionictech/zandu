import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addProduct,
  approveAndNotify,
  buyAndDeliver,
  call,
  confirmPickupCode,
  checkout,
  createTestEnv,
  handoverCodeFor,
  homeDelivery,
  login,
  openShop,
  pay,
  setupMarketplace,
  sweep,
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

/** Une commande payée d'un article, prête à être traitée par le vendeur. */
async function paidOrder(): Promise<string> {
  const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
  const payment = await pay(env, m.buyer, co.id);
  await approveAndNotify(env, payment.body.id);
  return co.orders[0].id;
}

/** Téléphone de l'acheteur (05 555 55 55) sous toutes ses formes ; pas un « 555 » d'identifiant. */
const BUYER_PHONE = /5\s?555\s?55\s?55/;

describe('Commandes vues par le vendeur', () => {
  it('montre ce que le vendeur recevra, sans le téléphone ni le repère de l’acheteur', async () => {
    const orderId = await paidOrder();
    const list = await call(env, m.seller, { method: 'GET', url: '/v1/seller/orders' });
    expect(list.status).toBe(200);
    const order = list.body.items[0];
    expect(order).toMatchObject({
      id: orderId,
      status: 'paid',
      itemsSubtotal: 50_000,
      commission: 5_000,
      sellerNet: 45_000,
      destination: { city: 'Pointe-Noire', zone: 'Tié-Tié', pickupPoint: null },
    });
    expect(order.sellerAcceptDeadline).toBeTruthy();
    expect(order).not.toHaveProperty('shippingAddress');
    expect(JSON.stringify(list.body)).not.toMatch(BUYER_PHONE);

    const detail = await call(env, m.seller, {
      method: 'GET',
      url: `/v1/seller/orders/${orderId}`,
    });
    expect(detail.body.sellerNet).toBe(45_000);
    expect(detail.body.history.map((h: { status: string }) => h.status)).toEqual([
      'pending_payment',
      'paid',
    ]);
    expect(JSON.stringify(detail.body)).not.toMatch(BUYER_PHONE);

    // « En séquestre » : la part du vendeur, pas le total payé (livraison et commission exclues).
    const money = await call(env, m.seller, { method: 'GET', url: '/v1/seller/balance' });
    expect(money.body).toMatchObject({ inEscrow: 45_000, available: 0 });

    // La vue acheteur n'est plus accessible au vendeur.
    const buyerView = await call(env, m.seller, { method: 'GET', url: `/v1/orders/${orderId}` });
    expect(buyerView.status).toBe(404);
  });

  it('filtre « À traiter » sur plusieurs statuts', async () => {
    const first = await paidOrder();
    const second = await paidOrder();
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${second}/accept` });

    const todo = await call(env, m.seller, {
      method: 'GET',
      url: '/v1/seller/orders?status=paid,preparing',
    });
    expect(todo.body.items.map((o: { id: string }) => o.id).sort()).toEqual([first, second].sort());
    const toAccept = await call(env, m.seller, {
      method: 'GET',
      url: '/v1/seller/orders?status=paid',
    });
    expect(toAccept.body.items.map((o: { id: string }) => o.id)).toEqual([first]);
    const invalid = await call(env, m.seller, {
      method: 'GET',
      url: '/v1/seller/orders?status=paid,nimporte',
    });
    expect(invalid.status).toBe(400);
  });

  it('une autre boutique ne voit pas la commande', async () => {
    const orderId = await paidOrder();
    const other = await openShop(env, m.admin, '06 222 22 22');
    const res = await call(env, other, { method: 'GET', url: `/v1/seller/orders/${orderId}` });
    expect(res.status).toBe(404);
    const list = await call(env, other, { method: 'GET', url: '/v1/seller/orders' });
    expect(list.body.items).toEqual([]);
  });

  it('les reversements portent la référence de la commande', async () => {
    const orderId = await buyAndDeliver(env, m);
    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${orderId}/confirm-receipt` });
    await sweep(env);
    const res = await call(env, m.seller, { method: 'GET', url: '/v1/seller/balance' });
    expect(res.body.payouts[0]).toMatchObject({
      orderId,
      publicRef: expect.stringMatching(/^ZD-/),
      status: 'succeeded',
    });
  });
});

describe('Brouillons et publication « photo d’abord »', () => {
  it('un brouillon reste invisible et ne se publie pas sans photo', async () => {
    const draftId = await addProduct(env, m.seller, { title: 'Radio solaire', publish: false });
    const own = await call(env, m.seller, {
      method: 'GET',
      url: `/v1/seller/products/${draftId}`,
    });
    expect(own.body).toMatchObject({
      status: 'draft',
      photos: [],
      description: expect.any(String),
    });
    const catalog = await call(env, null, { method: 'GET', url: '/v1/products?q=radio' });
    expect(catalog.body.items).toHaveLength(0);

    const refused = await call(env, m.seller, {
      method: 'PATCH',
      url: `/v1/seller/products/${draftId}`,
      payload: { status: 'published' },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('photo_required');

    const uploadId = await uploadFile(env, m.seller, 'product_photo');
    await call(env, m.seller, {
      method: 'POST',
      url: `/v1/seller/products/${draftId}/photos`,
      payload: { uploadId },
    });
    const published = await call(env, m.seller, {
      method: 'PATCH',
      url: `/v1/seller/products/${draftId}`,
      payload: { status: 'published' },
    });
    expect(published.body.status).toBe('published');
    const detail = await call(env, m.seller, {
      method: 'GET',
      url: `/v1/seller/products/${draftId}`,
    });
    expect(detail.body.photos).toHaveLength(1);
    expect((await call(env, null, { method: 'GET', url: `/v1/products/${draftId}` })).status).toBe(
      200,
    );
  });

  it('boutique non vérifiée : le brouillon publié part en modération ; refusé puis corrigé, il y repart', async () => {
    const shop = await openShop(env, m.admin, '06 333 33 33', false);
    const draftId = await addProduct(env, shop, { publish: false });
    await call(env, shop, {
      method: 'POST',
      url: `/v1/seller/products/${draftId}/photos`,
      payload: { uploadId: await uploadFile(env, shop, 'product_photo') },
    });
    const submitted = await call(env, shop, {
      method: 'PATCH',
      url: `/v1/seller/products/${draftId}`,
      payload: { status: 'published' },
    });
    expect(submitted.body.status).toBe('pending_review');

    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/admin/products/${draftId}/moderation`,
      payload: { decision: 'rejected', reason: 'Photo floue' },
    });
    const rejected = await call(env, shop, {
      method: 'GET',
      url: `/v1/seller/products/${draftId}`,
    });
    expect(rejected.body).toMatchObject({ status: 'rejected', rejectionReason: 'Photo floue' });

    const resubmitted = await call(env, shop, {
      method: 'PATCH',
      url: `/v1/seller/products/${draftId}`,
      payload: { description: 'Nouvelle photo, de jour', status: 'published' },
    });
    expect(resubmitted.body.status).toBe('pending_review');
  });

  it('les archives sont listées à part ; la fiche d’un autre vendeur est introuvable', async () => {
    await call(env, m.seller, {
      method: 'PATCH',
      url: `/v1/seller/products/${m.productId}`,
      payload: { status: 'archived' },
    });
    const active = await call(env, m.seller, { method: 'GET', url: '/v1/seller/products' });
    expect(active.body.items).toHaveLength(0);
    const archived = await call(env, m.seller, {
      method: 'GET',
      url: '/v1/seller/products?status=archived',
    });
    expect(archived.body.items.map((p: { id: string }) => p.id)).toEqual([m.productId]);

    const other = await openShop(env, m.admin, '06 444 44 44');
    const res = await call(env, other, {
      method: 'GET',
      url: `/v1/seller/products/${m.productId}`,
    });
    expect(res.status).toBe(404);
  });
});

describe('Missions du livreur', () => {
  async function assignedOrder(delivery = homeDelivery): Promise<string> {
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 2 }], delivery);
    const payment = await pay(env, m.buyer, co.id);
    await approveAndNotify(env, payment.body.id);
    const orderId: string = co.orders[0].id;
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/accept` });
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/ready` });
    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/deliveries/${orderId}/assign`,
      payload: { riderId: m.rider.riderId },
    });
    return orderId;
  }

  it('où enlever, où livrer, et combien de codes restent permis', async () => {
    const orderId = await assignedOrder();
    const list = await call(env, m.rider, { method: 'GET', url: '/v1/rider/deliveries' });
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      orderId,
      status: 'assigned',
      orderStatus: 'ready_for_pickup',
      deliveryMode: 'home',
      itemCount: 2,
      handoverAttemptsLeft: 5,
      pickup: { shopName: 'Boutique 1 11', phone: '+242061111111', zone: 'Lumumba (Centre-ville)' },
      destination: { city: 'Pointe-Noire', zone: 'Tié-Tié', pickupPoint: null },
      recipient: { recipientName: 'Grâce M.', phone: '+242055555555' },
    });

    await confirmPickupCode(env, m.rider, m.seller, orderId);
    await call(env, m.rider, { method: 'POST', url: `/v1/rider/deliveries/${orderId}/pickup` });
    await call(env, m.rider, {
      method: 'POST',
      url: `/v1/rider/deliveries/${orderId}/handover`,
      payload: {
        code: (await handoverCodeFor(env, m.buyer.phone)) === '000000' ? '111111' : '000000',
      },
    });
    const detail = await call(env, m.rider, {
      method: 'GET',
      url: `/v1/rider/deliveries/${orderId}`,
    });
    expect(detail.body).toMatchObject({
      status: 'picked_up',
      orderStatus: 'in_delivery',
      handoverAttemptsLeft: 4,
    });
  });

  it('point relais : la destination indique le relais et son repère', async () => {
    const orderId = await assignedOrder({
      ...homeDelivery,
      mode: 'pickup_point',
      pickupPointId: '30000000-0000-4000-8000-000000000002',
    });
    const detail = await call(env, m.rider, {
      method: 'GET',
      url: `/v1/rider/deliveries/${orderId}`,
    });
    expect(detail.body.destination.pickupPoint).toMatchObject({
      name: expect.any(String),
      landmark: expect.any(String),
    });
  });

  it('un autre livreur ne voit pas la mission', async () => {
    const orderId = await assignedOrder();
    const other = await call(env, m.buyer, {
      method: 'GET',
      url: `/v1/rider/deliveries/${orderId}`,
    });
    expect(other.status).toBe(403);
    await env.pool.query(
      `INSERT INTO users (phone, roles) VALUES ('+242067777777', '{buyer,rider}')`,
    );
    const { rows } = await env.pool.query<{ id: string }>(
      `SELECT id FROM users WHERE phone = '+242067777777'`,
    );
    await env.pool.query('INSERT INTO riders (user_id, courier_partner_id) VALUES ($1, $2)', [
      rows[0]!.id,
      '40000000-0000-4000-8000-000000000001',
    ]);
    const rider2 = await login(env, '06 777 77 77');
    const res = await call(env, rider2, { method: 'GET', url: `/v1/rider/deliveries/${orderId}` });
    expect(res.status).toBe(404);
  });
});

describe('Vitrine publique d’une boutique', () => {
  it('nom, ville, confiance et ventes ; jamais le téléphone ; boutique suspendue introuvable', async () => {
    const shop = await call(env, m.seller, { method: 'GET', url: '/v1/seller/shop' });
    const orderId = await buyAndDeliver(env, m);
    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${orderId}/confirm-receipt` });

    const page = await call(env, null, { method: 'GET', url: `/v1/shops/${shop.body.slug}` });
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({
      id: m.seller.sellerId,
      shopName: 'Boutique 1 11',
      slug: shop.body.slug,
      city: 'Pointe-Noire',
      verified: true,
      salesCount: 1,
    });
    // Le numéro du vendeur (06 111 11 11) n'apparaît sous aucune forme ; on cherche le numéro
    // entier, pas « 111 », que peut contenir un identifiant tiré au hasard.
    const shown = JSON.stringify(page.body).replace(/\s/g, '');
    for (const form of ['061111111', '+242061111111']) expect(shown).not.toContain(form);
    expect(page.body).not.toHaveProperty('phone');
    expect(page.body).not.toHaveProperty('payoutPhone');

    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/admin/sellers/${m.seller.sellerId}/verification`,
      payload: { decision: 'suspended', reason: 'Fraude signalée' },
    });
    expect(
      (await call(env, null, { method: 'GET', url: `/v1/shops/${shop.body.slug}` })).status,
    ).toBe(404);
    expect(
      (await call(env, null, { method: 'GET', url: '/v1/shops/Pas%20un%20slug' })).status,
    ).toBe(400);
  });
});
