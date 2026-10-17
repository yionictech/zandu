import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addProduct,
  approveAndNotify,
  buyAndDeliver,
  call,
  CATEGORIES,
  checkout,
  createTestEnv,
  login,
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
afterAll(async () => env.close());
beforeEach(async () => {
  m = await setupMarketplace(env);
});

/** Jour (AAAA-MM-JJ) au Congo, comme le rapport. */
const congoDay = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Brazzaville' }).format(date);

async function buyAndPay(productId = m.productId): Promise<string> {
  const co = await checkout(env, m.buyer, [{ productId, quantity: 1 }]);
  const payment = await pay(env, m.buyer, co.id);
  await approveAndNotify(env, payment.body.id);
  return co.orders[0].id;
}

const report = (from: string, to: string, session = m.admin) =>
  call(env, session, { method: 'GET', url: `/v1/admin/reports/activity?from=${from}&to=${to}` });

describe("Rapport d'activité", () => {
  it('ventes par date de paiement, revenus du grand livre, catégories, boutiques, reversements', async () => {
    const day1 = congoDay(env.clock.now());
    // Jour 1 : une vente menée à son terme (commission acquise, vendeur payé).
    const completed = await buyAndDeliver(env, m);
    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${completed}/confirm-receipt` });
    await sweep(env);
    // Jour 2 : une commande payée puis annulée par l'acheteur (remboursée).
    env.clock.advanceHours(24);
    const cancelled = await buyAndPay();
    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${cancelled}/cancel` });
    await sweep(env);
    // Jour 3 : une commande payée, encore au séquestre.
    env.clock.advanceHours(24);
    await buyAndPay();
    const day3 = congoDay(env.clock.now());
    // Session du personnel : 12 h. L'administrateur se reconnecte après ces deux jours.
    m.admin = await login(env, '06 999 99 99', ['buyer', 'admin']);

    const res = await report(day1, day3);
    expect(res.status).toBe(200);
    const r = res.body;
    // 3 commandes de 50 000 + 1 500 de livraison ; commission prévue 10 % (Maison).
    expect(r.sales).toMatchObject({
      paidOrders: 3,
      gmv: 154_500,
      itemsSubtotal: 150_000,
      deliveryFees: 4_500,
      averageBasket: 51_500,
      expectedCommission: 15_000,
      cancelledOrRefundedOrders: 1,
      refunds: { count: 1, amount: 51_500 },
    });
    // Seule la commande terminée a rapporté : 5 000 de commission, 200 de marge livraison.
    expect(r.revenue).toMatchObject({
      commission: 5_000,
      deliveryMargin: 200,
      paymentFees: 0,
      net: 5_200,
      upcomingCommission: 5_000,
    });
    expect(r.daily.map((d: { orders: number }) => d.orders)).toEqual([1, 1, 1]);
    expect(r.daily[0]).toEqual({ date: day1, orders: 1, gmv: 51_500 });
    expect(r.categories).toEqual([
      {
        categoryId: CATEGORIES.maison,
        name: 'Maison et électroménager',
        orders: 3,
        sales: 150_000,
        commission: 15_000,
        averageRateBps: 1000,
      },
    ]);
    expect(r.topShops).toEqual([
      expect.objectContaining({ sellerId: m.seller.sellerId, orders: 3, sales: 150_000 }),
    ]);
    expect(r.payouts).toMatchObject({
      sent: { count: 1, amount: 45_000 },
      failed: { count: 0, amount: 0 },
      pending: { count: 0, amount: 0 },
      owedToSellers: 0,
      inEscrow: 51_500,
    });

    // Le premier jour seul : une commande, et la commission acquise ce jour-là.
    const first = (await report(day1, day1)).body;
    expect(first.sales.paidOrders).toBe(1);
    expect(first.revenue.commission).toBe(5_000);
  });

  it('les sous-catégories comptent dans leur catégorie racine', async () => {
    const phone = await addProduct(env, m.seller, {
      categoryId: CATEGORIES.telephones,
      title: 'Téléphone Tecno Spark',
      price: 60_000,
    });
    await buyAndPay(phone);
    const today = congoDay(env.clock.now());
    const { categories } = (await report(today, today)).body;
    // Électronique : 8 % (règle de la catégorie racine).
    expect(categories).toEqual([
      expect.objectContaining({ name: 'Électronique', sales: 60_000, averageRateBps: 800 }),
    ]);
  });

  it('réservé aux administrateurs ; période validée', async () => {
    const agent = await login(env, '06 777 77 77', ['buyer', 'support']);
    const today = congoDay(env.clock.now());
    expect((await report(today, today, agent)).status).toBe(403);
    expect((await report(today, today, m.seller)).status).toBe(403);
    expect((await report('2026-10-31', '2026-10-01')).body.error.code).toBe('invalid_period');
    expect((await report('2025-01-01', '2026-10-01')).body.error.code).toBe('invalid_period');
    // Sans période : le mois en cours.
    const current = await call(env, m.admin, { method: 'GET', url: '/v1/admin/reports/activity' });
    expect(current.body.period).toMatchObject({ from: `${today.slice(0, 8)}01`, to: today });
  });
});

