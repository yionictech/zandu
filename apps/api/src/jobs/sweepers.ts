import { DomainError } from '@zandu/domain';
import { SYSTEM, type AppContext } from '../context.js';
import { withTx } from '../db/pool.js';
import { processProductMedia } from '../modules/media/media.service.js';
import { dispatchOutbox, sendNotifications } from '../modules/notifications/dispatcher.js';
import { applyOrderEvent } from '../modules/orders/orders.service.js';
import {
  expireCheckouts,
  expirePayments,
  pollPayments,
} from '../modules/payments/payments.service.js';
import { processRefunds } from '../modules/payments/refunds.service.js';
import { processPayouts, sweepSellerBalances } from '../modules/payouts/payouts.service.js';
import { reconcileStatements } from '../modules/reconciliation/reconciliation.service.js';

/** Échéances de commande : vendeur silencieux (annulation + remboursement), fin de la fenêtre de litige. */
async function orderDeadlines(ctx: AppContext): Promise<number> {
  const now = ctx.clock.now();
  const { rows } = await ctx.pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM orders
     WHERE (status = 'paid' AND seller_accept_deadline <= $1)
        OR (status = 'delivered' AND dispute_window_ends_at <= $1)
     ORDER BY id LIMIT 100`,
    [now],
  );
  for (const { id, status } of rows) {
    await withTx(ctx.pool, (tx) =>
      applyOrderEvent(
        ctx,
        tx,
        id,
        { type: status === 'paid' ? 'seller_acceptance_timeout' : 'dispute_window_elapsed' },
        SYSTEM,
      ),
    ).catch((error: unknown) => {
      // Transition déjà faite par une autre instance entre la sélection et le verrou : normal.
      if (!(error instanceof DomainError)) throw error;
    });
  }
  return rows.length;
}

/**
 * Toutes les tâches de fond, dans l'ordre où elles doivent s'enchaîner. Chacune est
 * idempotente et ne traite que ce qui est échu : on peut l'appeler aussi souvent qu'on veut,
 * depuis plusieurs instances (FOR UPDATE SKIP LOCKED + transitions vérifiées).
 */
export const SWEEPERS: ReadonlyArray<[string, (ctx: AppContext) => Promise<number>]> = [
  ['expirePayments', expirePayments],
  ['pollPayments', pollPayments],
  ['expireCheckouts', expireCheckouts],
  ['orderDeadlines', orderDeadlines],
  ['processRefunds', processRefunds],
  ['sweepSellerBalances', sweepSellerBalances],
  ['processPayouts', processPayouts],
  // Après les reversements et avant l'envoi des messages : une alerte d'écart part dans la passe.
  ['reconcileStatements', reconcileStatements],
  ['dispatchOutbox', dispatchOutbox],
  ['sendNotifications', sendNotifications],
  // En dernier : le traitement d'image est le plus lent, l'argent et les messages passent avant.
  ['processProductMedia', processProductMedia],
];

export async function runSweepers(
  ctx: AppContext,
  log: (name: string, error: unknown) => void = () => undefined,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [name, sweep] of SWEEPERS) {
    try {
      counts[name] = await sweep(ctx);
    } catch (error) {
      log(name, error);
    }
  }
  return counts;
}
