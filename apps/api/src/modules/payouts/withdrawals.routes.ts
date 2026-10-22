import { randomUUID } from 'node:crypto';
import { formatXaf, reversePayout } from '@zandu/domain';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { withTx } from '../../db/pool.js';
import { addSeconds } from '../../lib/clock.js';
import { hmac, randomDigits, safeEqualHex } from '../../lib/crypto.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { audit } from '../admin/audit.js';
import {
  actor,
  currentUser,
  requireAuth,
  requireRole,
  requireStaff,
  staffActor,
} from '../auth/guards.js';
import { postJournal } from '../ledger/ledger.repository.js';
import { publish } from '../notifications/outbox.js';
import { render } from '../notifications/templates.js';
import { payoutSettings } from '../settings/settings.js';
import { payoutEligibility, schedulePayout } from './payouts.service.js';

const IdParam = z.object({ id: z.uuid() });
/** Plus petit retrait : en dessous, les frais de l'agrégateur ne valent pas l'envoi. */
export const MIN_WITHDRAWAL = 1_000;

const codeHash = (ctx: AppContext, challengeId: string, code: string): string =>
  hmac(ctx.config.appSecret, `withdrawal:${challengeId}:${code}`);

async function sellerOf(ctx: AppContext, userId: string | null) {
  const { rows } = await ctx.pool.query<{ id: string }>(
    'SELECT id FROM seller_profiles WHERE user_id = $1',
    [userId],
  );
  if (!rows[0]) throw new HttpError(403, 'no_shop', "Vous n'avez pas de boutique");
  return rows[0].id;
}

/**
 * Retrait à la demande (docs/ux/03 §4.3, §14), actif seulement quand le back-office l'a choisi :
 * le vendeur demande un montant, confirme avec un code SMS, l'argent part vers son compte Mobile
 * Money. Au-delà du seuil, le retrait attend le contrôle d'un administrateur.
 */