describe('Export CSV pour le comptable', () => {
  it('une ligne par commande payée, format tableur français, formules neutralisées', async () => {
    // Nom de boutique piégé : un tableur ne doit jamais l'exécuter comme une formule.
    await env.pool.query('UPDATE seller_profiles SET shop_name = $1 WHERE id = $2', [
      '=HYPERLINK("http://piege.example","Cliquez")',
      m.seller.sellerId,
    ]);
    const orderId = await buyAndPay();
    const today = congoDay(env.clock.now());
    const res = await env.app.inject({
      method: 'GET',
      url: `/v1/admin/reports/orders.csv?from=${today}&to=${today}`,
      headers: m.admin.headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toContain(`zandu-commandes-${today}-${today}.csv`);
    expect(res.body.startsWith('﻿')).toBe(true);
    const lines = res.body.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      'Référence;Payée le;Boutique;Statut;Articles (FCFA);Livraison (FCFA);Total payé (FCFA);Commission (FCFA);Remboursé (FCFA);Versé au vendeur (FCFA)',
    );
    const { rows } = await env.pool.query<{ public_ref: string }>(
      'SELECT public_ref FROM orders WHERE id = $1',
      [orderId],
    );
    const cells = lines[1]!.split(';');
    expect(cells[0]).toBe(rows[0]!.public_ref);
    expect(cells[2]).toBe(`"'=HYPERLINK(""http://piege.example"",""Cliquez"")"`);
    expect(cells.slice(3)).toEqual(['payée', '50000', '1500', '51500', '5000', '0', '0']);
    // L'export est journalisé.
    const audit = await env.pool.query(
      `SELECT 1 FROM audit_logs WHERE action = 'report.orders_exported' AND actor_id = $1`,
      [m.admin.userId],
    );
    expect(audit.rowCount).toBe(1);
  });
});

describe('Règles de commission', () => {
  const rules = () => call(env, m.admin, { method: 'GET', url: '/v1/admin/commission-rules' });
  const create = (payload: Record<string, unknown>, session = m.admin) =>
    call(env, session, { method: 'POST', url: '/v1/admin/commission-rules', payload });
  const commissionOf = async (orderId: string) =>
    (
      await env.pool.query<{ commission_total: number }>(
        'SELECT commission_total FROM orders WHERE id = $1',
        [orderId],
      )
    ).rows[0]!.commission_total;

  it('changer le taux d’une catégorie : nouvelles commandes seulement, ancienne règle close, audit', async () => {
    const before = await buyAndPay();
    const changed = await create({
      scope: 'category',
      categoryId: CATEGORIES.maison,
      rateBps: 1500,
      note: 'Hausse décidée en comité (D8)',
    });
    expect(changed.status).toBe(201);
    const after = await buyAndPay();
    expect(await commissionOf(before)).toBe(5_000); // figée au moment de l'achat
    expect(await commissionOf(after)).toBe(7_500);

    const maison = (await rules()).body.items.filter(
      (r: { categoryId: string | null }) => r.categoryId === CATEGORIES.maison,
    );
    expect(maison).toEqual([
      expect.objectContaining({ rateBps: 1500, status: 'active', validTo: null }),
    ]);
    const { rows } = await env.pool.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_logs WHERE action = 'commission_rule.created'`,
    );
    // Maison n'avait pas de règle propre : elle suivait le taux par défaut.
    expect(rows[0]!.metadata).toMatchObject({ rateBps: 1500, previousRateBps: null });
  });

  it('offre de lancement : 0 % pour une boutique pendant 3 mois, puis retour au taux normal', async () => {
    const until = new Date(env.clock.now().getTime() + 90 * 86_400_000);
    expect(
      (
        await create({
          scope: 'seller',
          sellerId: m.seller.sellerId,
          rateBps: 0,
          validTo: until.toISOString(),
          note: 'Offre des 200 premiers vendeurs',
        })
      ).status,
    ).toBe(201);
    expect(await commissionOf(await buyAndPay())).toBe(0);
    env.clock.advanceHours(91 * 24);
    m.buyer = await login(env, '05 555 55 55'); // session de 30 jours expirée
    expect(await commissionOf(await buyAndPay())).toBe(5_000);
  });

  it('une offre temporaire sur une catégorie passe devant, puis le taux habituel reprend', async () => {
    await create({ scope: 'category', categoryId: CATEGORIES.maison, rateBps: 1500, note: 'Taux' });
    env.clock.advanceMinutes(1);
    const inAWeek = new Date(env.clock.now().getTime() + 7 * 86_400_000).toISOString();
    await create({
      scope: 'category',
      categoryId: CATEGORIES.maison,
      rateBps: 500,
      validTo: inAWeek,
      note: 'Semaine de la maison',
    });
    const statuses = (await rules()).body.items
      .filter((r: { categoryId: string | null }) => r.categoryId === CATEGORIES.maison)
      .map((r: { rateBps: number; status: string }) => [r.rateBps, r.status]);
    expect(statuses).toEqual([
      [500, 'active'],
      [1500, 'overridden'],
    ]);
    expect(await commissionOf(await buyAndPay())).toBe(2_500);
    env.clock.advanceHours(8 * 24);
    expect(await commissionOf(await buyAndPay())).toBe(7_500);
  });

  it('terminer une règle, annuler une règle programmée ; garde-fous', async () => {
    await create({
      scope: 'seller',
      sellerId: m.seller.sellerId,
      rateBps: 500,
      note: 'Partenaire',
    });
    const seller = (await rules()).body.items.find((r: { scope: string }) => r.scope === 'seller');
    const ended = await call(env, m.admin, {
      method: 'POST',
      url: `/v1/admin/commission-rules/${seller.id}/end`,
    });
    expect(ended.status).toBe(204);
    expect(await commissionOf(await buyAndPay())).toBe(5_000);

    const tomorrow = new Date(env.clock.now().getTime() + 86_400_000).toISOString();
    await create({ scope: 'default', rateBps: 1100, validFrom: tomorrow, note: 'Programmée' });
    expect(
      (await create({ scope: 'default', rateBps: 1200, note: 'Doublon' })).body.error.code,
    ).toBe('rule_already_scheduled');
    const scheduled = (await rules()).body.items.find(
      (r: { status: string }) => r.status === 'scheduled',
    );
    expect(
      (
        await call(env, m.admin, {
          method: 'POST',
          url: `/v1/admin/commission-rules/${scheduled.id}/end`,
        })
      ).status,
    ).toBe(204);
    expect((await rules()).body.items.some((r: { id: string }) => r.id === scheduled.id)).toBe(
      false,
    );
    // Le taux par défaut qu'elle devait remplacer reste en vigueur, sans date de fin.
    expect(
      (await rules()).body.items.filter(
        (r: { scope: string; validTo: string | null }) => r.scope === 'default' && !r.validTo,
      ),
    ).toHaveLength(1);

    const current = (await rules()).body.items.find(
      (r: { scope: string; status: string }) => r.scope === 'default' && r.status === 'active',
    );
    const endDefault = await call(env, m.admin, {
      method: 'POST',
      url: `/v1/admin/commission-rules/${current.id}/end`,
    });
    expect(endDefault.body.error.code).toBe('default_rule_required');
    const past = new Date(env.clock.now().getTime() - 86_400_000).toISOString();
    expect(
      (await create({ scope: 'default', rateBps: 900, validFrom: past, note: 'Rétroactif' })).body
        .error.code,
    ).toBe('rule_in_past');
    expect(
      (await create({ scope: 'default', rateBps: 900, validTo: tomorrow, note: 'Expirant' })).body
        .error.code,
    ).toBe('default_rule_required');
    expect((await create({ scope: 'category', rateBps: 900, note: 'Sans cible' })).status).toBe(
      400,
    );
    expect((await create({ scope: 'default', rateBps: 6000, note: 'Abusif' })).status).toBe(400);
    const agent = await login(env, '06 777 77 77', ['buyer', 'support']);
    expect((await create({ scope: 'default', rateBps: 900, note: 'Agent' }, agent)).status).toBe(
      403,
    );
  });
});
