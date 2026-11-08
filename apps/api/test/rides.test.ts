import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  approveAndNotify,
  balance,
  call,
  COURIER_PARTNER,
  createTestEnv,
  idemKey,
  login,
  pay,
  setupMarketplace,
  sweep,
  trialBalance,
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

const LUMUMBA = { lat: -4.7761, lng: 11.8635, accuracy: 10 };
const TIE_TIE = { lat: -4.7612, lng: 11.8735 };
const rideBody = {
  pickup: {
    zoneId: ZONES.lumumba,
    landmark: 'Rond-point Lumumba, devant la pharmacie',
    location: LUMUMBA,
  },
  destination: { zoneId: ZONES.tieTie, landmark: 'École Saint-Pierre', location: TIE_TIE },
};

async function paidRide() {
  const created = await call(env, m.buyer, {
    method: 'POST',
    url: '/v1/rides',
    headers: { 'idempotency-key': idemKey() },
    payload: rideBody,
  });
  expect(created.status).toBe(201);
  const payment = await pay(env, m.buyer, created.body.checkoutId);
  await approveAndNotify(env, payment.body.id);
  await sweep(env);
  return created.body as { orderId: string; total: number };
}

describe('Moto-taxi', () => {
  it('prix à la distance, course acceptée par un conducteur, payée à la fin', async () => {
    const q = await call(env, m.buyer, {
      method: 'GET',
      url: `/v1/rides/quote?fromLat=${LUMUMBA.lat}&fromLng=${LUMUMBA.lng}&toLat=${TIE_TIE.lat}&toLng=${TIE_TIE.lng}`,
    });
    expect(q.body.price).toBeGreaterThanOrEqual(500);
    expect(q.body.distanceMeters).toBeGreaterThan(2000);

    const { orderId, total } = await paidRide();
    expect(total).toBe(q.body.price);
    expect(env.notifier.lastTo(m.buyer.phone, 'ride_paid')).toBeTruthy();
    const code = env.notifier.lastTo(m.buyer.phone, 'ride_code')!.variables.code!;

    // La course apparaît dans les offres des livreurs ; le premier qui accepte la prend.
    const offers = await call(env, m.rider, { method: 'GET', url: '/v1/rider/offers' });
    expect(offers.body.items[0]).toMatchObject({
      orderId,
      kind: 'ride',
      from: 'Lumumba (Centre-ville)',
    });
    expect(offers.body.items[0].earning).toBeLessThan(total);
    const accepted = await call(env, m.rider, {
      method: 'POST',
      url: `/v1/rider/offers/${orderId}/accept`,
    });
    expect(accepted.body).toMatchObject({ kind: 'ride', status: 'assigned' });
    const other = await login(env, '06 777 12 12', ['buyer', 'rider']);
    await env.pool.query('INSERT INTO riders (user_id, courier_partner_id) VALUES ($1, $2)', [
      other.userId,
      COURIER_PARTNER,
    ]);
    expect(
      (await call(env, other, { method: 'POST', url: `/v1/rider/offers/${orderId}/accept` })).body
        .error.code,
    ).toBe('offer_taken');
    await sweep(env);
    expect(env.notifier.lastTo(m.buyer.phone, 'ride_driver_coming')).toBeTruthy();

    // Le passager saisit le code du conducteur en montant ; à l'arrivée il donne son code SMS.
    const confirmed = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/rides/${orderId}/rider-pickup`,
      payload: { code: accepted.body.pickupCode },
    });
    expect(confirmed.status).toBe(200);
    await call(env, m.rider, { method: 'POST', url: `/v1/rider/deliveries/${orderId}/pickup` });
    const done = await call(env, m.rider, {
      method: 'POST',
      url: `/v1/rider/deliveries/${orderId}/handover`,
      payload: { code },
    });
    expect(done.body.status).toBe('delivered');
    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${orderId}/confirm-receipt` });
    await sweep(env);
    const { rows } = await env.pool.query<{ share: number }>(
      'SELECT courier_share::int AS share FROM orders WHERE id = $1',
      [orderId],
    );
    expect(await balance(env, `liability:courier_payable:${COURIER_PARTNER}`)).toBe(rows[0]!.share);
    expect(await balance(env, 'liability:escrow')).toBe(0);
    expect(await trialBalance(env)).toBe(0);
    const mine = await call(env, m.buyer, { method: 'GET', url: '/v1/rides' });
    expect(mine.body.items[0]).toMatchObject({ kind: 'ride', status: 'completed' });
  });

  it('annulation avant le départ remboursée ; trajets refusés', async () => {
    const { orderId } = await paidRide();
    const cancelled = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/rides/${orderId}/cancel`,
    });
    expect(cancelled.body.status).toBe('cancelled');
    expect(
      (await call(env, m.rider, { method: 'GET', url: '/v1/rider/offers' })).body.items,
    ).toHaveLength(0);

    const tooShort = await call(env, m.buyer, {
      method: 'POST',
      url: '/v1/rides',
      headers: { 'idempotency-key': idemKey() },
      payload: { ...rideBody, destination: { ...rideBody.destination, location: LUMUMBA } },
    });
    expect(tooShort.body.error.code).toBe('ride_too_short');
    const paris = await call(env, m.buyer, {
      method: 'GET',
      url: `/v1/rides/quote?fromLat=48.85&fromLng=2.35&toLat=${TIE_TIE.lat}&toLng=${TIE_TIE.lng}`,
    });
    expect(paris.body.error.code).toBe('location_out_of_area');
  });
});
