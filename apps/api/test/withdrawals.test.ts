import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processPayouts, sweepSellerBalances } from '../src/modules/payouts/payouts.service.js';
import {
  balance,
  buyAndDeliver,
  call,
  createTestEnv,
  login,
  setupMarketplace,
  trialBalance,
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

const settings = (payload: Record<string, unknown>) =>
  call(env, m.admin, {
    method: 'PATCH',
    url: '/v1/admin/settings',
    payload: { reason: 'Essai du retrait à la demande', ...payload },
  });

/** Commande livrée puis confirmée par l'acheteur : l'argent est libéré au vendeur (45 000 F). */
async function completedSale(): Promise<void> {
  const orderId = await buyAndDeliver(env, m);
  await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${orderId}/confirm-receipt` });
}

const payable = () => balance(env, `liability:seller_payable:${m.seller.sellerId}`);

async function withdraw(amount: number) {
  const asked = await call(env, m.seller, {
    method: 'POST',
    url: '/v1/seller/withdrawals',
    payload: { amount },
  });
  if (asked.status !== 202) return { asked, confirmed: null };
  const code = env.notifier.lastTo(m.seller.phone, 'withdrawal_code')!.variables.code!;
  const confirmed = await call(env, m.seller, {
    method: 'POST',
    url: '/v1/seller/withdrawals/confirm',
    payload: { challengeId: asked.body.challengeId, code },
  });
  return { asked, confirmed };
}

describe('Retrait à la demande (docs/ux/03 §4.3)', () => {
  it('par défaut, le reversement reste automatique et le retrait est refusé', async () => {
    await completedSale();
    expect((await env.pool.query('SELECT kind FROM payouts')).rows).toEqual([
      { kind: 'automatic' },
    ]);
    const res = await call(env, m.seller, {
      method: 'POST',
      url: '/v1/seller/withdrawals',
      payload: { amount: 5_000 },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('withdrawals_disabled');
    const money = await call(env, m.seller, { method: 'GET', url: '/v1/seller/balance' });
    expect(money.body.payoutMode).toBe('automatic');
  });

  it('à la demande : l’argent attend, le vendeur retire avec un code SMS', async () => {
    await settings({ payoutMode: 'on_demand' });
    await completedSale();
    expect((await env.pool.query('SELECT 1 FROM payouts')).rowCount).toBe(0);
    expect(await sweepSellerBalances(env.ctx)).toBe(0);
    expect(await payable()).toBe(45_000);

    const view = await call(env, m.seller, { method: 'GET', url: '/v1/seller/withdrawals' });
    expect(view.body).toMatchObject({
      mode: 'on_demand',
      withdrawable: 45_000,
      minimum: 1_000,
      reviewAbove: 100_000,
    });

    const tooMuch = await call(env, m.seller, {
      method: 'POST',
      url: '/v1/seller/withdrawals',
      payload: { amount: 50_000 },
    });
    expect(tooMuch.body.error.code).toBe('amount_unavailable');

    const asked = await call(env, m.seller, {
      method: 'POST',
      url: '/v1/seller/withdrawals',
      payload: { amount: 30_000 },
    });
    expect(asked.status).toBe(202);
    const sms = env.notifier.lastTo(m.seller.phone, 'withdrawal_code')!;
    expect(sms.channel).toBe('sms');
    const wrong = await call(env, m.seller, {
      method: 'POST',
      url: '/v1/seller/withdrawals/confirm',
      payload: {
        challengeId: asked.body.challengeId,
        code: sms.variables.code === '000000' ? '111111' : '000000',
      },
    });
    expect(wrong.status).toBe(422);
    const ok = await call(env, m.seller, {
      method: 'POST',
      url: '/v1/seller/withdrawals/confirm',
      payload: { challengeId: asked.body.challengeId, code: sms.variables.code },
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ amount: 30_000, status: 'pending' });
    // Le code ne sert qu'une fois.
    const again = await call(env, m.seller, {
      method: 'POST',
      url: '/v1/seller/withdrawals/confirm',
      payload: { challengeId: asked.body.challengeId, code: sms.variables.code },
    });
    expect(again.status).toBe(422);

    expect(await payable()).toBe(15_000);
    await processPayouts(env.ctx);
    const { rows } = await env.pool.query('SELECT kind, status, amount FROM payouts');
    expect(rows).toEqual([{ kind: 'withdrawal', status: 'succeeded', amount: 30_000 }]);
    expect(await trialBalance(env)).toBe(0);
  });

  it('au-delà du seuil : contrôle d’un administrateur, refus = argent rendu', async () => {
    await settings({ payoutMode: 'on_demand', withdrawalReviewAmount: 10_000 });
    await completedSale();

    const first = await withdraw(20_000);
    expect(first.confirmed!.body).toMatchObject({ status: 'awaiting_review' });
    await processPayouts(env.ctx);
    expect((await env.pool.query('SELECT status FROM payouts')).rows[0].status).toBe(
      'awaiting_review',
    );
    expect(await payable()).toBe(25_000);

    const queue = await call(env, m.admin, { method: 'GET', url: '/v1/support/withdrawals' });
    expect(queue.body.items).toHaveLength(1);
    expect(queue.body.items[0]).toMatchObject({ amount: 20_000, shopName: expect.any(String) });

    const support = await login(env, '06 452 77 18', ['buyer', 'support']);
    const forbidden = await call(env, support, {
      method: 'POST',
      url: `/v1/support/withdrawals/${first.confirmed!.body.payoutId}/decision`,
      payload: { decision: 'approve', note: 'Le support essaie' },
    });
    expect(forbidden.status).toBe(403);

    const rejected = await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/withdrawals/${first.confirmed!.body.payoutId}/decision`,
      payload: { decision: 'reject', note: 'Nom du compte différent de la pièce' },
    });
    expect(rejected.body.status).toBe('failed');
    expect(await payable()).toBe(45_000);

    // Le temps d'attente entre deux codes passé, un nouveau retrait est validé et part.
    env.clock.advanceMinutes(2);
    const second = await withdraw(15_000);
    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/withdrawals/${second.confirmed!.body.payoutId}/decision`,
      payload: { decision: 'approve', note: 'Pièce et compte concordants' },
    });
    await processPayouts(env.ctx);
    const { rows } = await env.pool.query<{ status: string; amount: number }>(
      `SELECT status, amount FROM payouts ORDER BY created_at`,
    );
    expect(rows.map((r) => r.status)).toEqual(['failed', 'succeeded']);
    expect(await payable()).toBe(30_000);
    expect(await trialBalance(env)).toBe(0);
  });
});
