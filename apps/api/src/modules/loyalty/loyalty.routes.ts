import { LOYALTY, maxRedeemable } from '@zandu/domain';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { withTx } from '../../db/pool.js';
import { addHours } from '../../lib/clock.js';
import { HttpError } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../auth/guards.js';
import { pointsBalance, referralCode } from './loyalty.service.js';

/** Un filleul a 30 jours après son inscription pour saisir le code de son parrain. */
const REFERRAL_WINDOW_HOURS = 30 * 24;

/** Points fidélité et parrainage de l'utilisateur connecté. */
export function loyaltyRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));

    /** Solde, code de parrainage, derniers mouvements et règles affichées dans l'application. */
    app.get('/v1/me/loyalty', async (request) => {
      const user = currentUser(request);
      const [points, code] = await Promise.all([
        pointsBalance(ctx.pool, user.id),
        referralCode(ctx.pool, user.id),
      ]);
      const { rows: me } = await ctx.pool.query<{
        referred_by: string | null;
        created_at: Date;
        orders: number;
        referrals: number;
      }>(
        `SELECT u.referred_by, u.created_at,
                (SELECT count(*)::int FROM orders o WHERE o.buyer_id = u.id AND o.paid_at IS NOT NULL) AS orders,
                (SELECT count(*)::int FROM users f WHERE f.referred_by = u.id) AS referrals
         FROM users u WHERE u.id = $1`,
        [user.id],
      );
      const u = me[0]!;
      const { rows: history } = await ctx.pool.query(
        `SELECT e.id::text AS id, e.points, e.kind, e.created_at AS "at",
                (SELECT o.public_ref FROM orders o WHERE o.id = e.order_id) AS "orderRef"
         FROM loyalty_entries e WHERE e.user_id = $1 ORDER BY e.id DESC LIMIT 30`,
        [user.id],
      );
      return {
        points,
        referralCode: code,
        referralCount: u.referrals,
        referredBy: u.referred_by !== null,
        canEnterCode:
          u.referred_by === null &&
          u.orders === 0 &&
          ctx.clock.now() < addHours(u.created_at, REFERRAL_WINDOW_HOURS),
        history,
        rules: {
          fcfaPerPoint: LOYALTY.fcfaPerPoint,
          referralBonus: LOYALTY.referralBonus,
          referralMinOrder: LOYALTY.referralMinOrder,
          minRedeem: LOYALTY.minRedeem,
          maxSharePercent: LOYALTY.maxSharePercent,
        },
      };
    });

    /** Plafond de points utilisables pour un panier (montant des articles). */
    app.get('/v1/me/loyalty/redeemable', async (request) => {
      const { itemsTotal } = z
        .object({ itemsTotal: z.coerce.number().int().min(0).max(1_000_000_000) })
        .parse(request.query);
      const points = await pointsBalance(ctx.pool, currentUser(request).id);
      const max = maxRedeemable(points, itemsTotal);
      return { points, max: max >= LOYALTY.minRedeem ? max : 0, minRedeem: LOYALTY.minRedeem };
    });

    /**
     * Filleul : saisir le code de son parrain, une fois, avant sa première commande et dans les
     * 30 jours après l'inscription. Le bonus arrive à la fin de sa première commande.
     */
    app.post('/v1/me/referral', async (request) => {
      const { code } = z
        .object({
          code: z
            .string()
            .trim()
            .toUpperCase()
            .regex(/^[A-Z0-9]{6,12}$/),
        })
        .parse(request.body);
      const user = currentUser(request);
      await withTx(ctx.pool, async (tx) => {
        const { rows } = await tx.query<{
          referred_by: string | null;
          created_at: Date;
          orders: number;
        }>(
          `SELECT u.referred_by, u.created_at,
                  (SELECT count(*)::int FROM orders o WHERE o.buyer_id = u.id AND o.paid_at IS NOT NULL) AS orders
           FROM users u WHERE u.id = $1 FOR UPDATE`,
          [user.id],
        );
        const me = rows[0]!;
        if (me.referred_by)
          throw new HttpError(
            409,
            'already_referred',
            'Vous avez déjà saisi un code de parrainage',
          );
        if (me.orders > 0 || ctx.clock.now() >= addHours(me.created_at, REFERRAL_WINDOW_HOURS))
          throw new HttpError(
            409,
            'referral_closed',
            'Le code de parrainage se saisit avant la première commande',
          );
        const { rows: sponsors } = await tx.query<{ id: string }>(
          `SELECT id FROM users WHERE referral_code = $1 AND status = 'active' AND deleted_at IS NULL`,
          [code],
        );
        const sponsor = sponsors[0];
        if (!sponsor) throw new HttpError(422, 'referral_unknown', 'Code de parrainage inconnu');
        if (sponsor.id === user.id)
          throw new HttpError(
            422,
            'referral_self',
            'Vous ne pouvez pas utiliser votre propre code',
          );
        await tx.query('UPDATE users SET referred_by = $2, referred_at = $3 WHERE id = $1', [
          user.id,
          sponsor.id,
          ctx.clock.now(),
        ]);
      });
      return { referred: true };
    });
  };
}
