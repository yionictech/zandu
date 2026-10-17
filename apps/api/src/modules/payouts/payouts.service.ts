import {
  payableAmount,
  reservePayout,
  reversePayout,
  sellerPayableAccount,
  settlePayout,
  formatXaf,
  type MobileOperator,
  type PayoutBlockReason,
} from '@zandu/domain';
import type { AppContext } from '../../context.js';
import { withTx, type Tx } from '../../db/pool.js';
import { addHours } from '../../lib/clock.js';
import { notFound } from '../../lib/errors.js';
import { accountBalance, postJournal } from '../ledger/ledger.repository.js';
import { publish } from '../notifications/outbox.js';
import {
  processDisbursements,
  type DisbursementRow,
  type DisbursementSpec,
} from './disbursements.js';

interface SellerPayoutProfile {
  id: string;
  user_id: string;
  verification_status: string;
  verified_at: Date | null;
  payout_msisdn: string;
  payout_operator: MobileOperator;
  payout_msisdn_changed_at: Date | null;
  payout_cap_override: number | null;
}

export interface ScheduledPayout {
  payoutId: string | null;
  amount: number;
  blockedReason: PayoutBlockReason | null;
}

/**
 * Crée un reversement si la politique le permet. Le solde est réservé immédiatement
 * dans le grand livre (vendeur -> « reversements en cours ») : il ne peut pas partir deux fois.
 * Le profil vendeur est verrouillé pour sérialiser les reversements d'un même vendeur.
 */
export async function schedulePayout(
  ctx: AppContext,
  tx: Tx,
  sellerId: string,
  options: { orderId?: string | null; maxAmount?: number } = {},
): Promise<ScheduledPayout> {
  const now = ctx.clock.now();
  const { rows } = await tx.query<SellerPayoutProfile>(
    `SELECT id, user_id, verification_status, verified_at, payout_msisdn, payout_operator,
            payout_msisdn_changed_at, payout_cap_override
     FROM seller_profiles WHERE id = $1 FOR UPDATE`,
    [sellerId],
  );
  const seller = rows[0];
  if (!seller) throw notFound('Vendeur');

  const available = await accountBalance(tx, sellerPayableAccount(sellerId));
  const windowStart = addHours(now, -ctx.config.payoutPolicy.capWindowHours);
  const { rows: window } = await tx.query<{ total: number }>(
    `SELECT coalesce(sum(amount), 0)::bigint AS total FROM payouts
     WHERE seller_id = $1 AND status <> 'failed' AND created_at > $2`,
    [sellerId, windowStart],
  );

  const eligibility = payableAmount(
    {
      verificationStatus: seller.verification_status,
      verifiedAt: seller.verified_at,
      payoutNumberChangedAt: seller.payout_msisdn_changed_at,
      availableBalance: available,
      paidOutInWindow: window[0]!.total,
      capOverride: seller.payout_cap_override,
      now,
    },
    ctx.config.payoutPolicy,
  );
  const amount = Math.min(eligibility.amount, options.maxAmount ?? Number.MAX_SAFE_INTEGER);
  if (amount <= 0)
    return { payoutId: null, amount: 0, blockedReason: eligibility.blockedReason ?? 'no_balance' };

  const { rows: created } = await tx.query<{ id: string }>(
    `INSERT INTO payouts (seller_id, order_id, amount, provider, operator, msisdn, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
    [
      sellerId,
      options.orderId ?? null,
      amount,
      ctx.providers.defaultCode,
      seller.payout_operator,
      seller.payout_msisdn,
      now,
    ],
  );
  const payoutId = created[0]!.id;
  await postJournal(tx, reservePayout({ payoutId, sellerId, amount }), ctx.clock.now());
  return { payoutId, amount, blockedReason: null };
}

interface PayoutRow extends DisbursementRow {
  seller_id: string;
  seller_user_id: string;
  msisdn: string;
  operator: MobileOperator;
}

export const payoutSpec: DisbursementSpec<PayoutRow> = {
  table: 'payouts',
  kind: 'payout',
  async lock(tx, id) {
    const { rows } = await tx.query<PayoutRow>(
      `SELECT p.id, p.amount, p.status, p.attempts, p.provider, p.provider_ref, p.seller_id,
              s.user_id AS seller_user_id, p.msisdn, p.operator
       FROM payouts p JOIN seller_profiles s ON s.id = p.seller_id
       WHERE p.id = $1 FOR UPDATE OF p`,
      [id],
    );
    return rows[0] ?? null;
  },
  send: (provider, row) =>
    provider.initiatePayout({
      reference: row.id,
      amount: row.amount,
      currency: 'XAF',
      msisdn: row.msisdn,
      operator: row.operator,
      description: 'Reversement Zandu',
    }),
  async onSucceeded(ctx, tx, row) {
    await postJournal(
      tx,
      settlePayout({ payoutId: row.id, provider: row.provider, amount: row.amount }),
      ctx.clock.now(),
    );
    await publish(
      tx,
      'payout.succeeded',
      { type: 'payout', id: row.id },
      { userId: row.seller_user_id, amount: row.amount },
      ctx.clock.now(),
    );
  },
  async onFinalFailure(ctx, tx, row, reason) {
    // Le montant revient sur le solde du vendeur ; un agent reprend la main.
    await postJournal(
      tx,
      reversePayout({ payoutId: row.id, sellerId: row.seller_id, amount: row.amount }),
      ctx.clock.now(),
    );
    await publish(
      tx,
      'alert.support',
      { type: 'payout', id: row.id },
      {
        message: `Reversement ${row.id} de ${formatXaf(row.amount)} en échec définitif : ${reason}`,
      },
      ctx.clock.now(),
    );
  },
};

export const processPayouts = (ctx: AppContext): Promise<number> =>
  processDisbursements(ctx, payoutSpec);

/**
 * Reverse les soldes accumulés quand un vendeur devient éligible (vérification KYC
 * terminée, fin du gel après changement de numéro, plafond renouvelé).
 */
export async function sweepSellerBalances(ctx: AppContext): Promise<number> {
  const { rows } = await ctx.pool.query<{ seller_id: string }>(
    `SELECT a.seller_id FROM ledger_accounts a
     JOIN ledger_entries e ON e.account_id = a.id
     JOIN seller_profiles s ON s.id = a.seller_id AND s.verification_status = 'verified'
     WHERE NOT EXISTS (SELECT 1 FROM payouts p WHERE p.seller_id = a.seller_id AND p.status IN ('pending', 'processing'))
     GROUP BY a.seller_id HAVING -sum(e.amount) > 0
     LIMIT 100`,
  );
  let scheduled = 0;
  for (const { seller_id } of rows) {
    const result = await withTx(ctx.pool, (tx) => schedulePayout(ctx, tx, seller_id));
    if (result.payoutId) scheduled++;
  }
  return scheduled;
}
