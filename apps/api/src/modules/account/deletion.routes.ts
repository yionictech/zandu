import { randomUUID } from 'node:crypto';
import { sellerPayableAccount } from '@zandu/domain';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { withTx, type Db } from '../../db/pool.js';
import { addSeconds } from '../../lib/clock.js';
import { hmac, randomDigits, safeEqualHex } from '../../lib/crypto.js';
import { HttpError } from '../../lib/errors.js';
import { audit } from '../admin/audit.js';
import { actor, currentUser, requireAuth } from '../auth/guards.js';
import { accountBalance, sellerEscrowBalance } from '../ledger/ledger.repository.js';
import { render } from '../notifications/templates.js';

/**
 * Suppression de compte (Google Play, App Store ; docs/exploitation/publication-stores.md) :
 * demandée dans l'application ou sur le site, confirmée par un code SMS. Le compte est fermé et
 * ses données personnelles effacées (nom, téléphone, adresses de livraison, appareils, sessions) ;
 * les commandes, écritures comptables et reversements restent, anonymes, comme la loi l'impose.
 *
 * Impossible tant que de l'argent ou un colis est en jeu : le support règle d'abord la situation.
 */
export type DeletionBlocker =
  | 'orders_in_progress'
  | 'shop_orders_in_progress'
  | 'seller_balance'
  | 'payout_pending'
  | 'rider_account'
  | 'staff_account';

const IN_PROGRESS = [
  'pending_payment',
  'paid',
  'preparing',
  'ready_for_pickup',
  'in_delivery',
  'awaiting_collection',
  'delivered',
  'disputed',
];

const MESSAGES: Record<DeletionBlocker, string> = {
  orders_in_progress: 'Une de vos commandes est encore en cours ou en litige.',
  shop_orders_in_progress: 'Votre boutique a des commandes en cours.',
  seller_balance: 'Votre boutique a de l’argent en attente de reversement.',
  payout_pending: 'Un reversement vers votre compte Mobile Money est en cours.',
  rider_account: 'Les comptes livreurs sont fermés par votre société de livraison avec le support.',
  staff_account: 'Les comptes du personnel sont fermés par un administrateur.',
};

const codeHash = (ctx: AppContext, id: string, code: string) =>
  hmac(ctx.config.appSecret, `account_deletion:${id}:${code}`);

export async function deletionBlockers(db: Db, userId: string): Promise<DeletionBlocker[]> {
  const blockers: DeletionBlocker[] = [];
  const { rows: users } = await db.query<{ roles: string[] }>(
    'SELECT roles::text[] AS roles FROM users WHERE id = $1',
    [userId],
  );
  const roles = users[0]?.roles ?? [];
  if (roles.includes('support') || roles.includes('admin')) blockers.push('staff_account');
  if (roles.includes('rider')) blockers.push('rider_account');
  const { rowCount: buying } = await db.query(
    'SELECT 1 FROM orders WHERE buyer_id = $1 AND status = ANY($2::order_status[]) LIMIT 1',
    [userId, IN_PROGRESS.filter((s) => s !== 'pending_payment')],
  );
  if (buying) blockers.push('orders_in_progress');
  const { rows: shops } = await db.query<{ id: string }>(
    'SELECT id FROM seller_profiles WHERE user_id = $1',
    [userId],
  );
  const shop = shops[0];
  if (shop) {
    const { rowCount: selling } = await db.query(
      'SELECT 1 FROM orders WHERE seller_id = $1 AND status = ANY($2::order_status[]) LIMIT 1',
      [shop.id, IN_PROGRESS.filter((s) => s !== 'pending_payment')],
    );
    if (selling) blockers.push('shop_orders_in_progress');
    const owed =
      (await accountBalance(db, sellerPayableAccount(shop.id))) +
      (await sellerEscrowBalance(db, shop.id));
    if (owed > 0) blockers.push('seller_balance');
    const { rowCount: paying } = await db.query(
      `SELECT 1 FROM payouts WHERE seller_id = $1
       AND status IN ('awaiting_review', 'pending', 'processing') LIMIT 1`,
      [shop.id],
    );
    if (paying) blockers.push('payout_pending');
  }
  return blockers;
}

