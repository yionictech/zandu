import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { withTx, type Db } from '../../db/pool.js';
import { HttpError } from '../../lib/errors.js';
import { audit } from '../admin/audit.js';
import { currentUser, requireAuth, requireStaff, staffActor } from '../auth/guards.js';
import { publish } from '../notifications/outbox.js';
import { consumeUpload } from '../uploads/uploads.service.js';
import { conversationOf, isOpen, participantIn, type Conversation } from './participants.js';

const IdParam = z.object({ id: z.uuid() });
const Body = z
  .object({
    body: z.string().trim().max(1000).default(''),
    photoUploadId: z.uuid().optional(),
  })
  .refine((b) => b.body.length > 0 || b.photoUploadId, 'Message vide');
/** Lien de lecture d'une photo de conversation (espace privé). */
const PHOTO_URL_SECONDS = 3600;
/** Au-delà, c'est un robot ou une dispute : le support prend le relais. */
const MAX_PER_MINUTE = 20;

interface MessageRow {
  id: string;
  author_id: string;
  author_role: 'buyer' | 'seller' | 'rider' | 'support';
  body: string;
  photo_key: string | null;
  created_at: Date;
}

interface CallRow {
  id: string;
  caller_id: string;
  status: 'ringing' | 'accepted' | 'declined' | 'missed' | 'ended';
  created_at: Date;
  answered_at: Date | null;
  ended_at: Date | null;
}

async function messagesOf(db: Db, orderId: string): Promise<MessageRow[]> {
  const { rows } = await db.query<MessageRow>(
    `SELECT id, author_id, author_role::text AS author_role, body, photo_key, created_at
     FROM order_messages WHERE order_id = $1 ORDER BY seq LIMIT 500`,
    [orderId],
  );
  return rows;
}

interface TimelineItem {
  id: string;
  kind: 'message' | 'call';
  role: MessageRow['author_role'];
  name: string;
  mine: boolean;
  body: string;
  photoUrl: string | null;
  seen: boolean;
  call: { status: 'declined' | 'missed' | 'ended'; durationSeconds: number | null } | null;
  createdAt: string;
}

function authorName(c: Conversation, userId: string, role: MessageRow['author_role']): string {
  if (role === 'support') return 'Support Zandu';
  const author = c.participants.find((p) => p.userId === userId && p.role === role);
  return author?.name ?? { buyer: 'Client', seller: 'Vendeur', rider: 'Ancien livreur' }[role];
}

/**
 * Fil de la conversation : messages (texte, photo) et appels terminés, dans l'ordre. « Vu » : un
 * autre participant a ouvert la conversation après l'envoi.
 */
async function timeline(
  ctx: AppContext,
  c: Conversation,
  messages: MessageRow[],
  viewerId: string | null,
  withCalls: boolean,
): Promise<TimelineItem[]> {
  const { rows: reads } = await ctx.pool.query<{ user_id: string; last_read_at: Date }>(
    'SELECT user_id, last_read_at FROM order_message_reads WHERE order_id = $1',
    [c.orderId],
  );
  const items: Array<{ at: Date; item: TimelineItem }> = await Promise.all(
    messages.map(async (m) => ({
      at: m.created_at,
      item: {
        id: m.id,
        kind: 'message',
        role: m.author_role,
        name: authorName(c, m.author_id, m.author_role),
        mine: viewerId !== null && m.author_id === viewerId,
        body: m.body,
        photoUrl: m.photo_key
          ? await ctx.storage.presignDownload({
              bucket: 'private',
              key: m.photo_key,
              expiresInSeconds: PHOTO_URL_SECONDS,
            })
          : null,
        seen: reads.some((r) => r.user_id !== m.author_id && r.last_read_at >= m.created_at),
        call: null,
        createdAt: m.created_at.toISOString(),
      },
    })),
  );
  if (withCalls) {
    const { rows: calls } = await ctx.pool.query<CallRow>(
      `SELECT id, caller_id, status::text AS status, created_at, answered_at, ended_at
       FROM order_calls WHERE order_id = $1 AND status <> 'ringing' ORDER BY created_at LIMIT 200`,
      [c.orderId],
    );
    for (const call of calls) {
      const caller = c.participants.find((p) => p.userId === call.caller_id);
      items.push({
        at: call.created_at,
        item: {
          id: call.id,
          kind: 'call',
          role: caller?.role ?? 'buyer',
          name: caller?.name ?? 'Zandu',
          mine: viewerId !== null && call.caller_id === viewerId,
          body: '',
          photoUrl: null,
          seen: false,
          call: {
            status: call.status === 'accepted' || call.status === 'ringing' ? 'ended' : call.status,
            durationSeconds:
              call.answered_at && call.ended_at
                ? Math.max(
                    0,
                    Math.round((call.ended_at.getTime() - call.answered_at.getTime()) / 1000),
                  )
                : null,
          },
          createdAt: call.created_at.toISOString(),
        },
      });
    }
  }
  return items.sort((a, b) => a.at.getTime() - b.at.getTime()).map((x) => x.item);
}

async function messageView(
  ctx: AppContext,
  c: Conversation,
  m: MessageRow,
  viewerId: string | null,
) {
  return (await timeline(ctx, c, [m], viewerId, false))[0]!;
}

