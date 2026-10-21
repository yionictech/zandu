import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  approveAndNotify,
  buyAndDeliver,
  call,
  checkout,
  confirmPickupCode,
  createTestEnv,
  handoverCodeFor,
  login,
  orderStatus,
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

/** Commande payée, prête, attribuée au livreur du marché de test. */
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

const mission = async (orderId: string) =>
  (await call(env, m.rider, { method: 'GET', url: `/v1/rider/deliveries/${orderId}` })).body;

const post = (session: Session, url: string, payload?: unknown) =>
  call(env, session, { method: 'POST', url, ...(payload ? { payload } : {}) });

describe('Espace livreur, nouvelle direction visuelle', () => {
  it('code de retrait : le vendeur le confirme avant que le livreur prenne le colis', async () => {
    const orderId = await assignedOrder();
    const before = await mission(orderId);
    expect(before.pickupCode).toMatch(/^\d{4}$/);
    expect(before.items).toEqual([{ title: expect.any(String), quantity: 1 }]);

    // Sans le code confirmé par le vendeur, pas de prise en charge.
    const early = await post(m.rider, `/v1/rider/deliveries/${orderId}/pickup`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('pickup_not_confirmed');

    const wrong = before.pickupCode === '0000' ? '1111' : '0000';
    const bad = await post(m.seller, `/v1/seller/orders/${orderId}/rider-pickup`, { code: wrong });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('invalid_pickup_code');

    // Un autre vendeur ne peut pas confirmer à la place du bon.
    const other = await login(env, '06 731 42 86');
    expect(
      (await post(other, `/v1/seller/orders/${orderId}/rider-pickup`, { code: before.pickupCode }))
        .status,
    ).toBe(403);

    const seen = await call(env, m.seller, { method: 'GET', url: `/v1/seller/orders/${orderId}` });
    expect(seen.body.delivery).toMatchObject({ status: 'assigned', pickupConfirmedAt: null });

    await confirmPickupCode(env, m.rider, m.seller, orderId);
    expect((await mission(orderId)).pickupConfirmedAt).not.toBeNull();
    expect((await post(m.rider, `/v1/rider/deliveries/${orderId}/pickup`)).body.status).toBe(
      'in_delivery',
    );
    // Le code n'est plus montré une fois le colis pris.
    expect((await mission(orderId)).pickupCode).toBeNull();
  });

  it('réattribuer la course change le code de retrait', async () => {
    const orderId = await assignedOrder();
    const first = (await mission(orderId)).pickupCode;
    const codes = new Set([first]);
    for (let i = 0; i < 4; i++) {
      await post(m.admin, `/v1/support/deliveries/${orderId}/assign`, {
        riderId: m.rider.riderId,
      });
      codes.add((await mission(orderId)).pickupCode);
    }
    expect(codes.size).toBeGreaterThan(1);
    // L'ancien code ne sert plus (sauf s'il a été tiré à nouveau).
    const current = (await mission(orderId)).pickupCode;
    if (first !== current) {
      const res = await post(m.seller, `/v1/seller/orders/${orderId}/rider-pickup`, {
        code: first,
      });
      expect(res.status).toBe(422);
    }
  });

  it('cliente absente : arrivée, SMS, attente de 10 min, puis retour au vendeur avec un code', async () => {
    const orderId = await assignedOrder();
    await confirmPickupCode(env, m.rider, m.seller, orderId);
    await post(m.rider, `/v1/rider/deliveries/${orderId}/pickup`);

    // Pas d'appel ni d'absence avant d'être arrivé.
    expect((await post(m.rider, `/v1/rider/deliveries/${orderId}/contact-attempt`)).status).toBe(
      409,
    );
    const arrived = await post(m.rider, `/v1/rider/deliveries/${orderId}/arrived`);
    expect(arrived.status).toBe(200);
    expect(
      new Date(arrived.body.absentAllowedAt).getTime() - new Date(arrived.body.arrivedAt).getTime(),
    ).toBe(10 * 60_000);
    await sweep(env);
    expect(env.notifier.lastTo(m.buyer.phone, 'buyer_rider_arrived')?.channel).toBe('sms');

    expect((await post(m.rider, `/v1/rider/deliveries/${orderId}/contact-attempt`)).status).toBe(
      201,
    );
    const waiting = await mission(orderId);
    expect(waiting.contacts.map((c: { kind: string }) => c.kind)).toEqual(['sms', 'call']);

    const tooSoon = await post(m.rider, `/v1/rider/deliveries/${orderId}/return`, {
      reason: 'absent',
    });
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.error.code).toBe('absent_wait');

    env.clock.advanceMinutes(10);
    const back = await post(m.rider, `/v1/rider/deliveries/${orderId}/return`, {
      reason: 'absent',
    });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ status: 'returning', failureReason: 'cliente absente' });
    expect(back.body.returnCode).toMatch(/^\d{4}$/);
    // L'argent reste bloqué : la commande est toujours « en livraison ».
    expect(await orderStatus(env, orderId)).toBe('in_delivery');
    await sweep(env);
    expect(env.notifier.lastTo(m.buyer.phone, 'buyer_delivery_returning')).toBeDefined();

    // Le code de remise de la cliente ne sert plus pendant le retour.
    const code = await handoverCodeFor(env, m.buyer.phone);
    expect((await post(m.rider, `/v1/rider/deliveries/${orderId}/handover`, { code })).status).toBe(
      409,
    );

    // Rendu au vendeur : il saisit le code de retour, puis le livreur termine.
    expect((await post(m.rider, `/v1/rider/deliveries/${orderId}/returned`)).status).toBe(409);
    const seller = await call(env, m.seller, {
      method: 'GET',
      url: `/v1/seller/orders/${orderId}`,
    });
    expect(seller.body.delivery).toMatchObject({ status: 'returning', returnConfirmedAt: null });
    expect(
      (
        await post(m.seller, `/v1/seller/orders/${orderId}/rider-return`, {
          code: back.body.returnCode,
        })
      ).status,
    ).toBe(200);
    const done = await post(m.rider, `/v1/rider/deliveries/${orderId}/returned`);
    expect(done.body.status).toBe('disputed');

    const { rows } = await env.pool.query<{ description: string }>(
      'SELECT description FROM disputes WHERE order_id = $1',
      [orderId],
    );
    expect(rows[0]!.description).toBe(
      'Livraison impossible : cliente absente, colis rendu au vendeur',
    );
    const events = await call(env, m.admin, { method: 'GET', url: '/v1/support/delivery-events' });
    expect(events.body.items[0]).toMatchObject({
      kind: 'absent',
      orderId,
      deliveryStatus: 'failed',
    });

    const history = await call(env, m.rider, { method: 'GET', url: '/v1/rider/history' });
    expect(history.body).toMatchObject({ delivered: 0, returned: 1 });
    expect(history.body.items[0]).toMatchObject({
      outcome: 'returned',
      publicRef: expect.any(String),
    });
  });

  it('colis refusé : retour sans attendre', async () => {
    const orderId = await assignedOrder();
    await confirmPickupCode(env, m.rider, m.seller, orderId);
    await post(m.rider, `/v1/rider/deliveries/${orderId}/pickup`);
    await post(m.rider, `/v1/rider/deliveries/${orderId}/arrived`);
    const back = await post(m.rider, `/v1/rider/deliveries/${orderId}/return`, {
      reason: 'refused',
      note: 'mauvaise couleur',
    });
    expect(back.body).toMatchObject({
      status: 'returning',
      failureReason: 'colis refusé (mauvaise couleur)',
    });
  });

  it('incident : le support est prévenu, la course reste attribuée', async () => {
    const orderId = await assignedOrder();
    const res = await post(m.rider, `/v1/rider/deliveries/${orderId}/incident`, {
      kind: 'breakdown',
      note: 'Pneu crevé à Mpita',
    });
    expect(res.status).toBe(201);
    const events = await call(env, m.admin, { method: 'GET', url: '/v1/support/delivery-events' });
    expect(events.body.items[0]).toMatchObject({
      kind: 'incident',
      incident: 'breakdown',
      note: 'Pneu crevé à Mpita',
      deliveryStatus: 'assigned',
    });
    expect((await mission(orderId)).status).toBe('assigned');
    // Le livreur ne voit pas le journal du support.
    expect(
      (await call(env, m.rider, { method: 'GET', url: '/v1/support/delivery-events' })).status,
    ).toBe(403);
  });

  it('profil et historique : courses du jour, durée moyenne', async () => {
    await buyAndDeliver(env, m);
    const me = await call(env, m.rider, { method: 'GET', url: '/v1/rider/me' });
    expect(me.body).toMatchObject({ deliveredToday: 1, deliveredTotal: 1, inProgress: 0 });
    expect(me.body.partnerName).toEqual(expect.any(String));
    const history = await call(env, m.rider, {
      method: 'GET',
      url: '/v1/rider/history?period=30d',
    });
    expect(history.body).toMatchObject({ delivered: 1, returned: 0 });
    expect(history.body.items[0]).toMatchObject({ outcome: 'delivered', minutes: 0 });
  });
});
