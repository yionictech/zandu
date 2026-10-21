import { allowedStatusTransitions } from '@zandu/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addProduct,
  approveAndNotify,
  balance,
  call,
  confirmPickupCode,
  checkout,
  createTestEnv,
  handoverCodeFor,
  login,
  openShop,
  orderStatus,
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

async function paidOrder(buyer: Session = m.buyer, productId = m.productId): Promise<string> {
  const co = await checkout(env, buyer, [{ productId, quantity: 1 }]);
  const payment = await pay(env, buyer, co.id);
  await approveAndNotify(env, payment.body.id);
  return co.orders[0].id;
}

async function shipAndDeliver(orderId: string, seller: Session = m.seller): Promise<void> {
  const code = await handoverCodeFor(env, m.buyer.phone);
  await call(env, seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/accept` });
  await call(env, seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/ready` });
  await call(env, m.admin, {
    method: 'POST',
    url: `/v1/support/deliveries/${orderId}/assign`,
    payload: { riderId: m.rider.riderId },
  });
  await confirmPickupCode(env, m.rider, seller, orderId);
  await call(env, m.rider, { method: 'POST', url: `/v1/rider/deliveries/${orderId}/pickup` });
  await call(env, m.rider, {
    method: 'POST',
    url: `/v1/rider/deliveries/${orderId}/handover`,
    payload: { code },
  });
}

describe('Litiges (F12) et remboursements (F9)', () => {
  it('sans litige, la commande se termine seule 48 h après la remise', async () => {
    const orderId = await paidOrder();
    await shipAndDeliver(orderId);
    env.clock.advanceHours(47);
    await sweep(env);
    expect(await orderStatus(env, orderId)).toBe('delivered');
    env.clock.advanceHours(1);
    await sweep(env);
    expect(await orderStatus(env, orderId)).toBe('completed');
    expect(await balance(env, 'liability:escrow')).toBe(0);
  });

  it('litige ouvert à temps : reversement gelé, puis remboursement partiel décidé par le support', async () => {
    const orderId = await paidOrder();
    await shipAndDeliver(orderId);
    const opened = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/orders/${orderId}/disputes`,
      payload: {
        reason: 'damaged',
        description: 'Le ventilateur est arrivé avec une pale cassée.',
      },
    });
    expect(opened.status).toBe(201);

    env.clock.advanceHours(72);
    await sweep(env);
    expect(await orderStatus(env, orderId)).toBe('disputed'); // le délai ne libère pas un litige
    expect(await balance(env, 'liability:escrow')).toBe(51_500);

    // Les sessions du support durent 12 h : l'agent se reconnecte pour trancher.
    const agent = await login(env, '06 999 99 99');
    const resolved = await call(env, agent, {
      method: 'POST',
      url: `/v1/support/disputes/${opened.body.id}/resolve`,
      payload: {
        resolution: 'refund_partial',
        refundAmount: 10_000,
        note: 'Pale cassée, geste de 10 000 accepté par le vendeur.',
      },
    });
    expect(resolved.body, JSON.stringify(resolved.body)).toMatchObject({
      orderStatus: 'completed',
    });
    await sweep(env);
    // 40 000 d'articles conservés, commission ramenée à 4 000 : vendeur crédité de 36 000.
    expect(await balance(env, 'revenue:commission')).toBe(4_000);
    const payout = await env.pool.query('SELECT amount, status FROM payouts');
    expect(payout.rows[0]).toMatchObject({ amount: 36_000, status: 'succeeded' });
    const refund = await env.pool.query('SELECT amount, status FROM refunds');
    expect(refund.rows[0]).toMatchObject({ amount: 10_000, status: 'succeeded' });
    expect(await balance(env, 'liability:escrow')).toBe(0);
    expect(await trialBalance(env)).toBe(0);
  });

  it('refuse un litige ouvert après 48 h', async () => {
    const orderId = await paidOrder();
    await shipAndDeliver(orderId);
    env.clock.advanceHours(49);
    const late = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/orders/${orderId}/disputes`,
      payload: { reason: 'other', description: 'Je me suis rendu compte trop tard.' },
    });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('dispute_window_closed');
  });

  it('colis non livré : litige automatique puis remboursement intégral', async () => {
    const orderId = await paidOrder();
    await handoverCodeFor(env, m.buyer.phone);
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/accept` });
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/ready` });
    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/deliveries/${orderId}/assign`,
      payload: { riderId: m.rider.riderId },
    });
    await confirmPickupCode(env, m.rider, m.seller, orderId);
    await call(env, m.rider, { method: 'POST', url: `/v1/rider/deliveries/${orderId}/pickup` });
    const failed = await call(env, m.rider, {
      method: 'POST',
      url: `/v1/rider/deliveries/${orderId}/failed`,
      payload: { reason: 'Destinataire injoignable 3 fois' },
    });
    expect(failed.body.status).toBe('disputed');

    const { rows } = await env.pool.query<{ id: string }>(
      'SELECT id FROM disputes WHERE order_id = $1',
      [orderId],
    );
    const resolved = await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/disputes/${rows[0]!.id}/resolve`,
      payload: { resolution: 'refund_full', note: 'Colis jamais remis, remboursement intégral.' },
    });
    expect(resolved.body.orderStatus).toBe('refunded');
    await sweep(env);
    expect(await balance(env, 'liability:escrow')).toBe(0);
    expect(await balance(env, 'asset:provider_cash:simulator')).toBe(0);
    expect(env.notifier.lastTo(m.buyer.phone, 'buyer_refunded')!.variables.amount).toMatch(
      /51.500/,
    );
  });
});

