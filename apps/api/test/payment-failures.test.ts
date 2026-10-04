import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { expirePayments, pollPayments } from '../src/modules/payments/payments.service.js';
import { processPayouts } from '../src/modules/payouts/payouts.service.js';
import {
  approveAndNotify,
  balance,
  call,
  checkout,
  createTestEnv,
  handoverCodeFor,
  idemKey,
  orderStatus,
  pay,
  setupMarketplace,
  sweep,
  trialBalance,
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

const stockOf = async (productId: string) =>
  (await env.pool.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [productId]))
    .rows[0]!.stock;

/** Amène une commande payée jusqu'à « livrée » via l'API. */
async function deliver(orderId: string) {
  const code = await handoverCodeFor(env, m.buyer.phone);
  await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/accept` });
  await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/ready` });
  await call(env, m.admin, {
    method: 'POST',
    url: `/v1/support/deliveries/${orderId}/assign`,
    payload: { riderId: m.rider.riderId },
  });
  await call(env, m.rider, { method: 'POST', url: `/v1/rider/deliveries/${orderId}/pickup` });
  const res = await call(env, m.rider, {
    method: 'POST',
    url: `/v1/rider/deliveries/${orderId}/handover`,
    payload: { code },
  });
  expect(res.body.status).toBe('delivered');
}

