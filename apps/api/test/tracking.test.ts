import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  approveAndNotify,
  call,
  checkout,
  confirmPickupCode,
  createTestEnv,
  handoverCodeFor,
  login,
  pay,
  setupMarketplace,
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

/** Pointe-Noire, rond-point Lumumba. */
const HERE = { lat: -4.7761, lng: 11.8635, accuracy: 12 };

async function assignedOrder(): Promise<string> {
  const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
  await approveAndNotify(env, (await pay(env, m.buyer, co.id)).body.id);
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

const tracking = (orderId: string, who = m.buyer) =>
  call(env, who, { method: 'GET', url: `/v1/orders/${orderId}/tracking` });
const share = (orderId: string, position = HERE) =>
  call(env, m.rider, {
    method: 'POST',
    url: `/v1/rider/deliveries/${orderId}/position`,
    payload: position,
  });

describe('Livreur en route (docs/ux/03 §4.2)', () => {
  it('position partagée seulement en route, visible du seul acheteur, effacée à la remise', async () => {
    const orderId = await assignedOrder();
    expect((await tracking(orderId)).body).toEqual({
      onTheWay: false,
      rider: null,
      position: null,
    });
    // Pas de position avant d'avoir le colis.
    expect((await share(orderId)).status).toBe(409);

    await confirmPickupCode(env, m.rider, m.seller, orderId);
    await call(env, m.rider, { method: 'POST', url: `/v1/rider/deliveries/${orderId}/pickup` });
    expect((await share(orderId)).status).toBe(204);
    const seen = await tracking(orderId);
    expect(seen.body).toMatchObject({
      onTheWay: true,
      rider: { phone: expect.stringMatching(/^\+242/) },
      position: { lat: HERE.lat, lng: HERE.lng, accuracy: 12 },
    });

    // Un autre acheteur ne voit rien.
    const stranger = await login(env, '05 731 20 46');
    expect((await tracking(orderId, stranger)).status).toBe(404);

    // Une position de plus de 10 minutes n'est plus montrée.
    env.clock.advanceMinutes(11);
    expect((await tracking(orderId)).body.position).toBeNull();
    await share(orderId, { lat: -4.78, lng: 11.87, accuracy: 8 });
    expect((await tracking(orderId)).body.position).toMatchObject({ lat: -4.78 });

    // Remise : la position est effacée, rien n'est gardé.
    const code = await handoverCodeFor(env, m.buyer.phone);
    await call(env, m.rider, {
      method: 'POST',
      url: `/v1/rider/deliveries/${orderId}/handover`,
      payload: { code },
    });
    expect((await env.pool.query('SELECT 1 FROM rider_positions')).rowCount).toBe(0);
    expect((await tracking(orderId)).body).toEqual({
      onTheWay: false,
      rider: null,
      position: null,
    });
  });

  it('coordonnées invalides refusées', async () => {
    const orderId = await assignedOrder();
    await confirmPickupCode(env, m.rider, m.seller, orderId);
    await call(env, m.rider, { method: 'POST', url: `/v1/rider/deliveries/${orderId}/pickup` });
    expect((await share(orderId, { lat: 120, lng: 11, accuracy: 5 })).status).toBe(400);
  });
});
