import type { AppContext } from '../../context.js';
import { withTx, type Tx } from '../../db/pool.js';
import { addMinutes } from '../../lib/clock.js';
import type { PaymentProvider, ProviderResult } from '../payments/provider.js';

/**
 * Moteur commun aux sorties d'argent (reversements vendeurs, remboursements acheteurs).
 *
 *   pending ──initiate──► succeeded
 *      ▲          ├─────► processing ──lookup──► succeeded | failed | (toujours en cours)
 *      └─retry────┴─────► failed (après maxAttempts : alerte support)
 *
 * Garanties : l'appel à l'agrégateur se fait HORS transaction (pas de verrou tenu pendant
 * un appel réseau) ; une opération dont on ignore l'issue (timeout) passe en « processing »
 * et est d'abord VÉRIFIÉE (lookup) avant toute nouvelle tentative : jamais de double paiement.
 */
export interface DisbursementRow {
  id: string;
  amount: number;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  attempts: number;
  provider: string;
  provider_ref: string | null;
}

export interface DisbursementSpec<Row extends DisbursementRow> {
  table: 'payouts' | 'refunds';
  kind: 'payout' | 'refund';
  lock(tx: Tx, id: string): Promise<Row | null>;
  send(provider: PaymentProvider, row: Row): Promise<ProviderResult>;
  onSucceeded(ctx: AppContext, tx: Tx, row: Row): Promise<void>;
  onFinalFailure(ctx: AppContext, tx: Tx, row: Row, reason: string): Promise<void>;
}

export async function applyDisbursementResult<Row extends DisbursementRow>(
  ctx: AppContext,
  tx: Tx,
  spec: DisbursementSpec<Row>,
  id: string,
  result: ProviderResult,
): Promise<void> {
  const row = await spec.lock(tx, id);
  if (!row || row.status === 'succeeded' || row.status === 'failed') return; // déjà réglé : idempotent
  const now = ctx.clock.now();
  const { maxAttempts, backoffMinutes, leaseMinutes } = ctx.config.disbursements;

  if (result.status === 'succeeded') {
    await tx.query(
      `UPDATE ${spec.table} SET status = 'succeeded', succeeded_at = $2, provider_ref = coalesce($3, provider_ref) WHERE id = $1`,
      [id, now, result.providerRef ?? null],
    );
    await spec.onSucceeded(ctx, tx, { ...row, status: 'succeeded' });
  } else if (result.status === 'pending') {
    await tx.query(
      `UPDATE ${spec.table} SET status = 'processing', provider_ref = coalesce($2, provider_ref), next_attempt_at = $3 WHERE id = $1`,
      [id, result.providerRef ?? null, addMinutes(now, leaseMinutes)],
    );
  } else {
    const reason = result.failureMessage ?? result.failureCode ?? 'échec agrégateur';
    if (row.attempts >= maxAttempts) {
      await tx.query(`UPDATE ${spec.table} SET status = 'failed', last_error = $2 WHERE id = $1`, [
        id,
        reason,
      ]);
      await spec.onFinalFailure(ctx, tx, { ...row, status: 'failed' }, reason);
    } else {
      const delay =
        backoffMinutes[Math.min(row.attempts, backoffMinutes.length) - 1] ?? backoffMinutes[0]!;
      await tx.query(
        `UPDATE ${spec.table} SET status = 'pending', last_error = $2, next_attempt_at = $3 WHERE id = $1`,
        [id, reason, addMinutes(now, delay)],
      );
    }
  }
}

export async function processDisbursements<Row extends DisbursementRow>(
  ctx: AppContext,
  spec: DisbursementSpec<Row>,
): Promise<number> {
  const now = ctx.clock.now();
  const lease = addMinutes(now, ctx.config.disbursements.leaseMinutes);

  // 1. Réserver un lot (bail de quelques minutes) : un autre worker ne le prendra pas. Le lot
  //    passe en « processing » AVANT l'appel : si le worker s'arrête net, la passe suivante
  //    vérifiera auprès de l'agrégateur au lieu de renvoyer l'ordre.
  const claimed = await withTx(ctx.pool, async (tx) => {
    const { rows } = await tx.query<{ id: string; status: 'pending' | 'processing' }>(
      `UPDATE ${spec.table} t SET status = 'processing', next_attempt_at = $2,
              attempts = t.attempts + CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END
       FROM (SELECT id, status FROM ${spec.table}
             WHERE status IN ('pending', 'processing') AND next_attempt_at <= $1
             ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED) due
       WHERE t.id = due.id
       RETURNING t.id, due.status`,
      [now, lease],
    );
    return rows;
  });

  for (const { id, status } of claimed) {
    const row = await withTx(ctx.pool, (tx) => spec.lock(tx, id));
    if (!row) continue;
    const provider = ctx.providers.get(row.provider);
    let result: ProviderResult | null = null;
    try {
      if (status === 'processing') {
        // Issue inconnue : on vérifie avant de renvoyer quoi que ce soit.
        const found = await provider.lookup(spec.kind, id);
        if (!found.found) {
          await withTx(ctx.pool, (tx) =>
            tx.query(
              `UPDATE ${spec.table} SET status = 'pending', next_attempt_at = $2 WHERE id = $1 AND status = 'processing'`,
              [id, now],
            ),
          );
          continue;
        }
        result = found;
      } else {
        result = await spec.send(provider, row);
      }
    } catch {
      // Timeout ou erreur réseau : l'opération a peut-être été exécutée. On la marque
      // « processing » ; la prochaine passe vérifiera auprès de l'agrégateur.
      await withTx(ctx.pool, (tx) =>
        tx.query(
          `UPDATE ${spec.table} SET status = 'processing', next_attempt_at = $2 WHERE id = $1 AND status IN ('pending', 'processing')`,
          [id, lease],
        ),
      );
      continue;
    }
    await withTx(ctx.pool, (tx) => applyDisbursementResult(ctx, tx, spec, id, result));
  }
  return claimed.length;
}
