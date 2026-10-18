import {
  DomainError,
  adjustProviderCash,
  formatXaf,
  providerCashAccount,
  recordProviderFee,
  type AdjustmentCounterpart,
} from '@zandu/domain';
import type { Actor, AppContext } from '../../context.js';
import { withTx, type Db, type Tx } from '../../db/pool.js';
import { addMinutes } from '../../lib/clock.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { audit } from '../admin/audit.js';
import { postJournal } from '../ledger/ledger.repository.js';
import { publish } from '../notifications/outbox.js';
import { applyCollectionSignal } from '../payments/payments.service.js';
import type { StatementLine } from '../payments/provider.js';
import { refundSpec } from '../payments/refunds.service.js';
import { applyDisbursementResult } from '../payouts/disbursements.js';
import { payoutSpec } from '../payouts/payouts.service.js';

/**
 * Rapprochement quotidien (ADR-0015) : le relevé de l'agrégateur est comparé, mouvement par
 * mouvement, au compte asset:provider_cash:<agrégateur> du grand livre. Chaque mouvement est
 * relié au relevé par une clé « type:référence » (collection:<paiement>, payout:<reversement>,
 * refund:<remboursement>, fee:<opération>, other:<réf. agrégateur>). Le contrôle n'écrit dans
 * le grand livre que les frais révélés par le relevé ; le reste est signalé, jamais corrigé seul.
 */

// ---------------------------------------------------------------------------------------------
// Journées comptables : heure du Congo (UTC+1 toute l'année, sans heure d'été).
// ---------------------------------------------------------------------------------------------
const CONGO_OFFSET_MS = 3_600_000;
export const congoDate = (at: Date): string =>
  new Date(at.getTime() + CONGO_OFFSET_MS).toISOString().slice(0, 10);
const congoHour = (at: Date): number => new Date(at.getTime() + CONGO_OFFSET_MS).getUTCHours();
export const dayStart = (date: string): Date => new Date(`${date}T00:00:00+01:00`);
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const dayLabel = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const formatDate = (date: string) => dayLabel.format(new Date(`${date}T00:00:00Z`));

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------
export type DiscrepancyKind =
  | 'missing_internal'
  | 'missing_provider'
  | 'amount_mismatch'
  | 'status_mismatch'
  | 'fee_mismatch'
  | 'balance_mismatch';
type TargetKind = 'collection' | 'payout' | 'refund' | 'other' | 'fee' | 'balance';

interface CountAmount {
  count: number;
  amount: number;
}

export interface RunSummary {
  period: { from: string; until: string };
  statement?: {
    lines: number;
    collections: CountAmount;
    payouts: CountAmount;
    refunds: CountAmount;
    other: CountAmount;
    fees: number;
  };
  /** Mouvements du relevé retrouvés à l'identique dans le grand livre. */
  matched?: number;
  /** Opérations restées en attente chez Zandu (webhook perdu) que le relevé a conclues. */
  statusesApplied?: CountAmount;
  /** Frais connus par le seul relevé, comptabilisés par le contrôle. */
  feesBooked?: CountAmount;
  /** Comptabilisés chez Zandu juste avant la fin de la période : attendus au relevé suivant. */
  inTransit?: CountAmount;
  /** État de rapprochement du solde ; null si l'agrégateur ne communique pas son solde. */
  balance?: {
    provider: number;
    ledger: number;
    /** Régularisations, passées depuis, des écarts de solde de cette journée ou d'avant. */
    laterAdjustments: number;
    notOnStatement: number;
    notInLedger: number;
    amountDifferences: number;
    unexplained: number;
  } | null;
  discrepancies?: { found: number; open: number; new: number };
  error?: string;
}

interface RunRow {
  id: string;
  provider: string;
  statement_date: string;
  status: 'running' | 'balanced' | 'discrepancies' | 'error';
  summary: RunSummary;
  covered_until: Date | null;
  attempts: number;
  started_at: Date;
  finished_at: Date | null;
}

const RUN_COLUMNS = `id, provider, statement_date::text AS statement_date, status, summary,
  covered_until, attempts, started_at, finished_at`;

export function runView(r: RunRow) {
  return {
    id: r.id,
    provider: r.provider,
    date: r.statement_date,
    status: r.status,
    coveredUntil: r.covered_until,
    attempts: r.attempts,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    summary: r.summary,
  };
}

interface Candidate {
  kind: DiscrepancyKind;
  operationKind: TargetKind;
  reference: string;
  providerRef: string | null;
  internalAmount: number;
  providerAmount: number;
  details: Record<string, unknown>;
}

interface KeyState {
  ledger: number;
  booked: number;
  adjusted: number;
  statement: number;
  listed: number;
}

interface InternalOp {
  kind: 'collection' | 'payout' | 'refund';
  id: string;
  status: string;
  order_id: string | null;
  public_ref: string | null;
}

// ---------------------------------------------------------------------------------------------
// Lecture des deux côtés, reliés par la même clé
// ---------------------------------------------------------------------------------------------

