import { formatXaf, reserveRefund, settleRefund, type MobileOperator } from '@zandu/domain';
import type { AppContext } from '../../context.js';
import type { Tx } from '../../db/pool.js';
import { postJournal } from '../ledger/ledger.repository.js';
import { publish } from '../notifications/outbox.js';
import {
  processDisbursements,
  type DisbursementRow,
  type DisbursementSpec,
} from '../payouts/disbursements.js';

/**
 * Enregistre un remboursement décidé (annulation, litige, paiement tardif). L'argent quitte
 * immédiatement le séquestre (ou le compte d'attente) dans le grand livre ; l'envoi réel vers
 * le compte Mobile Money de l'acheteur est fait par le worker, avec nouvelles tentatives.
 */
export async function createRefund(
  ctx: AppContext,
  tx: Tx,
  input: {
    paymentId: string;
    orderId: string | null;
    amount: number;
    reason: string;
    decidedBy: string | null;
  },
): Promise<string> {
  const now = ctx.clock.now();
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO refunds (payment_id, order_id, amount, reason, decided_by, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
    [input.paymentId, input.orderId, input.amount, input.reason, input.decidedBy, now],
  );
  const refundId = rows[0]!.id;
  await postJournal(
    tx,
    reserveRefund({
      refundId,
      amount: input.amount,
      source: input.orderId
        ? { kind: 'escrow', orderId: input.orderId }
        : { kind: 'suspense', paymentId: input.paymentId },
    }),
    ctx.clock.now(),
  );
  return refundId;
}

interface RefundRow extends DisbursementRow {
  payment_id: string;
  buyer_id: string;
  msisdn: string;
  operator: MobileOperator;
}

export const refundSpec: DisbursementSpec<RefundRow> = {
  table: 'refunds',
  kind: 'refund',
  async lock(tx, id) {
    // Le remboursement repart par l'agrégateur et vers le numéro qui a payé.
    const { rows } = await tx.query<RefundRow>(
      `SELECT r.id, r.amount, r.status, r.attempts, p.provider, r.provider_ref, r.payment_id,
              p.buyer_id, p.msisdn, p.operator
       FROM refunds r JOIN payments p ON p.id = r.payment_id
       WHERE r.id = $1 FOR UPDATE OF r`,
      [id],
    );
    return rows[0] ?? null;
  },
  send: (provider, row) =>
    provider.initiateRefund({
      reference: row.id,
      originalReference: row.payment_id,
      amount: row.amount,
      currency: 'XAF',
      msisdn: row.msisdn,
      operator: row.operator,
      description: 'Remboursement Zandu',
    }),
  async onSucceeded(ctx, tx, row) {
    await postJournal(
      tx,
      settleRefund({ refundId: row.id, provider: row.provider, amount: row.amount }),
      ctx.clock.now(),
    );
    await publish(
      tx,
      'refund.succeeded',
      { type: 'refund', id: row.id },
      { userId: row.buyer_id, amount: row.amount },
      ctx.clock.now(),
    );
  },
  async onFinalFailure(ctx, tx, row, reason) {
    // L'argent reste en « remboursements en cours » : un agent contacte l'acheteur.
    await publish(
      tx,
      'alert.support',
      { type: 'refund', id: row.id },
      {
        message: `Remboursement ${row.id} de ${formatXaf(row.amount)} en échec définitif : ${reason}`,
      },
      ctx.clock.now(),
    );
  },
};

export const processRefunds = (ctx: AppContext): Promise<number> =>
  processDisbursements(ctx, refundSpec);
