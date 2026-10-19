import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { notFound } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../auth/guards.js';
import { ackNotification } from './dispatcher.js';

/** Jeton Expo, tel que l'application le reçoit (`ExponentPushToken[…]`). */
const PushToken = z
  .string()
  .max(200)
  .regex(/^Expo(nent)?PushToken\[[\w-]+\]$/, 'Jeton de notification invalide');

/** Téléphones qui reçoivent les notifications de l'application (ADR-0018). */
export function deviceRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    /**
     * Enregistre le téléphone pour la session en cours. Un jeton déjà connu (téléphone passé
     * à un autre compte) change de propriétaire : il ne reçoit plus rien du compte précédent.
     */
    app.put('/v1/me/devices', { preHandler: requireAuth(ctx) }, async (request, reply) => {
      const body = z
        .object({ token: PushToken, platform: z.enum(['android', 'ios']) })
        .parse(request.body);
      const user = currentUser(request);
      const now = ctx.clock.now();
      await ctx.pool.query(
        `INSERT INTO push_devices (token, user_id, session_id, platform, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id,
           session_id = EXCLUDED.session_id, platform = EXCLUDED.platform,
           last_seen_at = EXCLUDED.last_seen_at, disabled_at = NULL,
           created_at = CASE WHEN push_devices.user_id = EXCLUDED.user_id
                             THEN push_devices.created_at ELSE EXCLUDED.created_at END`,
        [body.token, user.id, user.sessionId, body.platform, now],
      );
      return reply.status(204).send();
    });

    /**
     * Déconnexion : le téléphone ne reçoit plus rien. Sans session (déconnexion faite sans
     * réseau, puis renvoyée au retour) : posséder le jeton suffit, le pire est de couper ses
     * propres notifications.
     */
    app.post('/v1/devices/unregister', async (request, reply) => {
      const { token } = z.object({ token: PushToken }).parse(request.body);
      await ctx.pool.query('DELETE FROM push_devices WHERE token = $1', [token]);
      return reply.status(204).send();
    });

    /** Notification reçue application ouverte, ou touchée : elle ne sera pas doublée. */
    app.post(
      '/v1/me/notifications/:id/ack',
      { preHandler: requireAuth(ctx) },
      async (request, reply) => {
        const { id } = z.object({ id: z.uuid() }).parse(request.params);
        if (!(await ackNotification(ctx, currentUser(request).id, id)))
          throw notFound('Notification');
        return reply.status(204).send();
      },
    );
  };
}