/** Mouvements du compte agrégateur au grand livre ($1 compte, $2 date limite), avec leur clé. */
const MOVES = `
  SELECT CASE
           WHEN t.kind IN ('payment_captured', 'late_payment_captured') THEN 'collection:' || t.payment_id
           WHEN t.kind = 'payout_settled' THEN 'payout:' || t.payout_id
           WHEN t.kind = 'refund_settled' THEN 'refund:' || t.refund_id
           WHEN t.kind = 'provider_fee' THEN 'fee:' || split_part(t.idempotency_key, ':', 3)
           WHEN d.operation_kind <> 'balance' THEN d.operation_kind || ':' || d.reference
         END AS key,
         t.kind = 'reconciliation_adjustment' AS adjustment,
         e.amount, e.created_at
  FROM ledger_entries e
  JOIN ledger_accounts a ON a.id = e.account_id AND a.code = $1
  JOIN ledger_transactions t ON t.id = e.transaction_id
  LEFT JOIN reconciliation_discrepancies d ON d.adjustment_transaction_id = t.id
  WHERE e.created_at < $2`;

/** Lignes des relevés reçus ($3 agrégateur), frais à part pour les opérations Zandu. */
const LINES = `
  SELECT CASE WHEN known THEN kind || ':' || reference
              ELSE kind || ':' || coalesce(reference, provider_ref) END AS key,
         CASE WHEN known THEN amount ELSE amount - fee END AS amount
  FROM provider_statement_lines WHERE provider = $3 AND occurred_at < $2
  UNION ALL
  SELECT 'fee:' || reference, -fee
  FROM provider_statement_lines WHERE provider = $3 AND occurred_at < $2 AND known AND fee > 0`;

/**
 * Les deux côtés pour quelques clés, tels qu'enregistrés avant `asOf`. Pour apparier les lignes,
 * tout compte (EVERYTHING) : une opération exécutée à 23 h 59 chez l'agrégateur et comptabilisée
 * à 0 h 01 chez Zandu est la même ; seul l'état du solde s'arrête à la fin de la journée.
 */
async function keyStates(
  db: Db,
  provider: string,
  asOf: Date,
  keys: string[],
): Promise<Map<string, KeyState>> {
  const { rows } = await db.query<KeyState & { key: string }>(
    `WITH moves AS (${MOVES}), lines AS (${LINES}),
     g AS (SELECT key, sum(amount)::bigint AS ledger,
                  count(*) FILTER (WHERE NOT adjustment)::int AS booked,
                  count(*) FILTER (WHERE adjustment)::int AS adjusted
           FROM moves WHERE key = ANY($4::text[]) GROUP BY key),
     l AS (SELECT key, sum(amount)::bigint AS statement, count(*)::int AS listed
           FROM lines WHERE key = ANY($4::text[]) GROUP BY key)
     SELECT k.key, coalesce(g.ledger, 0)::bigint AS ledger, coalesce(g.booked, 0) AS booked,
            coalesce(g.adjusted, 0) AS adjusted, coalesce(l.statement, 0)::bigint AS statement,
            coalesce(l.listed, 0) AS listed
     FROM unnest($4::text[]) AS k(key) LEFT JOIN g USING (key) LEFT JOIN l USING (key)`,
    [providerCashAccount(provider), asOf, provider, keys],
  );
  return new Map(rows.map(({ key, ...state }) => [key, state]));
}

/** Pour apparier : tout ce qui est enregistré, y compris dans la transaction du contrôle. */
const EVERYTHING = new Date('9999-12-31T00:00:00Z');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opérations Zandu de cet agrégateur, avec la commande concernée (pour le support). */
async function internalOps(
  db: Db,
  provider: string,
  references: string[],
): Promise<Map<string, InternalOp>> {
  const ids = [...new Set(references.filter((r) => UUID.test(r)))];
  if (!ids.length) return new Map();
  const { rows } = await db.query<InternalOp>(
    `SELECT 'collection' AS kind, p.id::text AS id, p.status::text AS status, o.id AS order_id, o.public_ref
     FROM payments p
     LEFT JOIN LATERAL (SELECT id, public_ref FROM orders WHERE checkout_id = p.checkout_id
                        ORDER BY id LIMIT 1) o ON true
     WHERE p.provider = $1 AND p.id = ANY($2::uuid[])
     UNION ALL
     SELECT 'payout', p.id::text, p.status::text, o.id, o.public_ref
     FROM payouts p LEFT JOIN orders o ON o.id = p.order_id
     WHERE p.provider = $1 AND p.id = ANY($2::uuid[])
     UNION ALL
     SELECT 'refund', r.id::text, r.status::text, o.id, o.public_ref
     FROM refunds r JOIN payments pay ON pay.id = r.payment_id LEFT JOIN orders o ON o.id = r.order_id
     WHERE pay.provider = $1 AND r.id = ANY($2::uuid[])`,
    [provider, ids],
  );
  return new Map(rows.map((op) => [`${op.kind}:${op.id}`, op]));
}

const KIND_LABEL: Record<string, string> = {
  collection: 'paiement',
  payout: 'reversement',
  refund: 'remboursement',
};
const STATUS_LABEL: Record<string, string> = {
  created: 'créé',
  pending: 'en attente',
  processing: 'en cours de vérification',
  failed: 'échoué',
  expired: 'expiré',
  succeeded: 'réussi',
};

const context = (op: InternalOp | undefined) =>
  op?.public_ref ? { orderId: op.order_id, publicRef: op.public_ref } : {};

// ---------------------------------------------------------------------------------------------
// Contrôle d'une journée
// ---------------------------------------------------------------------------------------------

