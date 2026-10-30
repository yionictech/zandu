import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buyAndDeliver,
  call,
  createTestEnv,
  login,
  setupMarketplace,
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

const status = (s: Session) => call(env, s, { method: 'GET', url: '/v1/me/deletion' });
const askCode = (s: Session) => call(env, s, { method: 'POST', url: '/v1/me/deletion' });
const confirm = (s: Session, challengeId: string, code: string) =>
  call(env, s, { method: 'POST', url: '/v1/me/deletion/confirm', payload: { challengeId, code } });
const lastCode = (phone: string) =>
  env.notifier.lastTo(phone, 'account_deletion_code')!.variables.code!;

describe('Suppression de compte (Google Play, App Store)', () => {
  it('acheteur sans commande en cours : code SMS, compte fermé et anonymisé, numéro libéré', async () => {
    const orderId = await buyAndDeliver(env, m);
    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${orderId}/confirm-receipt` });
    expect((await status(m.buyer)).body).toEqual({ possible: true, blockers: [] });

    const asked = await askCode(m.buyer);
    expect(asked.status).toBe(202);
    expect((await confirm(m.buyer, asked.body.challengeId, '000000')).status).toBe(422);
    expect((await confirm(m.buyer, asked.body.challengeId, lastCode(m.buyer.phone))).status).toBe(
      204,
    );

    // Session fermée, données personnelles effacées, commande gardée (comptabilité) sans adresse.
    expect((await call(env, m.buyer, { method: 'GET', url: '/v1/me' })).status).toBe(401);
    const { rows } = await env.pool.query(
      'SELECT phone, full_name, status, deleted_at FROM users WHERE id = $1',
      [m.buyer.userId],
    );
    expect(rows[0]).toMatchObject({ full_name: null, status: 'closed' });
    expect(rows[0].phone).toMatch(/^\+999\d{11}$/);
    expect(rows[0].deleted_at).not.toBeNull();
    const order = await env.pool.query('SELECT total, shipping_address FROM orders WHERE id = $1', [
      orderId,
    ]);
    expect(order.rows[0].shipping_address).toEqual({
      recipientName: 'Compte supprimé',
      phone: '',
      landmark: '',
    });
    expect(order.rows[0].total).toBeGreaterThan(0);

    // Le même numéro peut ouvrir un nouveau compte, vierge.
    const again = await login(env, m.buyer.phone);
    expect(again.userId).not.toBe(m.buyer.userId);
    expect((await call(env, again, { method: 'GET', url: '/v1/orders' })).body.items).toEqual([]);
  });

  it('refusée tant qu’une commande est en cours, ou que le vendeur attend son argent', async () => {
    const orderId = await buyAndDeliver(env, m); // remise : délai de réclamation en cours
    const buyer = await status(m.buyer);
    expect(buyer.body.possible).toBe(false);
    expect(buyer.body.blockers.map((b: { code: string }) => b.code)).toEqual([
      'orders_in_progress',
    ]);
    const refused = await askCode(m.buyer);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('deletion_blocked');

    const seller = await status(m.seller);
    expect(seller.body.blockers.map((b: { code: string }) => b.code)).toEqual(
      expect.arrayContaining(['shop_orders_in_progress', 'seller_balance']),
    );
    void orderId;
  });

  it('livreur et personnel : passer par le support', async () => {
    expect((await status(m.rider)).body.blockers.map((b: { code: string }) => b.code)).toEqual([
      'rider_account',
    ]);
    expect((await status(m.admin)).body.blockers.map((b: { code: string }) => b.code)).toEqual([
      'staff_account',
    ]);
  });
});