describe('Confiance vendeur : vendre avant vérification, encaisser après', () => {
  it('produits en modération, reversement bloqué jusqu’à la vérification KYC', async () => {
    const newcomer = await openShop(env, m.admin, '06 333 33 33', false);
    const productId = await addProduct(env, newcomer, {
      title: 'Sac en raphia artisanal',
      price: 20_000,
    });
    expect(
      (await env.pool.query('SELECT status FROM products WHERE id = $1', [productId])).rows[0]
        .status,
    ).toBe('pending_review');
    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/admin/products/${productId}/moderation`,
      payload: { decision: 'published' },
    });

    const orderId = await paidOrder(m.buyer, productId);
    await shipAndDeliver(orderId, newcomer);
    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${orderId}/confirm-receipt` });
    await sweep(env);
    expect((await env.pool.query('SELECT count(*)::int AS n FROM payouts')).rows[0].n).toBe(0);
    expect(await balance(env, `liability:seller_payable:${newcomer.sellerId}`)).toBe(18_000);

    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/admin/sellers/${newcomer.sellerId}/verification`,
      payload: { decision: 'verified' },
    });
    await sweep(env);
    const payout = await env.pool.query('SELECT amount, status FROM payouts');
    expect(payout.rows[0]).toMatchObject({ amount: 18_000, status: 'succeeded' });
  });
});

describe('Sécurité', () => {
  it("un acheteur ne voit ni ne modifie la commande d'un autre (IDOR)", async () => {
    const orderId = await paidOrder();
    const intruder = await login(env, '05 777 77 77');
    expect(
      (await call(env, intruder, { method: 'GET', url: `/v1/orders/${orderId}` })).status,
    ).toBe(404);
    expect(
      (await call(env, intruder, { method: 'POST', url: `/v1/orders/${orderId}/cancel` })).status,
    ).toBe(404);
  });

  it("un vendeur n'agit pas sur la commande d'un autre vendeur, un acheteur pas sur les routes vendeur", async () => {
    const orderId = await paidOrder();
    const rival = await openShop(env, m.admin, '06 444 44 44');
    expect(
      (await call(env, rival, { method: 'POST', url: `/v1/seller/orders/${orderId}/accept` }))
        .status,
    ).toBe(404);
    expect(
      (await call(env, m.buyer, { method: 'POST', url: `/v1/seller/orders/${orderId}/accept` }))
        .status,
    ).toBe(403);
    expect(
      (
        await call(env, m.buyer, {
          method: 'POST',
          url: `/v1/admin/sellers/${m.seller.sellerId}/verification`,
          payload: { decision: 'verified' },
        })
      ).status,
    ).toBe(403);
    expect((await call(env, null, { method: 'GET', url: '/v1/orders' })).status).toBe(401);
  });

  it('OTP : renvoi trop rapide refusé, code verrouillé après 5 erreurs', async () => {
    const first = await call(env, null, {
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: '06 123 45 67' },
    });
    expect(first.status).toBe(202);
    const again = await call(env, null, {
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: '06 123 45 67' },
    });
    expect(again.status).toBe(429);
    const real = env.notifier.lastTo('+242061234567', 'otp_code')!.variables.code!;
    const wrong = real === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await call(env, null, {
        method: 'POST',
        url: '/v1/auth/otp/verify',
        payload: { challengeId: first.body.challengeId, code: wrong },
      });
      expect(r.status).toBe(401);
    }
    const locked = await call(env, null, {
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { challengeId: first.body.challengeId, code: real },
    });
    expect(locked.status).toBe(429);
  });

  it('code de remise : verrouillé après 5 essais erronés', async () => {
    const orderId = await paidOrder();
    const code = await handoverCodeFor(env, m.buyer.phone);
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/accept` });
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/ready` });
    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/deliveries/${orderId}/assign`,
      payload: { riderId: m.rider.riderId },
    });
    await confirmPickupCode(env, m.rider, m.seller, orderId);
    await call(env, m.rider, { method: 'POST', url: `/v1/rider/deliveries/${orderId}/pickup` });
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await call(env, m.rider, {
        method: 'POST',
        url: `/v1/rider/deliveries/${orderId}/handover`,
        payload: { code: wrong },
      });
    }
    const locked = await call(env, m.rider, {
      method: 'POST',
      url: `/v1/rider/deliveries/${orderId}/handover`,
      payload: { code },
    });
    expect(locked.status).toBe(423);
  });
});

describe('Garde-fous en base de données', () => {
  it('la table des transitions SQL est le miroir exact de la machine à états du domaine', async () => {
    const { rows } = await env.pool.query<{ from_status: string; to_status: string }>(
      'SELECT from_status, to_status FROM order_status_transitions',
    );
    const db = rows.map((r) => `${r.from_status}>${r.to_status}`).sort();
    const domain = allowedStatusTransitions()
      .map(([a, b]) => `${a}>${b}`)
      .sort();
    expect(db).toEqual(domain);
  });

  it('refuse une transition interdite et toute modification du grand livre, même en SQL direct', async () => {
    const orderId = await paidOrder();
    await expect(
      env.pool.query(`UPDATE orders SET status = 'completed' WHERE id = $1`, [orderId]),
    ).rejects.toThrow(/interdite/);
    await expect(env.pool.query('UPDATE ledger_entries SET amount = amount + 1')).rejects.toThrow(
      /écriture seule/,
    );
    await expect(env.pool.query('DELETE FROM audit_logs')).rejects.toThrow(/écriture seule/);
  });

  it('la balance générale exposée au back-office vaut 0', async () => {
    await paidOrder();
    const res = await call(env, m.admin, { method: 'GET', url: '/v1/admin/ledger/balances' });
    expect(res.body.trialBalance).toBe(0);
    expect(res.body.accounts).toContainEqual({ code: 'liability:escrow', balance: 51_500 });
  });
});