export function withdrawalRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const now = () => ctx.clock.now();

    app.register(async (seller) => {
      seller.addHook('preHandler', requireRole('seller'));

      /** Ce qui peut être retiré maintenant, et pourquoi pas plus. */
      seller.get('/v1/seller/withdrawals', async (request) => {
        const sellerId = await sellerOf(ctx, currentUser(request).id);
        const settings = await payoutSettings(ctx.pool);
        const { eligibility } = await withTx(ctx.pool, (tx) =>
          payoutEligibility(ctx, tx, sellerId),
        );
        const { rows } = await ctx.pool.query(
          `SELECT id, amount, status, created_at AS "createdAt", review_note AS "reviewNote"
           FROM payouts WHERE seller_id = $1 AND kind = 'withdrawal'
           ORDER BY created_at DESC LIMIT 20`,
          [sellerId],
        );
        return {
          mode: settings.mode,
          withdrawable: eligibility.amount,
          blockedReason: eligibility.blockedReason,
          minimum: MIN_WITHDRAWAL,
          reviewAbove: settings.reviewAmount,
          items: rows,
        };
      });

      /** Demander un retrait : un code de confirmation part par SMS au numéro du vendeur. */
      seller.post('/v1/seller/withdrawals', async (request, reply) => {
        const { amount } = z
          .object({ amount: z.int().min(MIN_WITHDRAWAL).max(100_000_000) })
          .parse(request.body);
        const user = currentUser(request);
        const sellerId = await sellerOf(ctx, user.id);
        if ((await payoutSettings(ctx.pool)).mode !== 'on_demand')
          throw new HttpError(
            409,
            'withdrawals_disabled',
            'Votre argent vous est reversé automatiquement',
          );
        const code = randomDigits(6);
        const challengeId = await withTx(ctx.pool, async (tx) => {
          const { eligibility } = await payoutEligibility(ctx, tx, sellerId);
          if (amount > eligibility.amount)
            throw new HttpError(409, 'amount_unavailable', 'Montant supérieur au disponible', {
              withdrawable: eligibility.amount,
              blockedReason: eligibility.blockedReason,
            });
          const { rows } = await tx.query<{ last: Date | null }>(
            `SELECT max(created_at) AS last FROM otp_challenges
             WHERE phone = $1 AND purpose = 'withdrawal'`,
            [user.phone],
          );
          const last = rows[0]?.last;
          if (last && now().getTime() - last.getTime() < ctx.config.auth.otpResendSeconds * 1000)
            throw new HttpError(429, 'otp_resend_too_soon', 'Patientez avant de demander un code');
          const id = randomUUID();
          await tx.query(
            `INSERT INTO otp_challenges (id, phone, purpose, code_hash, expires_at, requested_ip, created_at, context)
             VALUES ($1, $2, 'withdrawal', $3, $4, $5::inet, $6, $7)`,
            [
              id,
              user.phone,
              codeHash(ctx, id, code),
              addSeconds(now(), ctx.config.auth.otpTtlSeconds),
              request.ip,
              now(),
              JSON.stringify({ sellerId, amount }),
            ],
          );
          return id;
        });
        const variables = { code, amount: formatXaf(amount) };
        await ctx.notifier.send({
          channel: 'sms',
          recipient: user.phone,
          template: 'withdrawal_code',
          variables,
          text: render('withdrawal_code', variables),
        });
        return reply
          .status(202)
          .send({ challengeId, expiresInSeconds: ctx.config.auth.otpTtlSeconds });
      });

      /** Confirmer avec le code : le retrait part, ou attend le contrôle au-delà du seuil. */
      seller.post('/v1/seller/withdrawals/confirm', async (request, reply) => {
        const body = z
          .object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) })
          .parse(request.body);
        const user = currentUser(request);
        const sellerId = await sellerOf(ctx, user.id);
        const settings = await payoutSettings(ctx.pool);
        if (settings.mode !== 'on_demand')
          throw new HttpError(409, 'withdrawals_disabled', 'Retrait à la demande désactivé');
        const result = await withTx(ctx.pool, async (tx) => {
          const { rows } = await tx.query<{
            code_hash: string;
            attempts: number;
            expires_at: Date;
            consumed_at: Date | null;
            context: { sellerId: string; amount: number } | null;
          }>(
            `SELECT code_hash, attempts, expires_at, consumed_at, context FROM otp_challenges
             WHERE id = $1 AND phone = $2 AND purpose = 'withdrawal' FOR UPDATE`,
            [body.challengeId, user.phone],
          );
          const challenge = rows[0];
          if (!challenge || challenge.consumed_at || challenge.expires_at <= now())
            return { error: 'otp_invalid' as const };
          if (challenge.attempts >= ctx.config.auth.otpMaxAttempts)
            return { error: 'otp_locked' as const };
          if (!safeEqualHex(challenge.code_hash, codeHash(ctx, body.challengeId, body.code))) {
            await tx.query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1', [
              body.challengeId,
            ]);
            return { error: 'otp_invalid' as const };
          }
          await tx.query('UPDATE otp_challenges SET consumed_at = $2 WHERE id = $1', [
            body.challengeId,
            now(),
          ]);
          const amount = challenge.context?.amount ?? 0;
          if (challenge.context?.sellerId !== sellerId) return { error: 'otp_invalid' as const };
          const review = amount > settings.reviewAmount;
          const payout = await schedulePayout(ctx, tx, sellerId, {
            maxAmount: amount,
            kind: 'withdrawal',
            review,
          });
          // Le disponible a baissé entre la demande et la confirmation : on ne part pas à moitié.
          if (payout.amount < amount)
            throw new HttpError(409, 'amount_unavailable', 'Montant supérieur au disponible', {
              withdrawable: payout.amount,
            });
          await audit(
            tx,
            actor(request, 'seller'),
            'payout.withdrawal_requested',
            { type: 'payout', id: payout.payoutId! },
            { amount, review },
          );
          if (review)
            await publish(
              tx,
              'alert.support',
              { type: 'payout', id: payout.payoutId! },
              { message: `Retrait de ${formatXaf(amount)} à contrôler` },
              now(),
            );
          return {
            payoutId: payout.payoutId!,
            amount,
            status: review ? ('awaiting_review' as const) : ('pending' as const),
          };
        });
        if ('error' in result)
          throw result.error === 'otp_locked'
            ? new HttpError(423, 'otp_locked', 'Trop de codes erronés : redemandez un retrait')
            : new HttpError(422, 'otp_invalid', 'Code incorrect ou expiré');
        return reply.status(201).send(result);
      });
    });

    // ---------------- Back-office : retraits à contrôler ----------------
    app.register(async (staff) => {
      staff.addHook('preHandler', requireStaff(ctx));
      const isAdmin = (request: Parameters<typeof currentUser>[0]) =>
        currentUser(request).roles.includes('admin');

      staff.get('/v1/support/withdrawals', async () => {
        const { rows } = await ctx.pool.query(
          `SELECT p.id, p.amount, p.status, p.created_at AS "createdAt", p.operator, p.msisdn AS phone,
                  s.id AS "sellerId", s.shop_name AS "shopName", s.payout_account_name AS "accountName",
                  s.verification_status AS "verificationStatus"
           FROM payouts p JOIN seller_profiles s ON s.id = p.seller_id
           WHERE p.status = 'awaiting_review' ORDER BY p.created_at`,
        );
        return { items: rows };
      });

      /** Contrôle d'un retrait (administrateurs) : il part, ou le montant revient au vendeur. */
      staff.post('/v1/support/withdrawals/:id/decision', async (request) => {
        if (!isAdmin(request)) throw new HttpError(403, 'forbidden', 'Réservé aux administrateurs');
        const { id } = IdParam.parse(request.params);
        const body = z
          .object({
            decision: z.enum(['approve', 'reject']),
            note: z.string().trim().min(3).max(300),
          })
          .parse(request.body);
        const a = staffActor(request);
        const status = await withTx(ctx.pool, async (tx) => {
          const { rows } = await tx.query<{
            id: string;
            seller_id: string;
            amount: number;
            status: string;
            user_id: string;
          }>(
            `SELECT p.id, p.seller_id, p.amount, p.status, s.user_id
             FROM payouts p JOIN seller_profiles s ON s.id = p.seller_id
             WHERE p.id = $1 FOR UPDATE OF p`,
            [id],
          );
          const p = rows[0];
          if (!p) throw notFound('Retrait');
          if (p.status !== 'awaiting_review')
            throw new HttpError(409, 'not_awaiting_review', 'Ce retrait a déjà été traité');
          const next = body.decision === 'approve' ? 'pending' : 'failed';
          await tx.query(
            `UPDATE payouts SET status = $2, reviewed_by = $3, reviewed_at = $4, review_note = $5,
                                next_attempt_at = $4, last_error = $6
             WHERE id = $1`,
            [id, next, a.userId, now(), body.note, next === 'failed' ? body.note : null],
          );
          if (body.decision === 'reject') {
            // L'argent réservé revient sur le solde du vendeur.
            await postJournal(
              tx,
              reversePayout({ payoutId: id, sellerId: p.seller_id, amount: p.amount }),
              now(),
            );
            await publish(
              tx,
              'payout.rejected',
              { type: 'payout', id },
              { userId: p.user_id, amount: p.amount, reason: body.note },
              now(),
            );
          }
          await audit(
            tx,
            a,
            body.decision === 'approve'
              ? 'payout.withdrawal_approved'
              : 'payout.withdrawal_rejected',
            { type: 'payout', id },
            { amount: p.amount, note: body.note },
          );
          return next;
        });
        return { id, status };
      });
    });
  };
}