async function post(
  ctx: AppContext,
  c: Conversation,
  authorId: string,
  role: MessageRow['author_role'],
  input: { body: string; photoUploadId?: string | undefined },
) {
  const now = ctx.clock.now();
  return withTx(ctx.pool, async (tx) => {
    const { rows: recent } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM order_messages WHERE author_id = $1 AND created_at > $2`,
      [authorId, new Date(now.getTime() - 60_000)],
    );
    if (recent[0]!.n >= MAX_PER_MINUTE)
      throw new HttpError(429, 'too_many_messages', 'Trop de messages, patientez une minute');
    const photo = input.photoUploadId
      ? await consumeUpload(ctx, tx, {
          uploadId: input.photoUploadId,
          userId: authorId,
          purpose: 'message_photo',
        })
      : null;
    const { rows } = await tx.query<MessageRow>(
      `INSERT INTO order_messages (order_id, author_id, author_role, body, photo_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, author_id, author_role::text AS author_role, body, photo_key, created_at`,
      [c.orderId, authorId, role, input.body, photo?.storageKey ?? null, now],
    );
    await markRead(tx, c.orderId, authorId, now);
    await publish(
      tx,
      'order.message',
      { type: 'order', id: c.orderId },
      { messageId: rows[0]!.id, authorId },
      now,
    );
    return rows[0]!;
  });
}

const markRead = (db: Db, orderId: string, userId: string, at: Date) =>
  db.query(
    `INSERT INTO order_message_reads (order_id, user_id, last_read_at) VALUES ($1, $2, $3)
     ON CONFLICT (order_id, user_id) DO UPDATE SET last_read_at = greatest(order_message_reads.last_read_at, $3)`,
    [orderId, userId, at],
  );

/**
 * Messagerie de la commande (acheteur, vendeur, livreur) : ouverte tant que la commande vit,
 * lisible ensuite. Lire la conversation la marque comme lue.
 */
export function messageRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));

    app.get('/v1/orders/:id/messages', async (request) => {
      const { id } = IdParam.parse(request.params);
      const user = currentUser(request);
      const c = await conversationOf(ctx.pool, id);
      const me = participantIn(c, user.id);
      const items = await messagesOf(ctx.pool, id);
      await markRead(ctx.pool, id, user.id, ctx.clock.now());
      return {
        orderId: id,
        publicRef: c.publicRef,
        me: me.role,
        canWrite: isOpen(c),
        participants: c.participants
          .filter((p) => p.userId !== user.id)
          .map(({ role, name }) => ({ role, name })),
        items: await timeline(ctx, c, items, user.id, true),
      };
    });

    app.post('/v1/orders/:id/messages', async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const input = Body.parse(request.body);
      const user = currentUser(request);
      const c = await conversationOf(ctx.pool, id);
      const me = participantIn(c, user.id);
      if (!isOpen(c))
        throw new HttpError(409, 'conversation_closed', 'Cette commande est terminée');
      const row = await post(ctx, c, user.id, me.role, input);
      return reply.status(201).send(await messageView(ctx, c, row, user.id));
    });

    /** Conversations avec des messages non lus (pastilles des listes de commandes et de courses). */
    app.get('/v1/me/conversations', async (request) => {
      const user = currentUser(request);
      const { rows } = await ctx.pool.query<{
        order_id: string;
        public_ref: string;
        unread: number;
        last_at: Date;
      }>(
        `WITH mine AS (
           SELECT o.id FROM orders o WHERE o.buyer_id = $1
           UNION SELECT o.id FROM orders o JOIN seller_profiles s ON s.id = o.seller_id WHERE s.user_id = $1
           UNION SELECT d.order_id FROM deliveries d JOIN riders r ON r.id = d.rider_id WHERE r.user_id = $1
         )
         SELECT o.id AS order_id, o.public_ref, count(m.id)::int AS unread, max(m.created_at) AS last_at
         FROM mine JOIN orders o ON o.id = mine.id
         JOIN order_messages m ON m.order_id = o.id AND m.author_id <> $1
         LEFT JOIN order_message_reads r ON r.order_id = o.id AND r.user_id = $1
         WHERE m.created_at > coalesce(r.last_read_at, '-infinity')
         GROUP BY o.id, o.public_ref ORDER BY last_at DESC LIMIT 50`,
        [user.id],
      );
      return {
        totalUnread: rows.reduce((n, r) => n + r.unread, 0),
        items: rows.map((r) => ({
          orderId: r.order_id,
          publicRef: r.public_ref,
          unread: r.unread,
          lastMessageAt: r.last_at.toISOString(),
        })),
      };
    });
  };
}

/** Le support lit la conversation (litige, incident) et peut y écrire ; chaque écrit est journalisé. */
export function supportMessageRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    app.addHook('preHandler', requireStaff(ctx));

    app.get('/v1/support/orders/:id/messages', async (request) => {
      const { id } = IdParam.parse(request.params);
      const c = await conversationOf(ctx.pool, id);
      return {
        orderId: id,
        publicRef: c.publicRef,
        participants: c.participants.map(({ role, name }) => ({ role, name })),
        items: await timeline(ctx, c, await messagesOf(ctx.pool, id), null, true),
      };
    });

    app.post('/v1/support/orders/:id/messages', async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const { body } = z.object({ body: z.string().trim().min(1).max(1000) }).parse(request.body);
      const c = await conversationOf(ctx.pool, id);
      const user = currentUser(request);
      const row = await post(ctx, c, user.id, 'support', { body });
      await audit(
        ctx.pool,
        staffActor(request),
        'order.message_sent',
        { type: 'order', id },
        { messageId: row.id },
      );
      return reply.status(201).send(await messageView(ctx, c, row, null));
    });
  };
}
