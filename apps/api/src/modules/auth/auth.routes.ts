import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { requestOtp, revokeSession, verifyOtp } from './auth.service.js';
import { currentUser, requireAuth } from './guards.js';

export function authRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.post('/v1/auth/otp/request', async (request, reply) => {
      const body = z.object({ phone: z.string().min(8).max(20) }).parse(request.body);
      // Même réponse que le numéro ait un compte ou non : pas d'énumération des utilisateurs.
      return reply.status(202).send(await requestOtp(ctx, body.phone, request.ip));
    });

    app.post('/v1/auth/otp/verify', async (request) => {
      const body = z
        .object({
          challengeId: z.uuid(),
          code: z.string().regex(/^\d{6}$/),
          deviceLabel: z.string().max(80).optional(),
        })
        .parse(request.body);
      return verifyOtp(ctx, body.challengeId, body.code, {
        ip: request.ip,
        deviceLabel: body.deviceLabel,
      });
    });

    app.get('/v1/me', { preHandler: requireAuth(ctx) }, async (request) => {
      const { sessionId: _sessionId, ...user } = currentUser(request);
      return user;
    });

    app.post('/v1/auth/logout', { preHandler: requireAuth(ctx) }, async (request, reply) => {
      await revokeSession(ctx, currentUser(request).sessionId);
      return reply.status(204).send();
    });
  };
}
