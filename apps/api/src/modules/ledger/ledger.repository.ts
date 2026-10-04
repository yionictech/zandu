import {
  PlatformAccounts,
  accountType,
  assertBalanced,
  naturalBalance,
  type Journal,
} from '@zandu/domain';
import type { Db, Tx } from '../../db/pool.js';

const PLATFORM_NAMES: Record<string, string> = {
  [PlatformAccounts.escrow]: 'Séquestre — fonds acheteurs bloqués',
  [PlatformAccounts.refundsInTransit]: 'Remboursements en cours',
  [PlatformAccounts.payoutsInTransit]: 'Reversements vendeurs en cours',
  [PlatformAccounts.suspense]: 'Attente — paiements tardifs ou non rapprochés',
  [PlatformAccounts.commissionRevenue]: 'Commissions sur ventes',
  [PlatformAccounts.deliveryRevenue]: 'Marge sur frais de livraison',
  [PlatformAccounts.paymentFees]: 'Frais Mobile Money / agrégateur',
};

/** Crée le compte à la première utilisation (comptes vendeurs, livreurs, agrégateurs). */
async function ensureAccount(tx: Tx, code: string): Promise<string> {
  const [, kind, ownerId] = code.split(':');
  const sellerId = kind === 'seller_payable' ? ownerId : null;
  const courierPartnerId = kind === 'courier_payable' ? ownerId : null;
  const { rows } = await tx.query<{ id: string }>(
    `WITH ins AS (
       INSERT INTO ledger_accounts (code, type, name, seller_id, courier_partner_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING RETURNING id)
     SELECT id FROM ins UNION ALL SELECT id FROM ledger_accounts WHERE code = $1 LIMIT 1`,
    [code, accountType(code), PLATFORM_NAMES[code] ?? code, sellerId, courierPartnerId],
  );
  return rows[0]!.id;
}

/**
 * Enregistre une écriture. Idempotent : si la clé métier existe déjà (webhook rejoué,
 * tâche relancée), rien n'est écrit et `posted` vaut false. L'équilibre est vérifié ici
 * ET par la base au COMMIT (trigger ledger_entries_balanced).
 */
export async function postJournal(
  tx: Tx,
  journal: Journal,
): Promise<{ posted: boolean; transactionId: string | null }> {
  assertBalanced(journal);
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO ledger_transactions (kind, idempotency_key, payment_id, order_id, payout_id, refund_id)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [
      journal.kind,
      journal.idempotencyKey,
      journal.refs.paymentId ?? null,
      journal.refs.orderId ?? null,
      journal.refs.payoutId ?? null,
      journal.refs.refundId ?? null,
    ],
  );
  const transactionId = rows[0]?.id;
  if (!transactionId) return { posted: false, transactionId: null };

  for (const line of journal.lines) {
    const accountId = await ensureAccount(tx, line.account);
    await tx.query(
      'INSERT INTO ledger_entries (transaction_id, account_id, amount, order_id) VALUES ($1, $2, $3, $4)',
      [transactionId, accountId, line.amount, line.orderId ?? null],
    );
  }
  return { posted: true, transactionId };
}

export async function accountBalance(db: Db, code: string): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    `SELECT coalesce(sum(e.amount), 0)::bigint AS total
     FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE a.code = $1`,
    [code],
  );
  return naturalBalance(code, rows[0]!.total);
}

/** Montant encore en séquestre pour les commandes d'un vendeur (« argent en route »). */
export async function sellerEscrowBalance(db: Db, sellerId: string): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    `SELECT coalesce(-sum(e.amount), 0)::bigint AS total
     FROM ledger_entries e
     JOIN ledger_accounts a ON a.id = e.account_id AND a.code = $2
     JOIN orders o ON o.id = e.order_id
     WHERE o.seller_id = $1`,
    [sellerId, PlatformAccounts.escrow],
  );
  return rows[0]!.total;
}

/** Balance générale : doit toujours valoir 0 (contrôle de recette et supervision). */
export async function trialBalance(db: Db): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    'SELECT coalesce(sum(amount), 0)::bigint AS total FROM ledger_entries',
  );
  return rows[0]!.total;
}

export async function allBalances(db: Db): Promise<Array<{ code: string; balance: number }>> {
  const { rows } = await db.query<{ code: string; total: number }>(
    `SELECT a.code, coalesce(sum(e.amount), 0)::bigint AS total
     FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
     GROUP BY a.code ORDER BY a.code`,
  );
  return rows.map((r) => ({ code: r.code, balance: naturalBalance(r.code, r.total) }));
}
