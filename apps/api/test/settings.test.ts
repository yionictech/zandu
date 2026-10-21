import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  approveAndNotify,
  call,
  checkout,
  createTestEnv,
  login,
  orderStatus,
  pay,
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
afterAll(async () => {
  await env.pool.query('DELETE FROM platform_settings');
  await env.close();
});
beforeEach(async () => {
  m = await setupMarketplace(env);
  await env.pool.query('DELETE FROM platform_settings');
});

async function paidOrder(): Promise<{ id: string; deadline: string; paidAt: string }> {
  const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
  await approveAndNotify(env, (await pay(env, m.buyer, co.id)).body.id);
  const order = await call(env, m.buyer, { method: 'GET', url: `/v1/orders/${co.orders[0].id}` });
  return {
    id: order.body.id,
    deadline: order.body.sellerAcceptDeadline,
    paidAt: order.body.paidAt,
  };
}

const hoursBetween = (from: string, to: string) =>
  (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;

describe('Délai d’acceptation du vendeur réglable (docs/ux/03 §4.4)', () => {
  it('par défaut, la valeur du serveur (24 h)', async () => {
    const res = await call(env, m.admin, { method: 'GET', url: '/v1/admin/settings' });
    expect(res.body.delays.sellerAcceptance).toMatchObject({
      minutes: 1440,
      source: 'default',
      updatedAt: null,
      choices: [10, 30, 60, 120, 240, 720, 1440],
    });
    const order = await paidOrder();
    expect(hoursBetween(order.paidAt, order.deadline)).toBe(24);
  });

  it('réglé à 2 h : les nouvelles commandes ont 2 h, les anciennes gardent leur délai', async () => {
    const before = await paidOrder();
    const res = await call(env, m.admin, {
      method: 'PATCH',
      url: '/v1/admin/settings',
      payload: { sellerAcceptanceMinutes: 120, reason: 'Recommandation §4.4 : démarrer à 2 h' },
    });
    expect(res.status).toBe(200);
    expect(res.body.delays.sellerAcceptance).toMatchObject({ minutes: 120, source: 'custom' });
    expect(res.body.delays.sellerAcceptanceHours).toBe(2);

    const after = await paidOrder();
    expect(hoursBetween(after.paidAt, after.deadline)).toBe(2);
    const old = await call(env, m.buyer, { method: 'GET', url: `/v1/orders/${before.id}` });
    expect(old.body.sellerAcceptDeadline).toBe(before.deadline);

    // Sans réponse du vendeur en 2 h : annulée et remboursée ; l'ancienne attend toujours.
    env.clock.advanceMinutes(121);
    await sweep(env);
    expect(await orderStatus(env, after.id)).toBe('cancelled');
    expect(await orderStatus(env, before.id)).toBe('paid');

    const { rows } = await env.pool.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_logs WHERE action = 'settings.seller_acceptance' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows[0]!.metadata).toMatchObject({ from: 1440, to: 120 });
  });

  it('valeurs fixes, motif obligatoire, administrateurs seulement', async () => {
    const odd = await call(env, m.admin, {
      method: 'PATCH',
      url: '/v1/admin/settings',
      payload: { sellerAcceptanceMinutes: 45, reason: 'Essai d’une valeur libre' },
    });
    expect(odd.status).toBe(400);
    const noReason = await call(env, m.admin, {
      method: 'PATCH',
      url: '/v1/admin/settings',
      payload: { sellerAcceptanceMinutes: 60 },
    });
    expect(noReason.status).toBe(400);
    const support = await login(env, '06 452 61 37', ['buyer', 'support']);
    const forbidden = await call(env, support, {
      method: 'PATCH',
      url: '/v1/admin/settings',
      payload: { sellerAcceptanceMinutes: 60, reason: 'Le support essaie' },
    });
    expect(forbidden.status).toBe(403);
  });
});