export function accountDeletionRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const now = () => ctx.clock.now();

    /** Ce qui empêche encore la suppression (vide : le compte peut être supprimé). */
    app.get('/v1/me/deletion', async (request) => {
      const blockers = await deletionBlockers(ctx.pool, currentUser(request).id);
      return {
        possible: blockers.length === 0,
        blockers: blockers.map((code) => ({ code, message: MESSAGES[code] })),
      };
    });

    /** Demander la suppression : un code de confirmation part par SMS. */
    app.post('/v1/me/deletion', async (request, reply) => {
      const user = currentUser(request);
      const blockers = await deletionBlockers(ctx.pool, user.id);
      if (blockers.length)
        throw new HttpError(409, 'deletion_blocked', MESSAGES[blockers[0]!], { blockers });
      const { rows } = await ctx.pool.query<{ last: Date | null }>(
        `SELECT max(created_at) AS last FROM otp_challenges WHERE phone = $1 AND purpose = 'account_deletion'`,
        [user.phone],
      );
      const last = rows[0]?.last;
      if (last && now().getTime() - last.getTime() < ctx.config.auth.otpResendSeconds * 1000)
        throw new HttpError(429, 'otp_resend_too_soon', 'Patientez avant de demander un code');
      const id = randomUUID();
      const code = randomDigits(6);
      await ctx.pool.query(
        `INSERT INTO otp_challenges (id, phone, purpose, code_hash, expires_at, requested_ip, created_at)
         VALUES ($1, $2, 'account_deletion', $3, $4, $5::inet, $6)`,
        [
          id,
          user.phone,
          codeHash(ctx, id, code),
          addSeconds(now(), ctx.config.auth.otpTtlSeconds),
          request.ip,
          now(),
        ],
      );
      await ctx.notifier.send({
        channel: 'sms',
        recipient: user.phone,
        template: 'account_deletion_code',
        variables: { code },
        text: render('account_deletion_code', { code }),
      });
      return reply
        .status(202)
        .send({ challengeId: id, expiresInSeconds: ctx.config.auth.otpTtlSeconds });
    });

    /** Confirmer avec le code : le compte est fermé et anonymisé, toutes les sessions sont closes. */
    app.post('/v1/me/deletion/confirm', async (request, reply) => {
      const body = z
        .object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) })
        .parse(request.body);
      const user = currentUser(request);
      const outcome = await withTx(ctx.pool, async (tx) => {
        const { rows } = await tx.query<{
          code_hash: string;
          attempts: number;
          expires_at: Date;
          consumed_at: Date | null;
        }>(
          `SELECT code_hash, attempts, expires_at, consumed_at FROM otp_challenges
           WHERE id = $1 AND phone = $2 AND purpose = 'account_deletion' FOR UPDATE`,
          [body.challengeId, user.phone],
        );
        const challenge = rows[0];
        if (!challenge || challenge.consumed_at || challenge.expires_at <= now()) return 'invalid';
        if (challenge.attempts >= ctx.config.auth.otpMaxAttempts) return 'locked';
        if (!safeEqualHex(challenge.code_hash, codeHash(ctx, body.challengeId, body.code))) {
          await tx.query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1', [
            body.challengeId,
          ]);
          return 'invalid';
        }
        await tx.query('UPDATE otp_challenges SET consumed_at = $2 WHERE id = $1', [
          body.challengeId,
          now(),
        ]);
        const blockers = await deletionBlockers(tx, user.id);
        if (blockers.length)
          throw new HttpError(409, 'deletion_blocked', MESSAGES[blockers[0]!], { blockers });
        await anonymize(tx, user.id, user.phone, now());
        await audit(
          tx,
          actor(request, 'buyer'),
          'account.deleted',
          { type: 'user', id: user.id },
          {},
        );
        return 'deleted';
      });
      if (outcome === 'locked')
        throw new HttpError(423, 'otp_locked', 'Trop de codes erronés : redemandez un code');
      if (outcome === 'invalid')
        throw new HttpError(422, 'otp_invalid', 'Code incorrect ou expiré');
      return reply.status(204).send();
    });
  };
}

/**
 * Efface les données personnelles d'un compte. Le numéro est remplacé par un numéro fictif hors
 * plan de numérotation (+999…) : le vrai numéro redevient libre pour un nouveau compte.
 */
async function anonymize(db: Db, userId: string, phone: string, at: Date): Promise<void> {
  const tombstone = `+999${randomDigits(11)}`;
  await db.query(
    `UPDATE users SET phone = $2, full_name = NULL, roles = '{buyer}', status = 'closed', deleted_at = $3
     WHERE id = $1`,
    [userId, tombstone, at],
  );
  await db.query('UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [
    userId,
    at,
  ]);
  await db.query('DELETE FROM push_devices WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM otp_challenges WHERE phone = $1', [phone]);
  // Adresses de livraison : le nom, le téléphone, le repère et la position ne servent plus.
  await db.query(
    `UPDATE orders SET shipping_address = jsonb_build_object(
       'recipientName', 'Compte supprimé', 'phone', '', 'landmark', '')
     WHERE buyer_id = $1`,
    [userId],
  );
  // Boutique : fermée, produits retirés de la vente ; l'historique comptable reste.
  await db.query(
    `UPDATE seller_profiles SET is_open = false, payout_account_name = NULL WHERE user_id = $1`,
    [userId],
  );
  await db.query(
    `UPDATE products SET status = 'archived'
     WHERE seller_id IN (SELECT id FROM seller_profiles WHERE user_id = $1) AND status <> 'archived'`,
    [userId],
  );
}
