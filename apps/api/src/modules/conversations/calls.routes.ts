import { createHmac } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { withTx, type Db } from '../../db/pool.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../auth/guards.js';
import { publish } from '../notifications/outbox.js';
import { conversationOf, isOpen, participantIn, type Conversation } from './participants.js';

/** Sans réponse au bout de ce délai, l'appel est manqué. */
export const RING_SECONDS = 45;
const MAX_CALLS_PER_10_MIN = 10;

const IdParam = z.object({ id: z.uuid() });
const StartCall = z.object({ to: z.enum(['buyer', 'seller', 'rider']) });

const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

/**
 * Jeton d'accès LiveKit (JWT HS256) : droit d'entrer dans une seule salle, pour parler et
 * écouter, pendant deux heures au plus. https://docs.livekit.io/home/get-started/authentication/
 */
export function livekitToken(
  keys: { apiKey: string; apiSecret: string },
  grant: { identity: string; name: string; room: string },
  now: Date,
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: keys.apiKey,
      sub: grant.identity,
      name: grant.name,
      nbf: iat - 10,
      exp: iat + 2 * 3600,
      video: {
        room: grant.room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
        canPublishSources: ['microphone'],
      },
    }),
  );
  const signature = createHmac('sha256', keys.apiSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

interface CallRow {
  id: string;
  order_id: string;
  caller_id: string;
  callee_id: string;
  status: 'ringing' | 'accepted' | 'declined' | 'missed' | 'ended';
  created_at: Date;
  answered_at: Date | null;
  ended_at: Date | null;
}

/** Un appel resté sans réponse trop longtemps est manqué (constaté à la lecture). */
async function settleExpired(db: Db, now: Date): Promise<void> {
  await db.query(
    `UPDATE order_calls SET status = 'missed', ended_at = $1
     WHERE status = 'ringing' AND created_at < $1::timestamptz - make_interval(secs => $2::int)`,
    [now, RING_SECONDS],
  );
}

async function loadCall(db: Db, id: string, userId: string): Promise<CallRow> {
  const { rows } = await db.query<CallRow>(
    'SELECT * FROM order_calls WHERE id = $1 AND (caller_id = $2 OR callee_id = $2)',
    [id, userId],
  );
  if (!rows[0]) throw notFound('Appel');
  return rows[0];
}

export function callRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const now = () => ctx.clock.now();

    const livekit = () => {
      const lk = ctx.config.livekit;
      if (!lk)
        throw new HttpError(503, 'calls_unavailable', 'Les appels ne sont pas encore disponibles');
      return lk;
    };
    const access = (c: Conversation, call: CallRow, userId: string) => {
      const lk = livekit();
      const me = c.participants.find((p) => p.userId === userId);
      return {
        url: lk.url,
        token: livekitToken(
          lk,
          { identity: userId, name: me?.name ?? 'Zandu', room: `call-${call.id}` },
          now(),
        ),
      };
    };
    const view = (c: Conversation, call: CallRow, userId: string) => {
      const peerId = call.caller_id === userId ? call.callee_id : call.caller_id;
      const peer = c.participants.find((p) => p.userId === peerId);
      return {
        id: call.id,
        orderId: call.order_id,
        publicRef: c.publicRef,
        status: call.status,
        direction: call.caller_id === userId ? ('outgoing' as const) : ('incoming' as const),
        peer: peer
          ? { role: peer.role, name: peer.name }
          : { role: 'buyer' as const, name: 'Zandu' },
        createdAt: call.created_at.toISOString(),
        answeredAt: call.answered_at?.toISOString() ?? null,
        ringSeconds: RING_SECONDS,
      };
    };

    /** Appeler un autre participant de la commande ; il est prévenu sur son téléphone. */
    app.post('/v1/orders/:id/calls', async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const { to } = StartCall.parse(request.body);
      const user = currentUser(request);
      livekit();
      const c = await conversationOf(ctx.pool, id);
      participantIn(c, user.id);
      if (!isOpen(c))
        throw new HttpError(409, 'conversation_closed', 'Cette commande est terminée');
      const callee = c.participants.find((p) => p.role === to && p.userId !== user.id);
      if (!callee) throw new HttpError(409, 'nobody_to_call', 'Personne à appeler pour le moment');
      const call = await withTx(ctx.pool, async (tx) => {
        const { rows: recent } = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM order_calls WHERE caller_id = $1 AND created_at > $2`,
          [user.id, new Date(now().getTime() - 10 * 60_000)],
        );
        if (recent[0]!.n >= MAX_CALLS_PER_10_MIN)
          throw new HttpError(429, 'too_many_calls', 'Trop d’appels, patientez quelques minutes');
        // Un seul appel qui sonne à la fois entre deux personnes.
        await tx.query(
          `UPDATE order_calls SET status = 'missed', ended_at = $3
           WHERE caller_id = $1 AND callee_id = $2 AND status = 'ringing'`,
          [user.id, callee.userId, now()],
        );
        const { rows } = await tx.query<CallRow>(
          `INSERT INTO order_calls (order_id, caller_id, callee_id, created_at)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [id, user.id, callee.userId, now()],
        );
        await publish(tx, 'order.call', { type: 'order', id }, { callId: rows[0]!.id }, now());
        return rows[0]!;
      });
      return reply
        .status(201)
        .send({ ...view(c, call, user.id), livekit: access(c, call, user.id) });
    });

    app.get('/v1/calls/:id', async (request) => {
      const { id } = IdParam.parse(request.params);
      const user = currentUser(request);
      await settleExpired(ctx.pool, now());
      const call = await loadCall(ctx.pool, id, user.id);
      return view(await conversationOf(ctx.pool, call.order_id), call, user.id);
    });

    /** Décrocher : jeton pour rejoindre la salle de l'appelant. */
    app.post('/v1/calls/:id/accept', async (request) => {
      const { id } = IdParam.parse(request.params);
      const user = currentUser(request);
      await settleExpired(ctx.pool, now());
      const call = await loadCall(ctx.pool, id, user.id);
      if (call.callee_id !== user.id) throw notFound('Appel');
      if (call.status !== 'ringing' && call.status !== 'accepted')
        throw new HttpError(409, 'call_over', 'Cet appel est terminé');
      const { rows } = await ctx.pool.query<CallRow>(
        `UPDATE order_calls SET status = 'accepted', answered_at = coalesce(answered_at, $2)
         WHERE id = $1 RETURNING *`,
        [id, now()],
      );
      const c = await conversationOf(ctx.pool, call.order_id);
      return { ...view(c, rows[0]!, user.id), livekit: access(c, rows[0]!, user.id) };
    });

    app.post('/v1/calls/:id/decline', async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const user = currentUser(request);
      const call = await loadCall(ctx.pool, id, user.id);
      if (call.callee_id !== user.id) throw notFound('Appel');
      await ctx.pool.query(
        `UPDATE order_calls SET status = 'declined', ended_at = $2 WHERE id = $1 AND status = 'ringing'`,
        [id, now()],
      );
      return reply.status(204).send();
    });

    /** Raccrocher (ou annuler avant la réponse : l'appel compte alors comme manqué). */
    app.post('/v1/calls/:id/end', async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const user = currentUser(request);
      await loadCall(ctx.pool, id, user.id);
      await ctx.pool.query(
        `UPDATE order_calls SET ended_at = $2,
           status = CASE status WHEN 'ringing' THEN 'missed'::call_status WHEN 'accepted' THEN 'ended'::call_status ELSE status END
         WHERE id = $1 AND status IN ('ringing', 'accepted')`,
        [id, now()],
      );
      return reply.status(204).send();
    });

    /** Appels qui sonnent pour moi (l'application l'interroge au premier plan). */
    app.get('/v1/me/calls/incoming', async (request) => {
      const user = currentUser(request);
      await settleExpired(ctx.pool, now());
      const { rows } = await ctx.pool.query<CallRow>(
        `SELECT * FROM order_calls WHERE callee_id = $1 AND status = 'ringing'
         ORDER BY created_at DESC LIMIT 1`,
        [user.id],
      );
      const items = [];
      for (const call of rows)
        items.push(view(await conversationOf(ctx.pool, call.order_id), call, user.id));
      return { items };
    });
  };
}
