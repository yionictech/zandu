import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  approveAndNotify,
  balance,
  buyAndDeliver,
  call,
  createTestEnv,
  homeDelivery,
  idemKey,
  login,
  pay,
  setupMarketplace,
  sweep,
  trialBalance,
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

const loyalty = (s: Session) => call(env, s, { method: 'GET', url: '/v1/me/loyalty' });
const gift = (s: Session, points: number) =>
  env.pool.query(
    `INSERT INTO loyalty_entries (user_id, points, kind, created_at) VALUES ($1, $2, 'earned', now())`,
    [s.userId, points],
  );
const checkoutWith = (s: Session, usePoints?: number, quantity = 1) =>
  call(env, s, {
    method: 'POST',
    url: '/v1/checkouts',
    headers: { 'idempotency-key': idemKey() },
    payload: {
      items: [{ productId: m.productId, quantity }],
      delivery: homeDelivery,
      ...(usePoints ? { usePoints } : {}),
    },
  });

describe('Points fidélité', () => {
  it('1 point par 100 FCFA à la fin de la commande, visible avec l’historique', async () => {
    const before = await loyalty(m.buyer);
    expect(before.body).toMatchObject({ points: 0, referredBy: false });
    expect(before.body.referralCode).toMatch(/^[A-Z0-9]{6,12}$/);

    const orderId = await buyAndDeliver(env, m);
    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${orderId}/confirm-receipt` });
    await sweep(env);
    const { rows } = await env.pool.query<{ total: number }>(
      'SELECT total::int FROM orders WHERE id = $1',
      [orderId],
    );
    const after = await loyalty(m.buyer);
    expect(after.body.points).toBe(Math.floor(rows[0]!.total / 100));
    expect(after.body.history[0]).toMatchObject({ kind: 'earned' });
    // Rejouer la fin de commande ne crédite pas deux fois.
    expect(
      (await env.pool.query("SELECT 1 FROM loyalty_entries WHERE kind = 'earned'")).rowCount,
    ).toBe(1);
  });

  it('payer avec des points : Zandu paie la réduction, le vendeur reçoit tout', async () => {
    await gift(m.buyer, 30_000);
    expect((await checkoutWith(m.buyer, 300)).body.error.code).toBe('points_too_few');
    // Articles 50 000 : au plus 25 000 points.
    expect((await checkoutWith(m.buyer, 30_000)).body.error.code).toBe('points_too_many');
    const cap = await call(env, m.buyer, {
      method: 'GET',
      url: '/v1/me/loyalty/redeemable?itemsTotal=50000',
    });
    expect(cap.body).toMatchObject({ points: 30_000, max: 25_000 });

    const co = await checkoutWith(m.buyer, 2_000);
    expect(co.status).toBe(201);
    expect(co.body).toMatchObject({ pointsUsed: 2_000, amountToPay: co.body.grandTotal - 2_000 });
    expect((await loyalty(m.buyer)).body.points).toBe(28_000);
    const order = co.body.orders[0];
    expect(order.pointsUsed).toBe(2_000);

    const payment = await pay(env, m.buyer, co.body.id);
    expect(payment.body.amount).toBe(co.body.amountToPay);
    await approveAndNotify(env, payment.body.id);
    expect(await balance(env, 'expense:loyalty_rewards')).toBe(2_000);
    expect(await balance(env, 'liability:escrow')).toBe(order.total);

    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${order.id}/accept` });
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${order.id}/ready` });
    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/deliveries/${order.id}/assign`,
      payload: { riderId: m.rider.riderId },
    });
    const mission = await call(env, m.rider, {
      method: 'GET',
      url: `/v1/rider/deliveries/${order.id}`,
    });
    await call(env, m.seller, {
      method: 'POST',
      url: `/v1/seller/orders/${order.id}/rider-pickup`,
      payload: { code: mission.body.pickupCode },
    });
    await call(env, m.rider, { method: 'POST', url: `/v1/rider/deliveries/${order.id}/pickup` });
    const code = env.notifier.lastTo(m.buyer.phone, 'buyer_handover_code')?.variables.code;
    await sweep(env);
    const handover =
      code ?? env.notifier.lastTo(m.buyer.phone, 'buyer_handover_code')!.variables.code!;
    await call(env, m.rider, {
      method: 'POST',
      url: `/v1/rider/deliveries/${order.id}/handover`,
      payload: { code: handover },
    });
    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${order.id}/confirm-receipt` });
    await sweep(env);

    // Le vendeur touche les articles moins la commission, comme sans points (reversement auto).
    const net = await env.pool.query<{ amount: number; expected: number }>(
      `SELECT p.amount::int AS amount, (o.items_subtotal - o.commission_total)::int AS expected
       FROM payouts p JOIN orders o ON o.id = p.order_id WHERE p.order_id = $1`,
      [order.id],
    );
    expect(net.rows[0]!.amount).toBe(net.rows[0]!.expected);
    expect(await balance(env, 'liability:escrow')).toBe(0);
    // Points gagnés sur l'argent payé seulement.
    const history = (await loyalty(m.buyer)).body.history;
    expect(history[0]).toMatchObject({
      kind: 'earned',
      points: Math.floor((order.total - 2_000) / 100),
    });
    expect(await trialBalance(env)).toBe(0);
  });

  it('annulée après paiement : argent payé remboursé, points recrédités, charge annulée', async () => {
    await gift(m.buyer, 5_000);
    const co = await checkoutWith(m.buyer, 5_000);
    const payment = await pay(env, m.buyer, co.body.id);
    await approveAndNotify(env, payment.body.id);
    const orderId = co.body.orders[0].id;
    const cancelled = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/orders/${orderId}/cancel`,
    });
    expect(cancelled.body.status).toBe('cancelled');
    const { rows } = await env.pool.query<{ amount: number }>(
      'SELECT amount::int FROM refunds WHERE order_id = $1',
      [orderId],
    );
    expect(rows).toEqual([{ amount: co.body.amountToPay }]);
    expect((await loyalty(m.buyer)).body.points).toBe(5_000);
    expect(await balance(env, 'expense:loyalty_rewards')).toBe(0);
    expect(await balance(env, 'liability:escrow')).toBe(0);
    expect(await trialBalance(env)).toBe(0);
  });

  it('panier expiré sans paiement : les points reviennent', async () => {
    await gift(m.buyer, 1_000);
    await checkoutWith(m.buyer, 1_000);
    expect((await loyalty(m.buyer)).body.points).toBe(0);
    env.clock.advanceMinutes(120);
    await sweep(env);
    expect((await loyalty(m.buyer)).body.points).toBe(1_000);
  });
});

