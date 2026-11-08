import { earnedPoints, LOYALTY, restoreLoyalty } from '@zandu/domain';
import type { AppContext } from '../../context.js';
import type { Db, Tx } from '../../db/pool.js';
import { randomDigits } from '../../lib/crypto.js';
import { postJournal } from '../ledger/ledger.repository.js';
import { publish } from '../notifications/outbox.js';

/** Solde de points d'un utilisateur (somme des mouvements). */
export async function pointsBalance(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query<{ points: number }>(
    'SELECT coalesce(sum(points), 0)::int AS points FROM loyalty_entries WHERE user_id = $1',
    [userId],
  );
  return rows[0]!.points;
}

/**
 * Verrouille l'utilisateur pour un mouvement de points : deux paniers payés en même temps ne
 * peuvent pas dépenser deux fois les mêmes points.
 */
export async function lockPoints(tx: Tx, userId: string): Promise<number> {
  await tx.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
  return pointsBalance(tx, userId);
}

/** Code de parrainage : le prénom (lettres) et 3 chiffres, « PRISCA482 » ; créé à la demande. */
export async function referralCode(db: Db, userId: string): Promise<string> {
  const { rows } = await db.query<{ referral_code: string | null; full_name: string | null }>(
    'SELECT referral_code, full_name FROM users WHERE id = $1',
    [userId],
  );
  const user = rows[0]!;
  if (user.referral_code) return user.referral_code;
  const letters = (user.full_name ?? '')
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()
    .slice(0, 6);
  const base = letters.length >= 3 ? letters : 'ZANDU';
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = `${base}${randomDigits(attempt < 4 ? 3 : 5)}`;
    const updated = await db.query<{ referral_code: string }>(
      `UPDATE users SET referral_code = $2 WHERE id = $1 AND referral_code IS NULL
         AND NOT EXISTS (SELECT 1 FROM users WHERE referral_code = $2)
       RETURNING referral_code`,
      [userId, code],
    );
    if (updated.rows[0]) return updated.rows[0].referral_code;
    const again = await db.query<{ referral_code: string | null }>(
      'SELECT referral_code FROM users WHERE id = $1',
      [userId],
    );
    if (again.rows[0]?.referral_code) return again.rows[0].referral_code;
  }
  throw new Error('Code de parrainage introuvable');
}

/**
 * Fin d'une commande (séquestre libéré) : points sur l'argent payé et gardé, puis, si c'est la
 * première commande terminée d'un filleul (assez grosse), le bonus de parrainage des deux côtés.
 */
export async function rewardCompletedOrder(
  ctx: AppContext,
  tx: Tx,
  order: {
    id: string;
    buyer_id: string;
    total: number;
    refunded_amount: number;
    points_used: number;
  },
): Promise<void> {
  const now = ctx.clock.now();
  const cashKept = Math.max(0, order.total - order.points_used - order.refunded_amount);
  const points = earnedPoints(cashKept);
  if (points > 0) {
    const { rowCount } = await tx.query(
      `INSERT INTO loyalty_entries (user_id, points, kind, order_id, created_at)
       VALUES ($1, $2, 'earned', $3, $4) ON CONFLICT DO NOTHING`,
      [order.buyer_id, points, order.id, now],
    );
    if (rowCount)
      await publish(
        tx,
        'loyalty.earned',
        { type: 'user', id: order.buyer_id },
        { points, orderId: order.id },
        now,
      );
  }

  const { rows } = await tx.query<{ referred_by: string | null; completed: number }>(
    `SELECT u.referred_by,
            (SELECT count(*)::int FROM orders o WHERE o.buyer_id = u.id AND o.status = 'completed') AS completed
     FROM users u WHERE u.id = $1`,
    [order.buyer_id],
  );
  const referee = rows[0];
  if (!referee?.referred_by || referee.completed !== 1 || cashKept < LOYALTY.referralMinOrder)
    return;
  for (const [userId, related] of [
    [referee.referred_by, order.buyer_id],
    [order.buyer_id, referee.referred_by],
  ] as const) {
    const { rowCount } = await tx.query(
      `INSERT INTO loyalty_entries (user_id, points, kind, order_id, related_user_id, created_at)
       VALUES ($1, $2, 'referral_bonus', $3, $4, $5) ON CONFLICT DO NOTHING`,
      [userId, LOYALTY.referralBonus, order.id, related, now],
    );
    if (rowCount)
      await publish(
        tx,
        'loyalty.referral_bonus',
        { type: 'user', id: userId },
        { points: LOYALTY.referralBonus },
        now,
      );
  }
}

/**
 * Remboursement de la part payée en points : sortie du séquestre (charge annulée) et points
 * recrédités au client.
 */
export async function restorePoints(
  ctx: AppContext,
  tx: Tx,
  order: { id: string; buyer_id: string },
  points: number,
  key: string,
): Promise<void> {
  const { posted } = await postJournal(
    tx,
    restoreLoyalty({ key, orderId: order.id, points }),
    ctx.clock.now(),
  );
  if (!posted) return;
  await tx.query(
    `INSERT INTO loyalty_entries (user_id, points, kind, order_id, created_at)
     VALUES ($1, $2, 'restored', $3, $4)`,
    [order.buyer_id, points, order.id, ctx.clock.now()],
  );
}

/** Panier expiré sans paiement : les points mis de côté reviennent. */
export async function releaseCheckoutPoints(ctx: AppContext, tx: Tx, checkoutId: string) {
  await tx.query(
    `INSERT INTO loyalty_entries (user_id, points, kind, checkout_id, created_at)
     SELECT c.buyer_id, c.points_used, 'released', c.id, $2
     FROM checkouts c WHERE c.id = $1 AND c.points_used > 0
     ON CONFLICT DO NOTHING`,
    [checkoutId, ctx.clock.now()],
  );
}