async function recordError(
  ctx: AppContext,
  provider: string,
  date: string,
  period: RunSummary['period'],
  message: string,
  triggeredBy: string | null,
) {
  const now = ctx.clock.now();
  return withTx(ctx.pool, async (tx) => {
    const { rows: before } = await tx.query<{ status: string }>(
      'SELECT status FROM reconciliation_runs WHERE provider = $1 AND statement_date = $2',
      [provider, date],
    );
    const { rows } = await tx.query<RunRow>(
      `INSERT INTO reconciliation_runs (provider, statement_date, status, summary, started_at,
                                        finished_at, attempts, triggered_by)
       VALUES ($1, $2, 'error', $3, $4, $4, 1, $5)
       ON CONFLICT (provider, statement_date) DO UPDATE SET status = 'error', summary = $3,
         started_at = $4, finished_at = $4, attempts = reconciliation_runs.attempts + 1,
         triggered_by = $5
       RETURNING ${RUN_COLUMNS}`,
      [provider, date, { period, error: message }, now, triggeredBy],
    );
    // Une seule alerte par panne : pas une par nouvelle tentative.
    if (before[0]?.status !== 'error') {
      await publish(
        tx,
        'alert.support',
        { type: 'reconciliation_run', id: rows[0]!.id },
        {
          message: `Rapprochement ${provider} du ${formatDate(date)} impossible : relevé de l'agrégateur indisponible (${message})`,
        },
        now,
      );
    }
    return rows[0]!;
  });
}

/**
 * Contrôle (ou recontrôle) la journée `date` : relevé de l'agrégateur contre grand livre.
 * Idempotent : relancer ne crée ni écriture ni écart en double. Pour la journée en cours, la
 * période s'arrête à l'heure du contrôle ; le contrôle de nuit la reprend en entier.
 */
export async function reconcileDay(
  ctx: AppContext,
  provider: string,
  date: string,
  triggeredBy: string | null = null,
) {
  const now = ctx.clock.now();
  const from = dayStart(date);
  const end = dayStart(addDays(date, 1));
  if (from >= now) throw new HttpError(400, 'future_date', 'Cette journée n’a pas commencé');
  const until = end < now ? end : now;
  const period = { from: from.toISOString(), until: until.toISOString() };
  const { cutoffMinutes } = ctx.config.reconciliation;

  let statement;
  try {
    statement = await ctx.providers.get(provider).fetchStatement(from, until);
  } catch (error) {
    const run = await recordError(ctx, provider, date, period, String(error), triggeredBy);
    return runView(run);
  }

  const run = await withTx(ctx.pool, async (tx) => {
    // Deux contrôles du même agrégateur (worker et administrateur) passent l'un après l'autre.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('reconciliation:' || $1))`, [provider]);
    const { rows: runs } = await tx.query<{ id: string }>(
      `INSERT INTO reconciliation_runs (provider, statement_date, status, started_at, attempts, triggered_by)
       VALUES ($1, $2, 'running', $3, 1, $4)
       ON CONFLICT (provider, statement_date) DO UPDATE SET status = 'running', started_at = $3,
         attempts = reconciliation_runs.attempts + 1, triggered_by = $4
       RETURNING id`,
      [provider, date, now, triggeredBy],
    );
    const runId = runs[0]!.id;
    const { rows: era } = await tx.query<{ first: string }>(
      'SELECT min(statement_date)::text AS first FROM reconciliation_runs WHERE provider = $1',
      [provider],
    );
    // Avant le tout premier contrôle, les deux côtés sont réputés d'accord (historique non relu).
    const eraStart = dayStart(era[0]!.first);
    const summary = await compare(ctx, tx, {
      runId,
      provider,
      date,
      period,
      until,
      eraStart,
      cutoffMinutes,
      lines: statement.lines,
      closingBalance: statement.closingBalance,
    });
    const { rows } = await tx.query<RunRow>(
      `UPDATE reconciliation_runs SET status = $2, summary = $3, covered_until = $4, finished_at = $5
       WHERE id = $1 RETURNING ${RUN_COLUMNS}`,
      [
        runId,
        summary.discrepancies!.open ? 'discrepancies' : 'balanced',
        summary,
        until,
        ctx.clock.now(),
      ],
    );
    if (summary.discrepancies!.new) {
      const n = summary.discrepancies!.new;
      await publish(
        tx,
        'alert.support',
        { type: 'reconciliation_run', id: runId },
        {
          message: `Rapprochement ${provider} du ${formatDate(date)} : ${n} écart${n > 1 ? 's' : ''} à examiner (back-office, Rapprochement)`,
        },
        now,
      );
    }
    return rows[0]!;
  });
  return runView(run);
}

