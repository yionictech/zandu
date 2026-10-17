import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { withTx } from '../../db/pool.js';
import { HttpError } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../auth/guards.js';
import type { Bucket, MemoryStorage } from '../storage/storage.js';
import { reserveUpload } from './uploads.service.js';

export function uploadRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));

    /**
     * Étape 1 d'un envoi : l'application annonce le type et la taille, reçoit une URL signée,
     * envoie le fichier directement au stockage, puis rattache `uploadId` (photo, KYC, litige).
     */
    app.post('/v1/uploads', async (request, reply) => {
      const body = z
        .object({
          purpose: z.enum(['product_photo', 'kyc_document', 'dispute_evidence']),
          contentType: z.string().max(100),
          sizeBytes: z.int().positive(),
        })
        .parse(request.body);
      const user = currentUser(request);
      if (body.purpose !== 'dispute_evidence' && !user.roles.includes('seller')) {
        throw new HttpError(403, 'no_shop', "Ouvrez d'abord votre boutique");
      }
      const reserved = await withTx(ctx.pool, (tx) =>
        reserveUpload(ctx, tx, { userId: user.id, ...body }),
      );
      return reply.status(201).send(reserved);
    });
  };
}

/**
 * Développement sans S3 : reçoit les fichiers (PUT) et les sert. Jamais en production.
 * Le contrôle d'accès repose sur l'imprévisibilité des clés (UUID), comme une URL signée.
 */
export function devStorageRoutes(storage: MemoryStorage): FastifyPluginAsync {
  return async (app) => {
    app.addContentTypeParser(
      ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
      { parseAs: 'buffer', bodyLimit: 6 * 1024 * 1024 },
      (_request, body, done) => done(null, body),
    );
    const Params = z.object({
      bucket: z.enum(['public', 'private']),
      '*': z.string().min(1).max(300),
    });

    app.put('/dev/storage/:bucket/*', async (request, reply) => {
      const params = Params.parse(request.params);
      const contentType = request.headers['content-type'] ?? 'application/octet-stream';
      storage.put(params.bucket as Bucket, params['*'], request.body as Buffer, contentType);
      return reply.status(200).send();
    });

    app.get('/dev/storage/:bucket/*', async (request, reply) => {
      const params = Params.parse(request.params);
      const object = storage.get(params.bucket as Bucket, params['*']);
      if (!object) return reply.status(404).send();
      return reply
        .type(object.contentType)
        .header('cache-control', 'public, max-age=3600')
        .send(object.body);
    });
  };
}
