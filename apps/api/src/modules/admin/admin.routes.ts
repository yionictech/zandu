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
        if (body.decision !== 'suspended') {
          await tx.query(
            `UPDATE kyc_documents SET status = $2::kyc_document_status, reviewed_by = $3, reviewed_at = $4,
                    rejection_reason = $5
             WHERE seller_id = $1 AND status = 'pending'`,
            [
              id,
              body.decision === 'verified' ? 'accepted' : 'rejected',
              a.userId,
              ctx.clock.now(),
              body.reason ?? null,
            ],
          );
        }
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

    /** File de vérification des vendeurs (dossiers complets en attente). */
    app.get('/v1/admin/sellers', async (request) => {
      const { status } = z
        .object({
          status: z
            .enum(['unverified', 'pending_review', 'verified', 'rejected', 'suspended'])
            .default('pending_review'),
        })
        .parse(request.query);
      const { rows } = await ctx.pool.query(
        `SELECT s.id, s.shop_name AS "shopName", s.kind, s.city, s.verification_status AS "verificationStatus",
                s.created_at AS "createdAt", u.phone,
                (SELECT count(*)::int FROM kyc_documents k WHERE k.seller_id = s.id AND k.status = 'pending') AS "pendingDocuments"
         FROM seller_profiles s JOIN users u ON u.id = s.user_id
         WHERE s.verification_status = $1::seller_verification_status
         ORDER BY s.updated_at LIMIT 200`,
        [status],
      );
      return { items: rows };
    });

    /** Pièces d'un vendeur : URL signées de 5 min, chaque consultation est journalisée. */
    app.get('/v1/admin/sellers/:id/kyc-documents', async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const { rows } = await ctx.pool.query<{
        id: string;
        type: string;
        status: string;
        storage_key: string;
        created_at: Date;
      }>(
        'SELECT id, type, status, storage_key, created_at FROM kyc_documents WHERE seller_id = $1 ORDER BY created_at',
        [id],
      );
      await audit(ctx.pool, staffActor(request), 'seller.kyc_viewed', { type: 'seller', id });
      return {
        items: await Promise.all(
          rows.map(async (d) => ({
            id: d.id,
            type: d.type,
            status: d.status,
            createdAt: d.created_at,
            url: await ctx.storage.presignDownload({
              bucket: 'private',
              key: d.storage_key,
              expiresInSeconds: 300,
            }),
          })),
        ),
      };
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
