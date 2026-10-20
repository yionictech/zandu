import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../../context.js';
import { currentUser, requireAuth } from '../auth/guards.js';
import { INBOX, INBOX_HIDDEN, pushBody, render } from './templates.js';

/**
 * Centre de notifications de l'application (maquettes acheteur) : les 50 derniers messages du
 * compte, une seule fois chacun même s'il est parti par plusieurs canaux (notification, puis
 * WhatsApp ou SMS en secours). « Tout lire » retient la date de la dernière lecture.
 */
export function inboxRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));

    app.get('/v1/me/notifications', async (request) => {
      const user = currentUser(request);
      const { rows } = await ctx.pool.query<{
        id: string;
        template: string;
        variables: Record<string, string>;
        data: { url?: string };
        created_at: Date;
        seen_at: Date | null;
      }>(
        `SELECT m.*, u.notifications_seen_at AS seen_at FROM (
           SELECT DISTINCT ON (coalesce(n.outbox_id::text, n.id::text), n.template)
                  n.id, n.template, n.variables, n.data, n.created_at
           FROM notifications n
           WHERE n.user_id = $1 AND NOT (n.template = ANY($2))
           ORDER BY coalesce(n.outbox_id::text, n.id::text), n.template, n.created_at
         ) m JOIN users u ON u.id = $1
         ORDER BY m.created_at DESC LIMIT 50`,
        [user.id, INBOX_HIDDEN],
      );
      const items = rows.map((r) => {
        const entry = INBOX[r.template];
        return {
          id: r.id,
          template: r.template,
          title: entry?.title ?? 'Zandu',
          body: entry?.body ?? pushBody(render(r.template, r.variables)),
          url: r.data?.url ?? null,
          createdAt: r.created_at,
          unread: !r.seen_at || r.created_at > r.seen_at,
        };
      });
      return { items, unread: items.filter((i) => i.unread).length };
    });

    /** « Tout lire » : le badge de la cloche disparaît. */
    app.post('/v1/me/notifications/seen', async (request, reply) => {
      await ctx.pool.query('UPDATE users SET notifications_seen_at = $2 WHERE id = $1', [
        currentUser(request).id,
        ctx.clock.now(),
      ]);
      return reply.status(204).send();
    });
  };
}
