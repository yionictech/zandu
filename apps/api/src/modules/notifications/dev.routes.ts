import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/pool.js';
import { HttpError } from '../../lib/errors.js';
import type { DevNotificationSender } from './sender.js';

interface DevMessage {
  recipient: string;
  channel: string;
  template: string;
  variables: Record<string, string>;
  sentAt: string;
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Développement et recette : derniers SMS/WhatsApp « envoyés ». Réunit les messages directs de
 * l'API (codes de connexion, jamais enregistrés en base) et les notifications distribuées par le
 * worker (table `notifications`), qui tourne dans un autre processus.
 *
 * `recetteKey` : en recette, l'API est joignable par tous ; l'en-tête `x-recette-key` est exigé
 * et la lecture se fait numéro par numéro.
 */
export function devMessagesRoutes(
  sender: DevNotificationSender,
  db: Db,
  recetteKey: string | null = null,
): FastifyPluginAsync {
  return async (app) => {
    app.get('/dev/messages', async (request) => {
      if (recetteKey !== null) {
        const given = request.headers['x-recette-key'];
        if (typeof given !== 'string' || !timingSafeEqual(digest(given), digest(recetteKey)))
          throw new HttpError(401, 'recette_key_required', 'Clé de recette absente ou invalide');
      }
      const { recipient } = z
        .object({ recipient: recetteKey === null ? z.string().optional() : z.string().min(1) })
        .parse(request.query);
      const direct: DevMessage[] = sender.recent
        .filter((m) => !recipient || m.recipient === recipient)
        .map(({ recipient: r, channel, template, variables, sentAt }) => ({
          recipient: r,
          channel,
          template,
          variables,
          sentAt,
        }));
      const { rows } = await db.query<{
        recipient: string;
        channel: string;
        template: string;
        variables: Record<string, string>;
        created_at: Date;
      }>(
        `SELECT recipient, channel, template, variables, created_at FROM notifications
         WHERE $1::text IS NULL OR recipient = $1 ORDER BY created_at DESC LIMIT 20`,
        [recipient ?? null],
      );
      const dispatched = rows.map((r) => ({
        recipient: r.recipient,
        channel: r.channel,
        template: r.template,
        variables: r.variables,
        sentAt: r.created_at.toISOString(),
      }));
      const items = [...direct, ...dispatched]
        .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
        .slice(0, 20);
      return { items };
    });
  };
}