async function compare(
  ctx: AppContext,
  tx: Tx,
  input: {
    runId: string;
    provider: string;
    date: string;
    period: RunSummary['period'];
    until: Date;
    eraStart: Date;
    cutoffMinutes: number;
    lines: StatementLine[];
    closingBalance: number | null;
  },
): Promise<RunSummary> {
  const { runId, provider, date, until, lines } = input;
  const cash = providerCashAccount(provider);
  const now = ctx.clock.now();
  const ops = await internalOps(
    tx,
    provider,
    lines.flatMap((l) => (l.reference ? [l.reference] : [])),
  );
  const isKnown = (l: StatementLine) =>
    l.kind !== 'other' && l.reference !== null && ops.has(`${l.kind}:${l.reference}`);

  // 1. Le relevé est conservé tel que reçu (une ligne corrigée par l'agrégateur est mise à jour).
  if (lines.length) {
    await tx.query(
      `INSERT INTO provider_statement_lines
         (provider, provider_ref, kind, reference, known, amount, fee, occurred_at, description, run_id)
       SELECT $1::text, *, $10::uuid FROM unnest($2::text[], $3::text[], $4::text[], $5::boolean[],
                                     $6::bigint[], $7::bigint[], $8::timestamptz[], $9::text[])
       ON CONFLICT (provider, provider_ref) DO UPDATE SET kind = EXCLUDED.kind,
         reference = EXCLUDED.reference, known = EXCLUDED.known, amount = EXCLUDED.amount,
         fee = EXCLUDED.fee, occurred_at = EXCLUDED.occurred_at, description = EXCLUDED.description`,
      [
        provider,
        lines.map((l) => l.providerRef),
        lines.map((l) => l.kind),
        lines.map((l) => l.reference),
        lines.map(isKnown),
        lines.map((l) => l.amount),
        lines.map((l) => l.fee),
        lines.map((l) => l.occurredAt),
        lines.map((l) => l.description ?? null),
        runId,
      ],
    );
  }

  const keyOf = (l: StatementLine) =>
    isKnown(l) ? `${l.kind}:${l.reference}` : `${l.kind}:${l.reference ?? l.providerRef}`;
  const known = lines.filter(isKnown);
  const keys = [...lines.map(keyOf), ...known.map((l) => `fee:${l.reference}`)];
  let states = await keyStates(tx, provider, EVERYTHING, keys);

  // 2. Webhook perdu au-delà des 30 min d'interrogation : le relevé fait foi, comme une
  //    consultation de l'agrégateur (succès tardif d'un paiement → remboursement automatique).
  const statusesApplied: CountAmount = { count: 0, amount: 0 };
  for (const l of known) {
    const op = ops.get(keyOf(l))!;
    if (states.get(keyOf(l))!.booked > 0) continue;
    const result = { status: 'succeeded' as const, providerRef: l.providerRef };
    try {
      if (op.kind === 'collection' && op.status !== 'succeeded') {
        await applyCollectionSignal(ctx, tx, op.id, 'succeeded', { ...result, fee: l.fee });
      } else if (op.status === 'pending' || op.status === 'processing') {
        if (op.kind === 'payout') await applyDisbursementResult(ctx, tx, payoutSpec, op.id, result);
        else await applyDisbursementResult(ctx, tx, refundSpec, op.id, result);
      } else continue;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      continue; // transition refusée : signalée plus bas comme écart de statut
    }
    statusesApplied.count++;
    statusesApplied.amount += Math.abs(l.amount);
  }
  if (statusesApplied.count) states = await keyStates(tx, provider, EVERYTHING, keys);

  // 3. Frais révélés par le relevé seul (l'agrégateur ne les annonce pas toujours par webhook).
  const feesBooked: CountAmount = { count: 0, amount: 0 };
  for (const l of known) {
    const fee = states.get(`fee:${l.reference}`)!;
    const principal = states.get(keyOf(l))!;
    if (l.fee > 0 && principal.booked > 0 && fee.booked === 0 && fee.adjusted === 0) {
      const { posted } = await postJournal(
        tx,
        recordProviderFee({ provider, reference: l.reference!, amount: l.fee }),
        l.occurredAt,
      );
      if (posted) {
        feesBooked.count++;
        feesBooked.amount += l.fee;
      }
    }
  }
  if (feesBooked.count) states = await keyStates(tx, provider, EVERYTHING, keys);

  // 4. Chaque ligne du relevé doit correspondre à une opération Zandu comptabilisée.
  const candidates: Candidate[] = [];
  let matched = 0;
  for (const l of lines) {
    const key = keyOf(l);
    const state = states.get(key)!;
    if (!isKnown(l)) {
      candidates.push({
        kind: 'missing_internal',
        operationKind: l.kind,
        reference: l.reference ?? l.providerRef,
        providerRef: l.providerRef,
        internalAmount: 0,
        providerAmount: l.amount - l.fee,
        details: {
          message: `Mouvement de l'agrégateur sans opération Zandu${l.description ? ` : « ${l.description} »` : ''}`,
          ...(l.description ? { description: l.description } : {}),
          occurredAt: l.occurredAt,
        },
      });
      continue;
    }
    const op = ops.get(key)!;
    let clean = true;
    if (state.booked === 0) {
      clean = false;
      const risky = op.kind === 'payout' && op.status === 'failed';
      candidates.push({
        kind: 'status_mismatch',
        operationKind: op.kind,
        reference: op.id,
        providerRef: l.providerRef,
        internalAmount: 0,
        providerAmount: l.amount,
        details: {
          message:
            `L'agrégateur a exécuté ce ${KIND_LABEL[op.kind]} ; chez Zandu il est « ${STATUS_LABEL[op.status] ?? op.status} »` +
            (risky
              ? ' : le montant est revenu sur le solde du vendeur, risque de double reversement'
              : ''),
          internalStatus: op.status,
          occurredAt: l.occurredAt,
          ...context(op),
        },
      });
    } else if (state.statement !== state.ledger) {
      clean = false;
      candidates.push({
        kind: 'amount_mismatch',
        operationKind: op.kind,
        reference: op.id,
        providerRef: l.providerRef,
        internalAmount: state.ledger,
        providerAmount: state.statement,
        details: {
          message: `Montant du ${KIND_LABEL[op.kind]} différent : ${formatXaf(Math.abs(state.statement))} au relevé, ${formatXaf(Math.abs(state.ledger))} chez Zandu`,
          occurredAt: l.occurredAt,
          ...context(op),
        },
      });
    }
    const fee = states.get(`fee:${l.reference}`)!;
    if (state.booked > 0 && fee.statement !== fee.ledger) {
      clean = false;
      candidates.push({
        kind: 'fee_mismatch',
        operationKind: 'fee',
        reference: op.id,
        providerRef: l.providerRef,
        internalAmount: fee.ledger,
        providerAmount: fee.statement,
        details: {
          message: `Frais différents : ${formatXaf(-fee.statement)} au relevé, ${formatXaf(-fee.ledger)} chez Zandu`,
          occurredAt: l.occurredAt,
          ...context(op),
        },
      });
    }
    if (clean) matched++;
  }

  // 5. Chaque mouvement comptabilisé chez Zandu sur la période doit figurer au relevé.
  const windowStart = addMinutes(dayStart(date), -input.cutoffMinutes);
  const transitFrom = addMinutes(until, -input.cutoffMinutes);
  const { rows: absent } = await tx.query<{ key: string; amount: number; created_at: Date }>(
    `SELECT m.key, m.amount, m.created_at FROM (${MOVES}) m
     WHERE NOT m.adjustment AND m.created_at >= $4
       AND split_part(m.key, ':', 1) IN ('collection', 'payout', 'refund')
       AND NOT EXISTS (SELECT 1 FROM provider_statement_lines l
                       WHERE l.provider = $3 AND l.kind = split_part(m.key, ':', 1)
                         AND l.reference = split_part(m.key, ':', 2))
     ORDER BY m.created_at`,
    [cash, until, provider, windowStart > input.eraStart ? windowStart : input.eraStart],
  );
  const inTransit: CountAmount = { count: 0, amount: 0 };
  const absentOps = await internalOps(
    tx,
    provider,
    absent.map((m) => m.key.split(':')[1]!),
  );
  for (const m of absent) {
    if (m.created_at >= transitFrom) {
      inTransit.count++;
      inTransit.amount += m.amount;
      continue;
    }
    const [kind, reference] = m.key.split(':') as ['collection' | 'payout' | 'refund', string];
    candidates.push({
      kind: 'missing_provider',
      operationKind: kind,
      reference,
      providerRef: null,
      internalAmount: m.amount,
      providerAmount: 0,
      details: {
        message: `${KIND_LABEL[kind]![0]!.toUpperCase()}${KIND_LABEL[kind]!.slice(1)} comptabilisé chez Zandu, absent du relevé de l'agrégateur`,
        bookedAt: m.created_at,
        ...context(absentOps.get(m.key)),
      },
    });
  }

  // 6. État de rapprochement : écart de solde que les mouvements ci-dessus n'expliquent pas.
  let balance: RunSummary['balance'] = null;
  if (input.closingBalance !== null) {
    const { rows } = await tx.query<{
      ledger: number;
      later_adjustments: number;
      not_on_statement: number;
      not_in_ledger: number;
      differences: number;
    }>(
      `WITH moves AS (${MOVES}), lines AS (${LINES}),
       g AS (SELECT key, sum(amount) AS total, sum(amount) FILTER (WHERE created_at >= $4) AS era
             FROM moves WHERE key IS NOT NULL GROUP BY key),
       l AS (SELECT key, sum(amount) AS total FROM lines GROUP BY key)
       SELECT (SELECT coalesce(sum(amount), 0) FROM moves)::bigint AS ledger,
              -- Régularisation d'un écart de solde de cette journée (ou d'avant), passée plus tard.
              (SELECT coalesce(sum(e.amount), 0) FROM reconciliation_discrepancies d
               JOIN reconciliation_runs r ON r.id = d.run_id
               JOIN ledger_entries e ON e.transaction_id = d.adjustment_transaction_id
               JOIN ledger_accounts a ON a.id = e.account_id AND a.code = $1
               WHERE d.provider = $3 AND d.operation_kind = 'balance'
                 AND r.statement_date <= $5 AND e.created_at >= $2)::bigint AS later_adjustments,
              coalesce(sum(g.era) FILTER (WHERE l.key IS NULL), 0)::bigint AS not_on_statement,
              coalesce(sum(l.total) FILTER (WHERE g.key IS NULL), 0)::bigint AS not_in_ledger,
              coalesce(sum(l.total - g.total) FILTER (WHERE g.key IS NOT NULL AND l.key IS NOT NULL), 0)::bigint AS differences
       FROM g FULL JOIN l ON l.key = g.key`,
      [cash, until, provider, input.eraStart, date],
    );
    const b = rows[0]!;
    const explained =
      b.ledger + b.later_adjustments - b.not_on_statement + b.not_in_ledger + b.differences;
    balance = {
      provider: input.closingBalance,
      ledger: b.ledger,
      laterAdjustments: b.later_adjustments,
      notOnStatement: b.not_on_statement,
      notInLedger: b.not_in_ledger,
      amountDifferences: b.differences,
      unexplained: input.closingBalance - explained,
    };
    await balanceCandidate(tx, provider, date, now, balance, explained, candidates);
  }

  // 7. Enregistrement des écarts : jamais deux fois le même, même après plusieurs contrôles.
  let created = 0;
  for (const c of candidates) {
    const { rowCount } = await tx.query(
      `INSERT INTO reconciliation_discrepancies (run_id, provider, kind, operation_kind, reference,
         provider_ref, internal_amount, provider_amount, details, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (provider, kind, operation_kind, reference) DO NOTHING`,
      [
        runId,
        provider,
        c.kind,
        c.operationKind,
        c.reference,
        c.providerRef,
        c.internalAmount,
        c.providerAmount,
        c.details,
        now,
      ],
    );
    created += rowCount ?? 0;
  }

  await autoResolve(tx, provider, now);

  const { rows: counts } = await tx.query<{ found: number; open: number }>(
    `SELECT count(*)::int AS found, count(*) FILTER (WHERE resolved_at IS NULL)::int AS open
     FROM reconciliation_discrepancies WHERE run_id = $1`,
    [runId],
  );
  const total = (kind: StatementLine['kind']): CountAmount => {
    const of = lines.filter((l) => l.kind === kind);
    return { count: of.length, amount: of.reduce((s, l) => s + Math.abs(l.amount), 0) };
  };
  const other = lines.filter((l) => l.kind === 'other');
  return {
    period: input.period,
    statement: {
      lines: lines.length,
      collections: total('collection'),
      payouts: total('payout'),
      refunds: total('refund'),
      other: { count: other.length, amount: other.reduce((s, l) => s + l.amount, 0) },
      fees: lines.reduce((s, l) => s + l.fee, 0),
    },
    matched,
    statusesApplied,
    feesBooked,
    inTransit,
    balance,
    discrepancies: { ...counts[0]!, new: created },
  };
}

