import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buyAndDeliver,
  call,
  checkout,
  createTestEnv,
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

const status = (orderId: string) =>
  call(env, m.buyer, { method: 'GET', url: `/v1/orders/${orderId}/rider-review` });
const rate = (orderId: string, payload: object) =>
  call(env, m.buyer, { method: 'POST', url: `/v1/orders/${orderId}/rider-review`, payload });

describe('Avis sur le livreur', () => {
  it('après la remise, une fois ; le livreur voit sa moyenne', async () => {
    const orderId = await buyAndDeliver(env, m);
    expect((await status(orderId)).body).toMatchObject({
      canRate: true,
      rider: { name: expect.any(String) },
      review: null,
    });
    expect((await rate(orderId, { rating: 5, tags: ['ponctuel', 'poli'] })).status).toBe(201);
    expect((await rate(orderId, { rating: 4 })).status).toBe(409);
    expect((await status(orderId)).body).toMatchObject({
      canRate: false,
      review: { rating: 5, tags: ['ponctuel', 'poli'] },
    });
    const me = await call(env, m.rider, { method: 'GET', url: '/v1/rider/me' });
    expect(me.body.rating).toEqual({ average: 5, count: 1 });
  });

  it('pas avant la remise ; une mauvaise note prévient le support', async () => {
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
    const pending = co.orders[0].id;
    expect((await status(pending)).body.canRate).toBe(false);
    expect((await rate(pending, { rating: 3 })).status).toBe(409);

    const orderId = await buyAndDeliver(env, m);
    expect(
      (await rate(orderId, { rating: 1, tags: ['impoli'], comment: 'Il a crié sur ma mère.' }))
        .status,
    ).toBe(201);
    await sweep(env);
    const alert = env.notifier.sent.find(
      (s) => s.template === 'support_alert' && s.variables.message?.includes('Livreur noté 1/5'),
    );
    expect(alert).toBeDefined();
    // Un tag inconnu est refusé ; l'avis n'est pas public (pas d'accès pour un autre).
    expect((await rate(orderId, { rating: 5, tags: ['rapide'] })).status).toBe(400);
    expect(
      (await call(env, m.seller, { method: 'GET', url: `/v1/orders/${orderId}/rider-review` }))
        .status,
    ).toBe(404);
  });
});
