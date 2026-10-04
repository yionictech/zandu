import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { withTx } from '../../db/pool.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { requireAuth, requireRole, staffActor } from '../auth/guards.js';
import { allBalances, trialBalance } from '../ledger/ledger.repository.js';
import { audit } from './audit.js';

/** Back-office (F16) : vérification des vendeurs, modération, contrôle du grand livre. */
export function adminRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    app.addHook('preHandler', requireRole('support', 'admin'));

    app.post('/v1/admin/sellers/:id/verification', async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const body = z
        .object({
          decision: z.enum(['verified', 'rejected', 'suspended']),
          reason: z.string().trim().max(500).optional(),
        })
        .parse(request.body);
      if (body.decision !== 'verified' && !body.reason)
        throw new HttpError(400, 'reason_required', 'Motif requis');
      const a = staffActor(request);
      await withTx(ctx.pool, async (tx) => {
        const { rowCount } = await tx.query(
          `UPDATE seller_profiles SET verification_status = $2::seller_verification_status, rejection_reason = $3,
                  verified_at = CASE WHEN $2::seller_verification_status = 'verified' THEN $4::timestamptz ELSE verified_at END
           WHERE id = $1`,
          [id, body.decision, body.reason ?? null, ctx.clock.now()],
        );
        if (!rowCount) throw notFound('Vendeur');
        await audit(
          tx,
          a,
          `seller.${body.decision}`,
          { type: 'seller', id },
          { reason: body.reason ?? null },
        );
      });
      return { id, verificationStatus: body.decision };
    });

    app.post('/v1/admin/products/:id/moderation', async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const body = z
        .object({
          decision: z.enum(['published', 'rejected']),
          reason: z.string().trim().max(500).optional(),
        })
        .parse(request.body);
      const a = staffActor(request);
      await withTx(ctx.pool, async (tx) => {
        const { rowCount } = await tx.query(
          `UPDATE products SET status = $2::product_status, rejection_reason = $3,
                  published_at = CASE WHEN $2::product_status = 'published' THEN coalesce(published_at, $4::timestamptz) ELSE published_at END
           WHERE id = $1 AND status IN ('pending_review', 'published', 'rejected')`,
          [id, body.decision, body.reason ?? null, ctx.clock.now()],
        );
        if (!rowCount) throw notFound('Produit');
        await audit(
          tx,
          a,
          `product.${body.decision}`,
          { type: 'product', id },
          { reason: body.reason ?? null },
        );
      });
      return { id, status: body.decision };
    });

    /** Contrôle comptable : la balance générale doit valoir 0, chaque compte est détaillé. */
    app.get('/v1/admin/ledger/balances', async () => ({
      trialBalance: await trialBalance(ctx.pool),
      accounts: await allBalances(ctx.pool),
    }));
  };
}
