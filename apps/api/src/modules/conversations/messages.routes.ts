import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { withTx, type Db } from '../../db/pool.js';
import { HttpError } from '../../lib/errors.js';
import { audit } from '../admin/audit.js';
import { currentUser, requireAuth, requireStaff, staffActor } from '../auth/guards.js';
import { publish } from '../notifications/outbox.js';
import { conversationOf, isOpen, participantIn, type Conversation } from './participants.js';

const IdParam = z.object({ id: z.uuid() });
const Body = z.object({ body: z.string().trim().min(1).max(1000) });
/** Au-delà, c'est un robot ou une dispute : le support prend le relais. */
const MAX_PER_MINUTE = 20;

interface MessageRow {
  id: string;
  author_id: string;
  author_role: 'buyer' | 'seller' | 'rider' | 'support';
  body: string;
  created_at: Date;
}

async function messagesOf(db: Db, orderId: string): Promise<MessageRow[]> {
  const { rows } = await db.query<MessageRow>(
    `SELECT id, author_id, author_role::text AS author_role, body, created_at
     FROM order_messages WHERE order_id = $1 ORDER BY seq LIMIT 500`,
    [orderId],
  );
  return rows;
}

function view(c: Conversation, m: MessageRow, viewerId: string | null) {
  const author = c.participants.find((p) => p.userId === m.author_id && p.role === m.author_role);
  return {
    id: m.id,
    role: m.author_role,
    name:
      m.author_role === 'support'
        ? 'Support Zandu'
        : (author?.name ??
          { buyer: 'Client', seller: 'Vendeur', rider: 'Ancien livreur' }[m.author_role]),
    mine: viewerId !== null && m.author_id === viewerId,
    body: m.body,
    createdAt: m.created_at.toISOString(),
  };
}

async function post(
  ctx: AppContext,
  c: Conversation,
  authorId: string,
  role: MessageRow['author_role'],
  body: string,
) {
  const now = ctx.clock.now();
  return withTx(ctx.pool, async (tx) => {
    const { rows: recent } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM order_messages WHERE author_id = $1 AND created_at > $2`,
      [authorId, new Date(now.getTime() - 60_000)],
    );
    if (recent[0]!.n >= MAX_PER_MINUTE)
      throw new HttpError(429, 'too_many_messages', 'Trop de messages, patientez une minute');
    const { rows } = await tx.query<MessageRow>(
      `INSERT INTO order_messages (order_id, author_id, author_role, body, created_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, author_id, author_role::text AS author_role, body, created_at`,
      [c.orderId, authorId, role, body, now],
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
        items: items.map((m) => view(c, m, user.id)),
      };
    });

    app.post('/v1/orders/:id/messages', async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const { body } = Body.parse(request.body);
      const user = currentUser(request);
      const c = await conversationOf(ctx.pool, id);
      const me = participantIn(c, user.id);
      if (!isOpen(c))
        throw new HttpError(409, 'conversation_closed', 'Cette commande est terminée');
      const row = await post(ctx, c, user.id, me.role, body);
      return reply.status(201).send(view(c, row, user.id));
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
        items: (await messagesOf(ctx.pool, id)).map((m) => view(c, m, null)),
      };
    });

    app.post('/v1/support/orders/:id/messages', async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const { body } = Body.parse(request.body);
      const c = await conversationOf(ctx.pool, id);
      const user = currentUser(request);
      const row = await post(ctx, c, user.id, 'support', body);
      await audit(
        ctx.pool,
        staffActor(request),
        'order.message_sent',
        { type: 'order', id },
        { messageId: row.id },
      );
      return reply.status(201).send(view(c, row, null));
    });
  };
}
