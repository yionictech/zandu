import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  approveAndNotify,
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

const SECRET = 'secret-livekit-de-test-0123456789abcdef';
let env: TestEnv;
let m: Marketplace;

beforeAll(async () => {
  env = await createTestEnv({
    LIVEKIT_URL: 'wss://appel.recette.zandu.cg',
    LIVEKIT_API_KEY: 'APIzandu',
    LIVEKIT_API_SECRET: SECRET,
  });
});
afterAll(async () => env.close());
beforeEach(async () => {
  m = await setupMarketplace(env);
});

async function paidOrder(): Promise<string> {
  const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
  const payment = await pay(env, m.buyer, co.id);
  await approveAndNotify(env, payment.body.id);
  await sweep(env);
  return co.orders[0].id;
}

function claims(token: string) {
  const [header, payload, signature] = token.split('.');
  expect(createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')).toBe(
    signature,
  );
  return JSON.parse(Buffer.from(payload!, 'base64url').toString());
}

describe('Appels dans l’application (LiveKit)', () => {
  it('l’acheteur appelle le vendeur : sonnerie, notification, décroché, raccroché', async () => {
    const orderId = await paidOrder();
    await call(env, m.seller, {
      method: 'PUT',
      url: '/v1/me/devices',
      payload: { token: 'ExponentPushToken[vendeur]', platform: 'android' },
    });
    const started = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/orders/${orderId}/calls`,
      payload: { to: 'seller' },
    });
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({
      status: 'ringing',
      direction: 'outgoing',
      peer: { role: 'seller' },
    });
    expect(started.body.livekit.url).toBe('wss://appel.recette.zandu.cg');
    const mine = claims(started.body.livekit.token);
    expect(mine).toMatchObject({
      iss: 'APIzandu',
      sub: m.buyer.userId,
      video: { room: `call-${started.body.id}`, roomJoin: true, canPublishData: false },
    });

    await sweep(env);
    expect(env.notifier.sent.filter((s) => s.template === 'incoming_call')).toEqual([
      expect.objectContaining({
        recipient: 'ExponentPushToken[vendeur]',
        title: 'Appel entrant',
        data: expect.objectContaining({ url: `/appel/${started.body.id}` }),
      }),
    ]);

    const incoming = await call(env, m.seller, { method: 'GET', url: '/v1/me/calls/incoming' });
    expect(incoming.body.items).toEqual([
      expect.objectContaining({
        id: started.body.id,
        direction: 'incoming',
        peer: { role: 'buyer', name: expect.any(String) },
      }),
    ]);
    // Aucun numéro de téléphone dans l'appel.
    expect(JSON.stringify(incoming.body)).not.toMatch(/\+242/);

    const accepted = await call(env, m.seller, {
      method: 'POST',
      url: `/v1/calls/${started.body.id}/accept`,
    });
    expect(accepted.body.status).toBe('accepted');
    expect(claims(accepted.body.livekit.token).video.room).toBe(`call-${started.body.id}`);
    expect(
      (await call(env, m.buyer, { method: 'GET', url: `/v1/calls/${started.body.id}` })).body
        .status,
    ).toBe('accepted');

    expect(
      (await call(env, m.buyer, { method: 'POST', url: `/v1/calls/${started.body.id}/end` }))
        .status,
    ).toBe(204);
    expect(
      (await call(env, m.seller, { method: 'GET', url: `/v1/calls/${started.body.id}` })).body
        .status,
    ).toBe('ended');
  });

  it('sans réponse : manqué au bout de 45 s ; refus ; étrangers et livreur pas encore affecté', async () => {
    const orderId = await paidOrder();
    const first = await call(env, m.seller, {
      method: 'POST',
      url: `/v1/orders/${orderId}/calls`,
      payload: { to: 'buyer' },
    });
    env.clock.advanceMinutes(1);
    expect(
      (await call(env, m.buyer, { method: 'GET', url: '/v1/me/calls/incoming' })).body.items,
    ).toEqual([]);
    expect(
      (await call(env, m.seller, { method: 'GET', url: `/v1/calls/${first.body.id}` })).body.status,
    ).toBe('missed');
    expect(
      (await call(env, m.buyer, { method: 'POST', url: `/v1/calls/${first.body.id}/accept` }))
        .status,
    ).toBe(409);

    const second = await call(env, m.seller, {
      method: 'POST',
      url: `/v1/orders/${orderId}/calls`,
      payload: { to: 'buyer' },
    });
    expect(
      (await call(env, m.buyer, { method: 'POST', url: `/v1/calls/${second.body.id}/decline` }))
        .status,
    ).toBe(204);
    expect(
      (await call(env, m.seller, { method: 'GET', url: `/v1/calls/${second.body.id}` })).body
        .status,
    ).toBe('declined');

    expect(
      (
        await call(env, m.buyer, {
          method: 'POST',
          url: `/v1/orders/${orderId}/calls`,
          payload: { to: 'rider' },
        })
      ).status,
    ).toBe(409);
    const stranger = await login(env, '06 444 44 44');
    expect(
      (await call(env, stranger, { method: 'GET', url: `/v1/calls/${second.body.id}` })).status,
    ).toBe(404);
    expect(
      (
        await call(env, stranger, {
          method: 'POST',
          url: `/v1/orders/${orderId}/calls`,
          payload: { to: 'buyer' },
        })
      ).status,
    ).toBe(404);
  });
});

describe('Appels non configurés', () => {
  it('503 clair plutôt qu’un appel qui ne sonne jamais', async () => {
    const plain = await createTestEnv();
    try {
      const mk = await setupMarketplace(plain);
      const co = await checkout(plain, mk.buyer, [{ productId: mk.productId, quantity: 1 }]);
      const res = await call(plain, mk.buyer, {
        method: 'POST',
        url: `/v1/orders/${co.orders[0].id}/calls`,
        payload: { to: 'seller' },
      });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('calls_unavailable');
    } finally {
      await plain.close();
    }
  });
});
