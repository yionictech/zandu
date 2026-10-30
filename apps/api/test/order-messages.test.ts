import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  approveAndNotify,
  call,
  checkout,
  confirmPickupCode,
  createTestEnv,
  login,
  pay,
  setupMarketplace,
  sweep,
  type Marketplace,
  type Session,
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

const read = (who: Session, orderId: string) =>
  call(env, who, { method: 'GET', url: `/v1/orders/${orderId}/messages` });
const write = (who: Session, orderId: string, body: string) =>
  call(env, who, { method: 'POST', url: `/v1/orders/${orderId}/messages`, payload: { body } });

async function paidOrder(): Promise<string> {
  const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
  const payment = await pay(env, m.buyer, co.id);
  await approveAndNotify(env, payment.body.id);
  await sweep(env);
  return co.orders[0].id;
}

describe('Messagerie de la commande', () => {
  it('acheteur et vendeur échangent ; le livreur rejoint à l’affectation ; pas les autres', async () => {
    const orderId = await paidOrder();
    const sent = await write(m.buyer, orderId, 'Bonjour, la robe existe en taille M ?');
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ role: 'buyer', mine: true });

    const seller = await read(m.seller, orderId);
    expect(seller.status).toBe(200);
    expect(seller.body).toMatchObject({ me: 'seller', canWrite: true });
    expect(seller.body.participants).toEqual([{ role: 'buyer', name: expect.any(String) }]);
    expect(seller.body.items).toEqual([
      expect.objectContaining({
        role: 'buyer',
        mine: false,
        body: 'Bonjour, la robe existe en taille M ?',
      }),
    ]);
    // Aucun numéro de téléphone dans la conversation.
    expect(JSON.stringify(seller.body)).not.toMatch(/\+242/);

    // Le livreur n'y a pas accès avant d'être affecté ; un inconnu jamais.
    expect((await read(m.rider, orderId)).status).toBe(404);
    const stranger = await login(env, '06 444 44 44');
    expect((await write(stranger, orderId, 'coucou')).status).toBe(404);

    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/accept` });
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/ready` });
    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/deliveries/${orderId}/assign`,
      payload: { riderId: m.rider.riderId },
    });
    await confirmPickupCode(env, m.rider, m.seller, orderId);
    expect((await write(m.rider, orderId, 'Je suis en route, 10 minutes.')).status).toBe(201);
    const buyer = await read(m.buyer, orderId);
    expect(buyer.body.participants.map((p: { role: string }) => p.role)).toEqual([
      'seller',
      'rider',
    ]);
    expect(buyer.body.items.map((i: { role: string }) => i.role)).toEqual(['buyer', 'rider']);
  });

  it('non lus, notification sur le téléphone seulement, et conversation close à la fin', async () => {
    const orderId = await paidOrder();
    await call(env, m.seller, {
      method: 'PUT',
      url: '/v1/me/devices',
      payload: { token: 'ExponentPushToken[vendeur]', platform: 'android' },
    });
    await write(m.buyer, orderId, 'Merci de bien emballer');
    await sweep(env);
    const pushes = env.notifier.sent.filter((s) => s.template === 'order_message');
    expect(pushes).toEqual([
      expect.objectContaining({
        channel: 'push',
        recipient: 'ExponentPushToken[vendeur]',
        title: 'Nouveau message',
        data: expect.objectContaining({ url: `/messages/${orderId}` }),
      }),
    ]);
    expect(pushes[0]!.text).toContain('Merci de bien emballer');

    const unread = await call(env, m.seller, { method: 'GET', url: '/v1/me/conversations' });
    expect(unread.body).toMatchObject({ totalUnread: 1, items: [{ orderId, unread: 1 }] });
    await read(m.seller, orderId);
    expect(
      (await call(env, m.seller, { method: 'GET', url: '/v1/me/conversations' })).body.totalUnread,
    ).toBe(0);

    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${orderId}/cancel` });
    const closed = await read(m.buyer, orderId);
    expect(closed.body.canWrite).toBe(false);
    expect((await write(m.buyer, orderId, 'encore ?')).status).toBe(409);
  });

  it('le support lit et répond ; trop de messages d’un coup est refusé', async () => {
    const orderId = await paidOrder();
    for (let i = 0; i < 20; i++) await write(m.buyer, orderId, `message ${i}`);
    expect((await write(m.buyer, orderId, 'un de trop')).status).toBe(429);
    const support = await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/orders/${orderId}/messages`,
      payload: { body: 'Bonjour, le support suit votre commande.' },
    });
    expect(support.status).toBe(201);
    const list = await call(env, m.admin, {
      method: 'GET',
      url: `/v1/support/orders/${orderId}/messages`,
    });
    expect(list.body.items).toHaveLength(21);
    expect((await read(m.buyer, orderId)).body.items.at(-1)).toMatchObject({
      role: 'support',
      name: 'Support Zandu',
    });
  });
});