describe('Cahier des charges §5 — cas d’erreur de paiement', () => {
  it('PIN non validé : commande annulée après 10 min et stock libéré', async () => {
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 2 }]);
    const payment = await pay(env, m.buyer, co.id);
    expect(payment.body.status).toBe('pending');
    expect(await stockOf(m.productId)).toBe(3);

    env.clock.advanceMinutes(9);
    await sweep(env);
    expect(await orderStatus(env, co.orders[0].id)).toBe('pending_payment');

    env.clock.advanceMinutes(1);
    await sweep(env);
    const after = await call(env, m.buyer, {
      method: 'GET',
      url: `/v1/payments/${payment.body.id}`,
    });
    expect(after.body).toMatchObject({ status: 'expired', failure: { code: 'expired' } });
    expect(await orderStatus(env, co.orders[0].id)).toBe('cancelled');
    expect(await stockOf(m.productId)).toBe(5);
    expect(await trialBalance(env)).toBe(0);
  });

  it('solde insuffisant : message clair, puis nouvel essai avec un autre opérateur', async () => {
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
    const first = await pay(env, m.buyer, co.id, 'mtn');
    await approveAndNotify(env, first.body.id, 'insufficient_funds');
    const failed = await call(env, m.buyer, {
      method: 'GET',
      url: `/v1/payments/${first.body.id}`,
    });
    expect(failed.body.status).toBe('failed');
    expect(failed.body.failure.message).toMatch(/Solde Mobile Money insuffisant/);
    expect(await orderStatus(env, co.orders[0].id)).toBe('pending_payment');

    const second = await pay(env, m.buyer, co.id, 'airtel', '05 444 44 44');
    expect(second.body).toMatchObject({
      status: 'pending',
      operator: 'airtel',
      msisdn: '+242054444444',
    });
    await approveAndNotify(env, second.body.id);
    expect(await orderStatus(env, co.orders[0].id)).toBe('paid');
  });

  it('numéro sans compte Mobile Money : refus immédiat', async () => {
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
    const res = await pay(env, m.buyer, co.id, 'mtn', '06 612 34 99');
    expect(res.body).toMatchObject({ status: 'failed', failure: { code: 'invalid_account' } });
  });

  it("webhook perdu : l'interrogation de l'agrégateur confirme le paiement", async () => {
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
    const payment = await pay(env, m.buyer, co.id);
    env.simulator.customerResponds(payment.body.id, 'approve'); // validé, mais aucun webhook n'arrive

    await pollPayments(env.ctx);
    expect(await orderStatus(env, co.orders[0].id)).toBe('pending_payment'); // pas encore l'heure

    env.clock.advanceMinutes(2);
    await pollPayments(env.ctx);
    expect(await orderStatus(env, co.orders[0].id)).toBe('paid');
    expect(await balance(env, 'liability:escrow')).toBe(51_500);
  });

  it("succès juste avant l'expiration : la dernière vérification évite d'annuler à tort", async () => {
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
    const payment = await pay(env, m.buyer, co.id);
    env.simulator.customerResponds(payment.body.id, 'approve');
    env.clock.advanceMinutes(10);
    await expirePayments(env.ctx);
    expect(await orderStatus(env, co.orders[0].id)).toBe('paid');
  });

  it('succès tardif après expiration : remboursement automatique, aucun franc perdu', async () => {
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
    const payment = await pay(env, m.buyer, co.id);
    env.clock.advanceMinutes(10);
    await sweep(env);
    expect(await orderStatus(env, co.orders[0].id)).toBe('cancelled');

    const late = await approveAndNotify(env, payment.body.id); // l'acheteur valide trop tard
    expect(late.body.outcome).toBe('processed');
    const view = await call(env, m.buyer, {
      method: 'GET',
      url: `/v1/payments/${payment.body.id}`,
    });
    expect(view.body).toMatchObject({ status: 'succeeded', lateSuccess: true });
    expect(await balance(env, 'liability:suspense')).toBe(0);
    expect(await balance(env, 'liability:refunds_in_transit')).toBe(51_500);

    await sweep(env); // remboursement envoyé par le worker
    expect(await balance(env, 'liability:refunds_in_transit')).toBe(0);
    expect(await balance(env, 'asset:provider_cash:simulator')).toBe(0);
    expect(env.notifier.lastTo(m.buyer.phone, 'buyer_late_payment')).toBeDefined();
    expect(env.notifier.lastTo('+242060000001', 'support_alert')).toBeDefined();
    expect(await trialBalance(env)).toBe(0);
  });

  it("double appel avec la même clé d'idempotence : un seul débit", async () => {
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
    const key = idemKey();
    const request = {
      method: 'POST' as const,
      url: `/v1/checkouts/${co.id}/payments`,
      headers: { 'idempotency-key': key },
      payload: { operator: 'mtn', phone: '05 555 55 55' },
    };
    const [a, b] = await Promise.all([call(env, m.buyer, request), call(env, m.buyer, request)]);
    expect(a.body.id).toBe(b.body.id);
    const count = await env.pool.query(
      'SELECT count(*)::int AS n FROM payments WHERE checkout_id = $1',
      [co.id],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it('refuse une seconde demande pendant qu’une première attend le PIN', async () => {
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
    await pay(env, m.buyer, co.id);
    const second = await pay(env, m.buyer, co.id, 'airtel', '05 444 44 44');
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('payment_in_progress');
  });

  it('rejette un webhook à la signature invalide ou trop ancien', async () => {
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
    const payment = await pay(env, m.buyer, co.id);
    const event = env.simulator.customerResponds(payment.body.id, 'approve');
    const forged = env.simulator.signWebhook(event, env.clock.now());
    const tampered = forged.body.replace('"succeeded"', '"succeeded" ');
    const bad = await call(env, null, {
      method: 'POST',
      url: '/v1/webhooks/payments/simulator',
      headers: forged.headers,
      payload: tampered,
    });
    expect(bad.status).toBe(401);

    const stale = env.simulator.signWebhook(
      event,
      new Date(env.clock.now().getTime() - 10 * 60_000),
    );
    const old = await call(env, null, {
      method: 'POST',
      url: '/v1/webhooks/payments/simulator',
      headers: stale.headers,
      payload: stale.body,
    });
    expect(old.status).toBe(401);
    expect(await orderStatus(env, co.orders[0].id)).toBe('pending_payment');
  });

  it('échec du reversement : nouvelles tentatives, puis solde rendu au vendeur et alerte support', async () => {
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
    const payment = await pay(env, m.buyer, co.id);
    await approveAndNotify(env, payment.body.id);
    await deliver(co.orders[0].id);
    env.simulator.failNextPayouts = 3;
    await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/orders/${co.orders[0].id}/confirm-receipt`,
    });

    await processPayouts(env.ctx); // tentative 1
    env.clock.advanceMinutes(5);
    await processPayouts(env.ctx); // tentative 2
    env.clock.advanceMinutes(30);
    await processPayouts(env.ctx); // tentative 3 -> échec définitif

    const payout = await env.pool.query('SELECT status, attempts FROM payouts');
    expect(payout.rows[0]).toMatchObject({ status: 'failed', attempts: 3 });
    expect(await balance(env, `liability:seller_payable:${m.seller.sellerId}`)).toBe(45_000);
    expect(await balance(env, 'liability:payouts_in_transit')).toBe(0);
    await sweep(env);
    expect(env.notifier.lastTo('+242060000001', 'support_alert')!.variables.message).toMatch(
      /Reversement .* échec définitif/,
    );
    expect(await trialBalance(env)).toBe(0);
  });

  it('reversement confirmé de façon asynchrone par webhook', async () => {
    env.simulator.asyncDisbursements = true;
    try {
      const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
      const payment = await pay(env, m.buyer, co.id);
      await approveAndNotify(env, payment.body.id);
      await deliver(co.orders[0].id);
      await call(env, m.buyer, {
        method: 'POST',
        url: `/v1/orders/${co.orders[0].id}/confirm-receipt`,
      });
      await processPayouts(env.ctx);
      const { rows } = await env.pool.query<{ id: string; status: string }>(
        'SELECT id, status FROM payouts',
      );
      expect(rows[0]!.status).toBe('processing');

      const signed = env.simulator.signWebhook(env.simulator.settle(rows[0]!.id), env.clock.now());
      await call(env, null, {
        method: 'POST',
        url: '/v1/webhooks/payments/simulator',
        headers: signed.headers,
        payload: signed.body,
      });
      expect((await env.pool.query('SELECT status FROM payouts')).rows[0].status).toBe('succeeded');
      expect(await balance(env, 'liability:payouts_in_transit')).toBe(0);
    } finally {
      env.simulator.asyncDisbursements = false;
    }
  });

  it("arrêt brutal du worker pendant un reversement : vérification d'abord, jamais de double paiement", async () => {
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
    const payment = await pay(env, m.buyer, co.id);
    await approveAndNotify(env, payment.body.id);
    await deliver(co.orders[0].id);
    await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/orders/${co.orders[0].id}/confirm-receipt`,
    });
    const { rows } = await env.pool.query<{ id: string; amount: number; msisdn: string }>(
      'SELECT id, amount, msisdn FROM payouts',
    );
    const payout = rows[0]!;

    // Le worker a envoyé l'ordre à l'agrégateur puis s'est arrêté avant d'enregistrer la réponse.
    await env.simulator.initiatePayout({
      reference: payout.id,
      amount: payout.amount,
      currency: 'XAF',
      msisdn: payout.msisdn,
      operator: 'mtn',
      description: 'x',
    });
    await env.pool.query(
      `UPDATE payouts SET status = 'processing', attempts = 1, next_attempt_at = $2 WHERE id = $1`,
      [payout.id, env.clock.now()],
    );
    const sendSpy = env.simulator.initiatePayout.bind(env.simulator);
    let resent = 0;
    env.simulator.initiatePayout = async (request) => {
      resent++;
      return sendSpy(request);
    };
    try {
      await processPayouts(env.ctx);
    } finally {
      env.simulator.initiatePayout = sendSpy;
    }
    expect(resent).toBe(0); // constaté par consultation, pas renvoyé
    expect((await env.pool.query('SELECT status FROM payouts')).rows[0].status).toBe('succeeded');
    expect(await balance(env, 'liability:payouts_in_transit')).toBe(0);
    expect(await trialBalance(env)).toBe(0);
  });

  it('vendeur silencieux 24 h : commande annulée et acheteur remboursé', async () => {
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
    const payment = await pay(env, m.buyer, co.id);
    await approveAndNotify(env, payment.body.id);
    env.clock.advanceHours(24);
    await sweep(env);
    expect(await orderStatus(env, co.orders[0].id)).toBe('cancelled');
    expect(await stockOf(m.productId)).toBe(5);
    const refund = await env.pool.query('SELECT amount, status FROM refunds');
    expect(refund.rows[0]).toMatchObject({ amount: 51_500, status: 'succeeded' });
    expect(await balance(env, 'liability:escrow')).toBe(0);
    expect(await trialBalance(env)).toBe(0);
  });
});