describe('Parrainage', () => {
  it('1 000 points au parrain et au filleul à la fin de sa première commande', async () => {
    const sponsor = await login(env, '05 777 77 77');
    const code = (await loyalty(sponsor)).body.referralCode;
    // Le filleul est l'acheteur du marché de test (pas encore de commande).
    expect(
      (
        await call(env, m.buyer, {
          method: 'POST',
          url: '/v1/me/referral',
          payload: { code: 'ZZZZZZ99' },
        })
      ).body.error.code,
    ).toBe('referral_unknown');
    const own = (await loyalty(m.buyer)).body.referralCode;
    expect(
      (await call(env, m.buyer, { method: 'POST', url: '/v1/me/referral', payload: { code: own } }))
        .body.error.code,
    ).toBe('referral_self');
    expect((await loyalty(m.buyer)).body.canEnterCode).toBe(true);
    const ok = await call(env, m.buyer, {
      method: 'POST',
      url: '/v1/me/referral',
      payload: { code: code.toLowerCase() },
    });
    expect(ok.body).toEqual({ referred: true });
    expect(
      (await call(env, m.buyer, { method: 'POST', url: '/v1/me/referral', payload: { code } })).body
        .error.code,
    ).toBe('already_referred');

    const orderId = await buyAndDeliver(env, m);
    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${orderId}/confirm-receipt` });
    await sweep(env);
    const s = (await loyalty(sponsor)).body;
    expect(s).toMatchObject({ points: 1_000, referralCount: 1 });
    const kinds = (await loyalty(m.buyer)).body.history.map((h: { kind: string }) => h.kind);
    expect(kinds).toContain('referral_bonus');

    // Une deuxième commande ne redonne pas le bonus.
    const second = await buyAndDeliver(env, m);
    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${second}/confirm-receipt` });
    await sweep(env);
    expect((await loyalty(sponsor)).body.points).toBe(1_000);
  });
});
