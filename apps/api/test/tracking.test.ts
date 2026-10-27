import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  approveAndNotify,
  call,
  checkout,
  confirmPickupCode,
  createTestEnv,
  handoverCodeFor,
  homeDelivery,
  login,
  pay,
  PICKUP_TIE_TIE,
  setupMarketplace,
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

/** Pointe-Noire, rond-point Lumumba. */
const HERE = { lat: -4.7761, lng: 11.8635, accuracy: 12 };

/** Tié-Tié, derrière l'école : à 2 km environ du rond-point. */
const HOME = { lat: -4.7612, lng: 11.8735, accuracy: 20 };
const NOT_ON_THE_WAY = {
  onTheWay: false,
  rider: null,
  position: null,
  destination: null,
  distanceMeters: null,
  etaMinutes: null,
};

async function assignedOrder(delivery = homeDelivery): Promise<string> {
  const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }], delivery);
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
    expect((await tracking(orderId)).body).toEqual(NOT_ON_THE_WAY);
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
    expect((await tracking(orderId)).body).toEqual(NOT_ON_THE_WAY);
  });

  it('coordonnées invalides refusées', async () => {
    const orderId = await assignedOrder();
    await confirmPickupCode(env, m.rider, m.seller, orderId);
    await call(env, m.rider, { method: 'POST', url: `/v1/rider/deliveries/${orderId}/pickup` });
    expect((await share(orderId, { lat: 120, lng: 11, accuracy: 5 })).status).toBe(400);
  });

  it('repère posé à la commande : le livreur voit la destination, le client le temps d’arrivée', async () => {
    const orderId = await assignedOrder({ ...homeDelivery, location: HOME });
    const mission = await call(env, m.rider, {
      method: 'GET',
      url: `/v1/rider/deliveries/${orderId}`,
    });
    expect(mission.body.destination.location).toEqual({
      lat: HOME.lat,
      lng: HOME.lng,
      accuracy: 20,
    });

    await confirmPickupCode(env, m.rider, m.seller, orderId);
    await call(env, m.rider, { method: 'POST', url: `/v1/rider/deliveries/${orderId}/pickup` });
    // Sans position du livreur, pas d'estimation.
    expect((await tracking(orderId)).body).toMatchObject({
      destination: { lat: HOME.lat, lng: HOME.lng },
      etaMinutes: null,
    });
    await share(orderId);
    const seen = (await tracking(orderId)).body;
    expect(seen.distanceMeters).toBeGreaterThan(1900);
    expect(seen.distanceMeters).toBeLessThan(2100);
    expect(seen.etaMinutes).toBe(10);
  });

  it('point relais : ses coordonnées servent de destination, le repère du client est ignoré', async () => {
    const orderId = await assignedOrder({
      ...homeDelivery,
      mode: 'pickup_point',
      zoneId: ZONES.tieTie,
      pickupPointId: PICKUP_TIE_TIE,
      location: { lat: -4.7, lng: 11.9 },
    });
    const mission = await call(env, m.rider, {
      method: 'GET',
      url: `/v1/rider/deliveries/${orderId}`,
    });
    expect(mission.body.destination.location).toEqual({ lat: -4.7612, lng: 11.8735 });
    expect(mission.body.recipient.location).toBeUndefined();
  });

  it('repère hors du Congo refusé', async () => {
    const res = await call(env, m.buyer, {
      method: 'POST',
      url: '/v1/checkouts',
      headers: { 'idempotency-key': `geo-${Date.now()}` },
      payload: {
        items: [{ productId: m.productId, quantity: 1 }],
        delivery: { ...homeDelivery, location: { lat: 48.85, lng: 2.35 } },
      },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('location_out_of_area');
  });
});
