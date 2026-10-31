import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { withTx, type Db } from '../../db/pool.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../auth/guards.js';
import { publish } from '../notifications/outbox.js';
import { shortName } from './orders.routes.js';

const IdParam = z.object({ id: z.uuid() });
export const RIDER_TAGS = [
  'ponctuel',
  'poli',
  'soigneux',
  'en_retard',
  'impoli',
  'colis_abime',
] as const;
/** Note qui prévient le support (livreur à recadrer par sa société). */
const ALERT_AT_OR_BELOW = 2;

/** Note moyenne d'un livreur (90 derniers jours), pour lui, sa société et le support. */
export async function riderRating(
  db: Db,
  riderId: string,
  now: Date,
): Promise<{ average: number | null; count: number }> {
  const { rows } = await db.query<{ average: string | null; count: number }>(
    `SELECT round(avg(rating), 1)::text AS average, count(*)::int AS count
     FROM rider_reviews WHERE rider_id = $1 AND created_at > $2::timestamptz - interval '90 days'`,
    [riderId, now],
  );
  return {
    average: rows[0]!.average === null ? null : Number(rows[0]!.average),
    count: rows[0]!.count,
  };
}

/**
 * Avis sur le livreur (une fois par commande, après une remise à domicile) : l'acheteur dit si
 * la course s'est bien passée. Rien n'est montré au public ; le livreur voit sa moyenne.
 */
export function riderReviewRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));

    const deliveryOf = async (db: Db, orderId: string, buyerId: string) => {
      const { rows } = await db.query<{
        status: string;
        public_ref: string;
        rider_id: string | null;
        rider_name: string | null;
        delivered: boolean;
      }>(
        `SELECT o.status::text AS status, o.public_ref, d.rider_id, u.full_name AS rider_name,
                coalesce(d.status = 'delivered' AND o.pickup_point_id IS NULL, false) AS delivered
         FROM orders o
         LEFT JOIN deliveries d ON d.order_id = o.id
         LEFT JOIN riders r ON r.id = d.rider_id LEFT JOIN users u ON u.id = r.user_id
         WHERE o.id = $1 AND o.buyer_id = $2`,
        [orderId, buyerId],
      );
      if (!rows[0]) throw notFound('Commande');
      return rows[0];
    };

    app.get('/v1/orders/:id/rider-review', async (request) => {
      const { id } = IdParam.parse(request.params);
      const user = currentUser(request);
      const d = await deliveryOf(ctx.pool, id, user.id);
      const { rows } = await ctx.pool.query<{
        rating: number;
        tags: string[];
        comment: string | null;
        created_at: Date;
      }>('SELECT rating, tags, comment, created_at FROM rider_reviews WHERE order_id = $1', [id]);
      const review = rows[0];
      const name = d.rider_name?.trim();
      return {
        canRate: d.delivered && !!d.rider_id && !review,
        rider: d.rider_id ? { name: name ? shortName(name) : 'Livreur Zandu' } : null,
        review: review
          ? {
              rating: review.rating,
              tags: review.tags,
              comment: review.comment,
              createdAt: review.created_at.toISOString(),
            }
          : null,
      };
    });

    app.post('/v1/orders/:id/rider-review', async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const body = z
        .object({
          rating: z.int().min(1).max(5),
          tags: z.array(z.enum(RIDER_TAGS)).max(3).default([]),
          comment: z.string().trim().max(500).optional(),
        })
        .parse(request.body);
      const user = currentUser(request);
      const now = ctx.clock.now();
      await withTx(ctx.pool, async (tx) => {
        const d = await deliveryOf(tx, id, user.id);
        if (!d.delivered || !d.rider_id)
          throw new HttpError(
            409,
            'not_delivered',
            'Vous pourrez noter le livreur après la remise',
          );
        const inserted = await tx.query(
          `INSERT INTO rider_reviews (order_id, rider_id, buyer_id, rating, tags, comment, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (order_id) DO NOTHING RETURNING id`,
          [
            id,
            d.rider_id,
            user.id,
            body.rating,
            [...new Set(body.tags)],
            body.comment || null,
            now,
          ],
        );
        if (!inserted.rowCount)
          throw new HttpError(409, 'already_reviewed', 'Vous avez déjà noté ce livreur');
        if (body.rating <= ALERT_AT_OR_BELOW)
          await publish(
            tx,
            'alert.support',
            { type: 'order', id },
            {
              message: `Livreur noté ${body.rating}/5 sur ${d.public_ref}${body.comment ? ` : « ${body.comment.slice(0, 120)} »` : ''}`,
            },
            now,
          );
      });
      return reply.status(201).send({ recorded: true });
    });
  };
}