/**
 * Écart de solde : la part du solde de l'agrégateur que rien n'explique. Un écart déjà signalé
 * (encore ouvert) n'est pas resignalé les jours suivants ; il se clôt de lui-même si le relevé
 * finit par l'expliquer, sinon par une régularisation (obligatoire pour ce type d'écart).
 */
async function balanceCandidate(
  tx: Tx,
  provider: string,
  date: string,
  now: Date,
  balance: NonNullable<RunSummary['balance']>,
  explained: number,
  candidates: Candidate[],
): Promise<void> {
  const { rows } = await tx.query<{
    id: string;
    reference: string;
    gap: number;
    resolved_at: Date | null;
    statement_date: string;
  }>(
    `SELECT d.id, d.reference, (d.provider_amount - d.internal_amount)::bigint AS gap,
            d.resolved_at, r.statement_date::text AS statement_date
     FROM reconciliation_discrepancies d JOIN reconciliation_runs r ON r.id = d.run_id
     WHERE d.provider = $1 AND d.kind = 'balance_mismatch' AND r.statement_date <= $2`,
    [provider, date],
  );
  const open = rows.filter((r) => !r.resolved_at);
  const close = async (id: string) =>
    tx.query(
      `UPDATE reconciliation_discrepancies SET resolved_at = $2, auto_resolved = true,
         resolution_note = 'Résolu automatiquement : le solde de l’agrégateur est expliqué'
       WHERE id = $1`,
      [id, now],
    );
  if (balance.unexplained === 0) {
    for (const r of open) await close(r.id);
    return;
  }
  const carried = open
    .filter((r) => r.statement_date < date)
    .reduce((total, r) => total + r.gap, 0);
  const gap = balance.unexplained - carried;
  const own = open.find((r) => r.statement_date === date);
  if (own) {
    if (gap === 0) await close(own.id);
    else
      await tx.query(
        'UPDATE reconciliation_discrepancies SET internal_amount = $2, provider_amount = $3 WHERE id = $1',
        [own.id, explained + carried, balance.provider],
      );
    return;
  }
  if (gap === 0) return;
  const sameDay = rows.filter((r) => r.reference === date || r.reference.startsWith(`${date}#`));
  candidates.push({
    kind: 'balance_mismatch',
    operationKind: 'balance',
    reference: sameDay.length ? `${date}#${sameDay.length + 1}` : date,
    providerRef: null,
    internalAmount: explained + carried,
    providerAmount: balance.provider,
    details: {
      message: `Solde de l'agrégateur inexpliqué de ${formatXaf(gap)} : mouvement absent du relevé détaillé`,
    },
  });
}

