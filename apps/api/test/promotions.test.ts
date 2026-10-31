import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  approveAndNotify,
  balance,
  call,
  confirmPickupCode,
  createTestEnv,
  handoverCodeFor,
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

const createCoupon = (payload: object) =>
  call(env, m.seller, { method: 'POST', url: '/v1/seller/coupons', payload });
const checkoutWith = (buyer: Session, couponCode?: string) =>
  call(env, buyer, {
    method: 'POST',
    url: '/v1/checkouts',
    headers: { 'idempotency-key': idemKey() },
    payload: {
      items: [{ productId: m.productId, quantity: 2 }],
      delivery: homeDelivery,
      couponCode,
    },
  });

describe('Codes promo de boutique', () => {
  it('−10 % payés par le vendeur : commande, commission et séquestre justes jusqu’au reversement', async () => {
    expect((await createCoupon({ code: 'grace10', percent: 10 })).status).toBe(201);
    expect((await createCoupon({ code: 'GRACE10', percent: 20 })).status).toBe(409);

    const preview = await call(env, m.buyer, { method: 'GET', url: '/v1/coupons/grace10' });
    expect(preview.body).toMatchObject({ code: 'GRACE10', percent: 10, minSubtotal: 0 });

    const co = await checkoutWith(m.buyer, 'grace10');
    expect(co.status).toBe(201);
    const order = co.body.orders[0];
    // 2 × 50 000 = 100 000, −10 % = 90 000 d'articles ; la livraison n'est pas remisée.
    expect(order).toMatchObject({
      itemsSubtotal: 90_000,
      discountTotal: 10_000,
      couponCode: 'GRACE10',
    });
    expect(order.items[0]).toMatchObject({ unitPrice: 50_000, quantity: 2, lineTotal: 90_000 });
    expect(order.total).toBe(90_000 + order.deliveryFee);

    // Un deuxième achat avec le même code : refusé pour cet acheteur.
    expect((await checkoutWith(m.buyer, 'GRACE10')).body.error.code).toBe('coupon_already_used');

    const payment = await pay(env, m.buyer, co.body.id);
    expect(payment.body.amount).toBe(order.total);
    await approveAndNotify(env, payment.body.id);
    const code = await handoverCodeFor(env, m.buyer.phone);
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${order.id}/accept` });
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${order.id}/ready` });
    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/deliveries/${order.id}/assign`,
      payload: { riderId: m.rider.riderId },
    });
    await confirmPickupCode(env, m.rider, m.seller, order.id);
    await call(env, m.rider, { method: 'POST', url: `/v1/rider/deliveries/${order.id}/pickup` });
    await call(env, m.rider, {
      method: 'POST',
      url: `/v1/rider/deliveries/${order.id}/handover`,
      payload: { code },
    });
    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${order.id}/confirm-receipt` });
    await sweep(env);

    const commission = await balance(env, 'revenue:commission');
    expect(commission).toBeGreaterThan(0);
    expect(await balance(env, 'liability:escrow')).toBe(0);
    const coupons = await call(env, m.seller, { method: 'GET', url: '/v1/seller/coupons' });
    expect(coupons.body.items[0]).toMatchObject({
      code: 'GRACE10',
      uses: 1,
      discountGiven: 10_000,
    });
    expect(await trialBalance(env)).toBe(0);
  });

  it('minimum d’achat, code épuisé, code désactivé, autre boutique', async () => {
    await createCoupon({ code: 'GROS', percent: 15, minSubtotal: 200_000 });
    expect((await checkoutWith(m.buyer, 'GROS')).body.error.code).toBe('coupon_min_subtotal');

    const unique = await createCoupon({ code: 'UNSEUL', percent: 5, maxUses: 1 });
    expect((await checkoutWith(m.buyer, 'UNSEUL')).status).toBe(201);
    const other = await login(env, '05 777 77 77');
    expect((await checkoutWith(other, 'UNSEUL')).body.error.code).toBe('coupon_exhausted');

    await call(env, m.seller, {
      method: 'POST',
      url: `/v1/seller/coupons/${unique.body.id}/disable`,
    });
    expect((await checkoutWith(other, 'UNSEUL')).body.error.code).toBe('coupon_invalid');
    expect((await checkoutWith(other, 'INCONNU')).body.error.code).toBe('coupon_invalid');
  });
});

describe('Prix barré', () => {
  it('promotion de 20 %, rétablie à la fin ; arrêt manuel', async () => {
    const endsAt = new Date(env.clock.now().getTime() + 2 * 3600_000).toISOString();
    const sale = await call(env, m.seller, {
      method: 'POST',
      url: `/v1/seller/products/${m.productId}/sale`,
      payload: { percent: 20, endsAt },
    });
    expect(sale.body).toEqual({ price: 40_000, compareAtPrice: 50_000, saleEndsAt: endsAt });
    const shown = await call(env, null, { method: 'GET', url: `/v1/products/${m.productId}` });
    expect(shown.body).toMatchObject({ price: 40_000, compareAtPrice: 50_000 });

    // Nouvelle remise : calculée sur l'ancien prix, pas sur le prix soldé.
    const again = await call(env, m.seller, {
      method: 'POST',
      url: `/v1/seller/products/${m.productId}/sale`,
      payload: { percent: 10 },
    });
    expect(again.body).toMatchObject({ price: 45_000, compareAtPrice: 50_000 });
    await call(env, m.seller, {
      method: 'POST',
      url: `/v1/seller/products/${m.productId}/sale`,
      payload: { percent: 30, endsAt },
    });
    env.clock.advanceHours(3);
    await sweep(env);
    const after = await call(env, null, { method: 'GET', url: `/v1/products/${m.productId}` });
    expect(after.body).toMatchObject({ price: 50_000, compareAtPrice: null });

    await call(env, m.seller, {
      method: 'POST',
      url: `/v1/seller/products/${m.productId}/sale`,
      payload: { percent: 10 },
    });
    expect(
      (
        await call(env, m.seller, {
          method: 'DELETE',
          url: `/v1/seller/products/${m.productId}/sale`,
        })
      ).status,
    ).toBe(204);
    expect(
      (await call(env, null, { method: 'GET', url: `/v1/products/${m.productId}` })).body.price,
    ).toBe(50_000);
  });
});
