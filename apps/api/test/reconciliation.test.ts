import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { reconcileDay } from '../src/modules/reconciliation/reconciliation.service.js';
import {
  approveAndNotify,
  balance,
  buyAndDeliver,
  call,
  checkout,
  createTestEnv,
  login,
  pay,
  setupMarketplace,
  sweep,
  trialBalance,
  type Marketplace,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
let m: Marketplace;

const D = '2026-10-05';
const NEXT = '2026-10-06';
const CASH = 'asset:provider_cash:simulator';
const SUPPORT_PHONE = '+242060000001';
/** Heure de Pointe-Noire (UTC+1). */
const at = (date: string, time: string) => new Date(`${date}T${time}:00+01:00`);
const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  env.clock.set(at(D, '09:00'));
  env.simulator.feeBps = { collection: 0, payout: 0, refund: 0 };
  m = await setupMarketplace(env);
});

async function buyAndPay(): Promise<{ orderId: string; paymentId: string }> {
  const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
  const payment = await pay(env, m.buyer, co.id);
  await approveAndNotify(env, payment.body.id);
  return { orderId: co.orders[0].id, paymentId: payment.body.id };
}

/** Vente menée à son terme : paiement, livraison, confirmation, reversement au vendeur. */
async function completeSale(): Promise<string> {
  const orderId = await buyAndDeliver(env, m);
  await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${orderId}/confirm-receipt` });
  await sweep(env);
  const { rows } = await env.pool.query<{ id: string }>(
    'SELECT id FROM payouts WHERE order_id = $1',
    [orderId],
  );
  return rows[0]!.id;
}

/** Contrôle de nuit : 2 h 30 le lendemain, le worker passe. */
async function night(date: string) {
  env.clock.set(at(nextDay(date), '02:30'));
  m.admin = await login(env, '06 999 99 99', ['buyer', 'admin']); // session du personnel : 12 h
  await sweep(env);
}

const listRuns = () => call(env, m.admin, { method: 'GET', url: '/v1/admin/reconciliation/runs' });
async function runOf(date: string) {
  const run = (await listRuns()).body.items.find((r: { date: string }) => r.date === date);
  if (!run) return undefined;
  return (
    await call(env, m.admin, { method: 'GET', url: `/v1/admin/reconciliation/runs/${run.id}` })
  ).body;
}
const reconcile = (date: string, session = m.admin) =>
  call(env, session, { method: 'POST', url: '/v1/admin/reconciliation/runs', payload: { date } });
const resolve = (id: string, payload: Record<string, unknown>) =>
  call(env, m.admin, {
    method: 'POST',
    url: `/v1/admin/reconciliation/discrepancies/${id}/resolve`,
    payload,
  });
const supportAlerts = (pattern: RegExp) =>
  env.notifier.sent.filter(
    (msg) => msg.recipient === SUPPORT_PHONE && pattern.test(msg.variables.message ?? ''),
  );

describe('Rapprochement quotidien', () => {
  it('journée sans écart : paiements, reversement et remboursement retrouvés au relevé', async () => {
    await completeSale();
    const { orderId } = await buyAndPay();
    await call(env, m.buyer, { method: 'POST', url: `/v1/orders/${orderId}/cancel` });
    await sweep(env); // remboursement envoyé

    env.clock.set(at(NEXT, '01:00'));
    m.admin = await login(env, '06 999 99 99', ['buyer', 'admin']);
    await sweep(env);
    expect(await runOf(D)).toBeUndefined(); // pas avant 2 h

    await night(D);
    const { run, discrepancies } = await runOf(D);
    expect(run).toMatchObject({ status: 'balanced', attempts: 1 });
    expect(run.coveredUntil).toBe(at(NEXT, '00:00').toISOString());
    expect(run.summary).toMatchObject({
      statement: {
        lines: 4,
        collections: { count: 2, amount: 103_000 },
        payouts: { count: 1, amount: 45_000 },
        refunds: { count: 1, amount: 51_500 },
        fees: 0,
      },
      matched: 4,
      inTransit: { count: 0, amount: 0 },
      balance: { provider: 6_500, ledger: 6_500, unexplained: 0 },
      discrepancies: { found: 0, open: 0, new: 0 },
    });
    expect(discrepancies).toEqual([]);

    await sweep(env); // déjà fait : rien de plus
    expect((await runOf(D)).run.attempts).toBe(1);

    // Worker arrêté trois jours : les journées manquées sont rattrapées, une par passage.
    env.clock.set(at('2026-10-09', '03:00'));
    m.admin = await login(env, '06 999 99 99', ['buyer', 'admin']);
    for (let i = 0; i < 4; i++) await sweep(env);
    const list = (await listRuns()).body;
    expect(list.items.map((r: { date: string }) => r.date)).toEqual([
      '2026-10-08',
      '2026-10-07',
      '2026-10-06',
      D,
    ]);
    expect(list.streak).toBe(4);
    expect(list.open).toEqual({ count: 0, amount: 0 });
  });

  it("frais connus par le seul relevé : comptabilisés à la date de l'opération, une fois", async () => {
    env.simulator.feeBps = { collection: 150, payout: 100, refund: 0 };
    await completeSale();
    await night(D);
    const { run } = await runOf(D);
    // 1,5 % de 51 500 (773) sur la collecte, 1 % de 45 000 (450) sur le reversement.
    expect(run.summary).toMatchObject({
      feesBooked: { count: 2, amount: 1_223 },
      balance: { provider: 5_277, ledger: 5_277, unexplained: 0 },
    });
    expect(run.status).toBe('balanced');
    expect(await balance(env, 'expense:payment_fees')).toBe(1_223);

    const again = await reconcile(D);
    expect(again.body).toMatchObject({ status: 'balanced', attempts: 2 });
    expect(again.body.summary.feesBooked).toEqual({ count: 0, amount: 0 });
    expect(await balance(env, 'expense:payment_fees')).toBe(1_223);
    // Les frais tombent dans le rapport du jour de l'opération.
    const report = await call(env, m.admin, {
      method: 'GET',
      url: `/v1/admin/reports/activity?from=${D}&to=${D}`,
    });
    expect(report.body.revenue.paymentFees).toBe(1_223);
  });

  it("mouvement inconnu de Zandu : écart, alerte, puis régularisation par l'administrateur", async () => {
    await buyAndPay();
    await env.simulator.addAccountMovement({
      amount: -2_500,
      description: 'Frais de tenue de compte',
    });
    await night(D);

    const { run, discrepancies } = await runOf(D);
    expect(run.status).toBe('discrepancies');
    expect(run.summary.balance).toMatchObject({
      provider: 49_000,
      ledger: 51_500,
      notInLedger: -2_500,
      unexplained: 0,
    });
    expect(discrepancies).toHaveLength(1);
    const [gap] = discrepancies;
    expect(gap).toMatchObject({
      kind: 'missing_internal',
      operationKind: 'other',
      providerAmount: -2_500,
      internalAmount: 0,
      difference: -2_500,
      resolution: null,
    });
    expect(gap.message).toContain('Frais de tenue de compte');
    expect(
      supportAlerts(/Rapprochement simulator du 5 octobre 2026 : 1 écart à examiner/),
    ).toHaveLength(1);

    const funding = await resolve(gap.id, { note: 'Apport ?', adjustment: 'platform_funding' });
    expect(funding.status).toBe(422);
    expect(funding.body.error.code).toBe('invalid_adjustment');

    const done = await resolve(gap.id, {
      note: "Frais de tenue de compte d'octobre, confirmés par l'agrégateur",
      adjustment: 'payment_fees',
    });
    expect(done.status).toBe(200);
    expect(done.body.resolution).toMatchObject({
      by: '+242069999999',
      automatic: false,
      adjustment: { counterpart: 'payment_fees', amount: -2_500 },
    });
    expect((await runOf(D)).run.status).toBe('balanced');
    expect(await balance(env, 'expense:payment_fees')).toBe(2_500);
    expect(await balance(env, CASH)).toBe(49_000);
    expect(await trialBalance(env)).toBe(0);
    const audited = await env.pool.query(
      `SELECT metadata FROM audit_logs WHERE action = 'reconciliation.discrepancy_resolved'`,
    );
    expect(audited.rows[0].metadata).toMatchObject({
      kind: 'missing_internal',
      adjustment: { amount: -2_500 },
    });

    const rerun = await reconcile(D);
    expect(rerun.body).toMatchObject({
      status: 'balanced',
      summary: { discrepancies: { found: 1, open: 0, new: 0 }, balance: { unexplained: 0 } },
    });
    expect((await resolve(gap.id, { note: 'encore' })).body.error.code).toBe('already_resolved');
  });

  it('absent du relevé : signalé ; à cheval sur minuit : attendu au relevé suivant', async () => {
    const payoutId = await completeSale();
    // L'agrégateur n'a jamais exécuté ce reversement, que nous croyons réussi.
    await env.pool.query(
      `UPDATE simulator.operations SET status = 'failed', settled_at = NULL WHERE reference = $1`,
      [payoutId],
    );
    // Paiement validé à 23 h 50 ; l'agrégateur l'inscrit à 0 h 05 le lendemain.
    env.clock.set(at(D, '23:50'));
    const { paymentId } = await buyAndPay();
    await env.pool.query('UPDATE simulator.operations SET settled_at = $2 WHERE reference = $1', [
      paymentId,
      at(NEXT, '00:05'),
    ]);

    await night(D);
    const { run, discrepancies } = await runOf(D);
    expect(discrepancies).toEqual([
      expect.objectContaining({
        kind: 'missing_provider',
        operationKind: 'payout',
        reference: payoutId,
        internalAmount: -45_000,
        providerAmount: 0,
        difference: 45_000,
      }),
    ]);
    expect(discrepancies[0].publicRef).toMatch(/^ZD-/);
    expect(run.summary.inTransit).toEqual({ count: 1, amount: 51_500 });
    expect(run.summary.balance).toMatchObject({
      provider: 51_500,
      ledger: 58_000,
      notOnStatement: 6_500,
      unexplained: 0,
    });

    await night(NEXT);
    const second = await runOf(NEXT);
    expect(second.run.status).toBe('balanced');
    expect(second.run.summary.matched).toBeGreaterThanOrEqual(1); // le paiement de 23 h 50
    const open = await call(env, m.admin, {
      method: 'GET',
      url: '/v1/admin/reconciliation/discrepancies',
    });
    expect(open.body.items.map((d: { kind: string }) => d.kind)).toEqual(['missing_provider']);
  });

  it('webhook perdu après les 30 min d’interrogation : le relevé conclut, l’acheteur est remboursé', async () => {
    const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
    const payment = await pay(env, m.buyer, co.id);
    env.clock.advanceMinutes(10);
    await sweep(env); // délai écoulé : paiement expiré, commande annulée
    env.clock.advanceMinutes(15);
    await env.simulator.customerResponds(payment.body.id, 'approve'); // validé trop tard, aucun webhook

    env.clock.set(at(NEXT, '02:30'));
    const run = await reconcileDay(env.ctx, 'simulator', D);
    expect(run.status).toBe('balanced');
    expect(run.summary.statusesApplied).toEqual({ count: 1, amount: 51_500 });
    const { rows } = await env.pool.query(
      `SELECT p.status, p.late_success, r.reason FROM payments p JOIN refunds r ON r.payment_id = p.id`,
    );
    expect(rows[0]).toMatchObject({
      status: 'succeeded',
      late_success: true,
      reason: 'late_payment',
    });

    await sweep(env); // remboursement envoyé
    expect(await balance(env, CASH)).toBe(0);
    expect(await balance(env, 'liability:suspense')).toBe(0);
    expect(await trialBalance(env)).toBe(0);
  });

  it("écart de solde : signalé une fois, résolu par une écriture d'attente", async () => {
    await buyAndPay();
    // Mouvement qui pèse sur le solde de l'agrégateur sans figurer à son relevé détaillé.
    await env.simulator.addAccountMovement({
      amount: -1_000,
      description: 'Ajustement opérateur',
      listed: false,
    });
    await night(D);
    const first = await runOf(D);
    expect(first.run.summary.balance).toMatchObject({ provider: 50_500, unexplained: -1_000 });
    expect(first.discrepancies).toEqual([
      expect.objectContaining({
        kind: 'balance_mismatch',
        operationKind: 'balance',
        reference: D,
        difference: -1_000,
      }),
    ]);

    await night(NEXT); // le même écart n'est pas resignalé le lendemain
    const second = await runOf(NEXT);
    expect(second.run).toMatchObject({
      status: 'balanced',
      summary: { balance: { unexplained: -1_000 } },
    });
    expect(second.discrepancies).toEqual([]);

    const gap = first.discrepancies[0];
    const noEntry = await resolve(gap.id, { note: 'Vu avec l’agrégateur' });
    expect(noEntry.body.error.code).toBe('adjustment_required');
    expect(
      (
        await resolve(gap.id, {
          note: 'En attente du détail de l’agrégateur',
          adjustment: 'suspense',
        })
      ).status,
    ).toBe(200);
    expect(await balance(env, 'liability:suspense')).toBe(-1_000); // somme à expliquer

    expect((await reconcile(D)).body.summary.balance).toMatchObject({
      laterAdjustments: -1_000,
      unexplained: 0,
    });
    expect((await reconcile(NEXT)).body).toMatchObject({
      status: 'balanced',
      summary: { balance: { unexplained: 0 } },
    });
  });

  it('relevé indisponible : erreur, une seule alerte, nouvelle demande toutes les 30 min', async () => {
    await buyAndPay();
    const original = env.simulator.fetchStatement.bind(env.simulator);
    env.simulator.fetchStatement = async () => {
      throw new Error('service de relevés indisponible');
    };
    try {
      await night(D);
      expect((await runOf(D)).run).toMatchObject({ status: 'error', attempts: 1 });
      expect((await runOf(D)).run.summary.error).toContain('indisponible');
      env.clock.advanceMinutes(10);
      await sweep(env);
      expect((await runOf(D)).run.attempts).toBe(1);
      env.clock.advanceMinutes(25);
      await sweep(env);
      expect((await runOf(D)).run.attempts).toBe(2);
      expect(supportAlerts(/impossible : relevé de l'agrégateur indisponible/)).toHaveLength(1);
    } finally {
      env.simulator.fetchStatement = original;
    }
    env.clock.advanceMinutes(31);
    await sweep(env);
    expect((await runOf(D)).run).toMatchObject({ status: 'balanced', attempts: 3 });
  });

  it('contrôle de la journée en cours, journées autorisées, réservé aux administrateurs', async () => {
    await buyAndPay();
    env.clock.set(at(D, '10:00'));
    const today = await reconcile(D);
    expect(today.status).toBe(200);
    expect(today.body).toMatchObject({
      status: 'balanced',
      coveredUntil: at(D, '10:00').toISOString(),
    });
    expect(today.body.summary).toMatchObject({ matched: 1, inTransit: { count: 0 } });

    expect((await reconcile(NEXT)).body.error.code).toBe('future_date');
    expect((await reconcile('2026-10-04')).body.error.code).toBe('before_first_control');
    const agent = await login(env, '06 777 77 77', ['buyer', 'support']);
    expect((await reconcile(D, agent)).status).toBe(403);
    expect(
      (await call(env, agent, { method: 'GET', url: '/v1/admin/reconciliation/runs' })).status,
    ).toBe(403);
    expect(
      (await call(env, m.seller, { method: 'GET', url: '/v1/admin/reconciliation/discrepancies' }))
        .status,
    ).toBe(403);

    await night(D); // la nuit reprend la journée entière
    expect((await runOf(D)).run).toMatchObject({
      attempts: 2,
      coveredUntil: at(NEXT, '00:00').toISOString(),
      summary: { inTransit: { count: 0 }, matched: 1 },
    });
  });
});