/** Écarts qui se sont réglés d'eux-mêmes (webhook arrivé, ligne parue au relevé suivant). */
async function autoResolve(tx: Tx, provider: string, now: Date): Promise<void> {
  const { rows } = await tx.query<{
    id: string;
    kind: DiscrepancyKind;
    operation_kind: TargetKind;
    reference: string;
  }>(
    `SELECT id, kind, operation_kind, reference FROM reconciliation_discrepancies
     WHERE provider = $1 AND resolved_at IS NULL
       AND kind IN ('missing_provider', 'status_mismatch', 'amount_mismatch', 'fee_mismatch')`,
    [provider],
  );
  if (!rows.length) return;
  const states = await keyStates(
    tx,
    provider,
    EVERYTHING,
    rows.map((d) => `${d.operation_kind}:${d.reference}`),
  );
  for (const d of rows) {
    const s = states.get(`${d.operation_kind}:${d.reference}`)!;
    const note =
      d.kind === 'missing_provider'
        ? s.listed > 0 && 'le mouvement figure désormais au relevé de l’agrégateur'
        : d.kind === 'status_mismatch'
          ? s.booked > 0 && 'l’opération est désormais comptabilisée chez Zandu'
          : s.statement === s.ledger && 'les montants concordent désormais';
    if (!note) continue;
    await tx.query(
      `UPDATE reconciliation_discrepancies SET resolved_at = $2, auto_resolved = true,
         resolution_note = $3 WHERE id = $1`,
      [d.id, now, `Résolu automatiquement : ${note}`],
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Tâche de nuit
// ---------------------------------------------------------------------------------------------

/** Première journée contrôlable : aucun contrôle avant le premier paiement, ni avant le premier contrôle. */
async function firstDate(db: Db, provider: string): Promise<string | null> {
  const { rows } = await db.query<{ first_payment: Date | null; first_run: string | null }>(
    `SELECT (SELECT min(created_at) FROM payments WHERE provider = $1) AS first_payment,
            (SELECT min(statement_date)::text FROM reconciliation_runs WHERE provider = $1) AS first_run`,
    [provider],
  );
  const r = rows[0]!;
  if (r.first_run) return r.first_run;
  return r.first_payment ? congoDate(r.first_payment) : null;
}

/**
 * Après 2 h (heure du Congo), contrôle la veille de chaque agrégateur ; rattrape les journées
 * manquées (worker arrêté) et redemande un relevé indisponible toutes les 30 min. Une journée
 * par agrégateur et par passage : le worker reste disponible pour l'argent et les messages.
 */
export async function reconcileStatements(ctx: AppContext): Promise<number> {
  const now = ctx.clock.now();
  const { runAtHour, catchUpDays, retryMinutes } = ctx.config.reconciliation;
  const latest = addDays(congoDate(now), congoHour(now) >= runAtHour ? -1 : -2);
  let done = 0;
  for (const provider of ctx.providers.codes) {
    const first = await firstDate(ctx.pool, provider);
    if (!first) continue;
    const catchUp = addDays(latest, -(catchUpDays - 1));
    const start = first > catchUp ? first : catchUp;
    const { rows } = await ctx.pool.query<{
      date: string;
      status: string;
      covered_until: Date | null;
      finished_at: Date | null;
    }>(
      `SELECT statement_date::text AS date, status, covered_until, finished_at
       FROM reconciliation_runs WHERE provider = $1 AND statement_date BETWEEN $2 AND $3`,
      [provider, start, latest],
    );
    const byDate = new Map(rows.map((r) => [r.date, r]));
    for (let date = start; date <= latest; date = addDays(date, 1)) {
      const run = byDate.get(date);
      const due = !run
        ? true
        : run.status === 'error'
          ? run.finished_at! <= addMinutes(now, -retryMinutes)
          : !run.covered_until || run.covered_until < dayStart(addDays(date, 1));
      if (!due) continue;
      await reconcileDay(ctx, provider, date);
      done++;
      break;
    }
  }
  return done;
}

// ---------------------------------------------------------------------------------------------
// Lecture et résolution (back-office, administrateurs)
// ---------------------------------------------------------------------------------------------

interface DiscrepancyRow {
  id: string;
  run_id: string;
  statement_date: string;
  provider: string;
  kind: DiscrepancyKind;
  operation_kind: TargetKind;
  reference: string;
  provider_ref: string | null;
  internal_amount: number | null;
  provider_amount: number | null;
  details: Record<string, unknown>;
  created_at: Date;
  resolved_at: Date | null;
  resolved_by_phone: string | null;
  resolution_note: string | null;
  auto_resolved: boolean;
}

const DISCREPANCY_SELECT = `
  SELECT d.id, d.run_id, r.statement_date::text AS statement_date, d.provider, d.kind,
         d.operation_kind, d.reference, d.provider_ref, d.internal_amount, d.provider_amount,
         d.details, d.created_at, d.resolved_at, u.phone AS resolved_by_phone, d.resolution_note,
         d.auto_resolved
  FROM reconciliation_discrepancies d
  JOIN reconciliation_runs r ON r.id = d.run_id
  LEFT JOIN users u ON u.id = d.resolved_by`;

export function discrepancyView(d: DiscrepancyRow) {
  const internal = d.internal_amount ?? 0;
  const provider = d.provider_amount ?? 0;
  return {
    id: d.id,
    runId: d.run_id,
    date: d.statement_date,
    provider: d.provider,
    kind: d.kind,
    operationKind: d.operation_kind,
    reference: d.reference,
    providerRef: d.provider_ref,
    internalAmount: internal,
    providerAmount: provider,
    /** À régulariser : + l'agrégateur détient plus que nos comptes, − moins. */
    difference: provider - internal,
    message: String(d.details.message ?? ''),
    orderId: (d.details.orderId as string | undefined) ?? null,
    publicRef: (d.details.publicRef as string | undefined) ?? null,
    createdAt: d.created_at,
    resolution: d.resolved_at
      ? {
          at: d.resolved_at,
          by: d.resolved_by_phone,
          note: d.resolution_note!,
          automatic: d.auto_resolved,
          adjustment:
            (d.details.adjustment as { counterpart: AdjustmentCounterpart; amount: number }) ??
            null,
        }
      : null,
  };
}

export async function listRuns(db: Db, limit: number) {
  const { rows } = await db.query<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM reconciliation_runs ORDER BY statement_date DESC, provider LIMIT $1`,
    [limit],
  );
  const { rows: open } = await db.query<{ count: number; amount: number }>(
    `SELECT count(*)::int AS count,
            coalesce(sum(abs(coalesce(provider_amount, 0) - coalesce(internal_amount, 0))), 0)::bigint AS amount
     FROM reconciliation_discrepancies WHERE resolved_at IS NULL`,
  );
  // Jours de suite sans écart, du plus récent au plus ancien (critère de recette : 7).
  let streak = 0;
  for (const r of rows) {
    if (r.status === 'error' || (r.summary.discrepancies?.found ?? 0) > 0) break;
    streak++;
  }
  return { items: rows.map(runView), streak, open: open[0]! };
}

export async function getRun(db: Db, id: string) {
  const { rows } = await db.query<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM reconciliation_runs WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw notFound('Contrôle');
  const { rows: discrepancies } = await db.query<DiscrepancyRow>(
    `${DISCREPANCY_SELECT} WHERE d.run_id = $1 ORDER BY d.resolved_at IS NULL DESC, d.created_at, d.id`,
    [id],
  );
  return { run: runView(rows[0]), discrepancies: discrepancies.map(discrepancyView) };
}

export async function listDiscrepancies(db: Db, status: 'open' | 'all') {
  const { rows } = await db.query<DiscrepancyRow>(
    `${DISCREPANCY_SELECT} ${status === 'open' ? 'WHERE d.resolved_at IS NULL' : ''}
     ORDER BY d.created_at DESC, d.id LIMIT 200`,
  );
  return { items: rows.map(discrepancyView) };
}

/**
 * Un administrateur clôt un écart : explication obligatoire, et au besoin une écriture de
 * régularisation qui aligne le compte agrégateur sur le relevé (frais, apport, compte d'attente).
 */
export async function resolveDiscrepancy(
  ctx: AppContext,
  actor: Actor,
  id: string,
  input: { note: string; adjustment?: AdjustmentCounterpart },
) {
  const now = ctx.clock.now();
  await withTx(ctx.pool, async (tx) => {
    const { rows } = await tx.query<{
      run_id: string;
      provider: string;
      kind: DiscrepancyKind;
      reference: string;
      internal_amount: number | null;
      provider_amount: number | null;
      resolved_at: Date | null;
    }>(
      `SELECT run_id, provider, kind, reference, internal_amount, provider_amount, resolved_at
       FROM reconciliation_discrepancies WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const d = rows[0];
    if (!d) throw notFound('Écart');
    if (d.resolved_at) throw new HttpError(409, 'already_resolved', 'Cet écart est déjà résolu');
    const amount = (d.provider_amount ?? 0) - (d.internal_amount ?? 0);
    if (d.kind === 'balance_mismatch' && !input.adjustment) {
      throw new HttpError(
        400,
        'adjustment_required',
        'Un écart de solde se résout par une écriture (frais, apport ou compte d’attente)',
      );
    }
    let adjustment: { counterpart: AdjustmentCounterpart; amount: number } | null = null;
    if (input.adjustment) {
      if (amount === 0)
        throw new HttpError(409, 'nothing_to_adjust', 'Aucun montant à régulariser pour cet écart');
      const { transactionId } = await postJournal(
        tx,
        adjustProviderCash({
          discrepancyId: id,
          provider: d.provider,
          amount,
          counterpart: input.adjustment,
        }),
        now,
      );
      await tx.query(
        'UPDATE reconciliation_discrepancies SET adjustment_transaction_id = $2 WHERE id = $1',
        [id, transactionId],
      );
      adjustment = { counterpart: input.adjustment, amount };
    }
    await tx.query(
      `UPDATE reconciliation_discrepancies SET resolved_at = $2, resolved_by = $3, resolution_note = $4,
         details = details || $5::jsonb
       WHERE id = $1`,
      [id, now, actor.userId, input.note, adjustment ? { adjustment } : {}],
    );
    await tx.query(
      `UPDATE reconciliation_runs SET status = 'balanced'
       WHERE id = $1 AND status = 'discrepancies'
         AND NOT EXISTS (SELECT 1 FROM reconciliation_discrepancies
                         WHERE run_id = $1 AND resolved_at IS NULL)`,
      [d.run_id],
    );
    await audit(
      tx,
      actor,
      'reconciliation.discrepancy_resolved',
      { type: 'reconciliation_discrepancy', id },
      { kind: d.kind, reference: d.reference, note: input.note, adjustment },
    );
  });
  const { rows } = await ctx.pool.query<DiscrepancyRow>(`${DISCREPANCY_SELECT} WHERE d.id = $1`, [
    id,
  ]);
  return discrepancyView(rows[0]!);
}

/** Journées qu'un administrateur peut (re)contrôler : de la première contrôlée à aujourd'hui. */
export async function assertControllable(ctx: AppContext, provider: string, date: string) {
  if (!ctx.providers.has(provider))
    throw new HttpError(404, 'unknown_provider', 'Agrégateur inconnu');
  if (date > congoDate(ctx.clock.now()))
    throw new HttpError(400, 'future_date', 'Cette journée n’a pas commencé');
  const { rows } = await ctx.pool.query<{ first: string | null }>(
    'SELECT min(statement_date)::text AS first FROM reconciliation_runs WHERE provider = $1',
    [provider],
  );
  const first = rows[0]!.first;
  if (first && date < first) {
    throw new HttpError(
      409,
      'before_first_control',
      `Les contrôles commencent le ${formatDate(first)} : les journées antérieures ne sont pas relues`,
    );
  }
}
