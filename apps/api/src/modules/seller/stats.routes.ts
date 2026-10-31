import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { actor, requireAuth, requireRole } from '../auth/guards.js';
import { shopOf } from './seller.routes.js';

const DAY = `($2::timestamptz AT TIME ZONE 'Africa/Brazzaville')::date`;

/** Conseils montrés au vendeur (texte dans l'application), du plus utile au moins utile. */
export type SellerTip =
  'answer_faster' | 'add_photos' | 'improve_listing' | 'restock' | 'reply_reviews' | 'share_shop';

/**
 * Vue d'une fiche produit (application, site) : un compteur par produit et par jour, sans rien
 * sur la personne. Les robots d'aperçu (WhatsApp, Facebook) ne sont pas comptés par le site.
 */
export function productViewRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.post('/v1/products/:id/view', async (request, reply) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      await ctx.pool.query(
        `INSERT INTO product_view_days (product_id, day, views)
         SELECT id, ${DAY.replace('$2', '$1')}, 1 FROM products WHERE id = $2 AND status = 'published'
         ON CONFLICT (product_id, day) DO UPDATE SET views = product_view_days.views + 1`,
        [ctx.clock.now(), id],
      );
      return reply.status(204).send();
    });
  };
}

/** Statistiques de la boutique : vues, ventes par semaine, produits phares, réactivité, conseils. */
export function sellerStatsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    app.addHook('preHandler', requireRole('seller'));

    app.get('/v1/seller/stats', async (request) => {
      const { period } = z
        .object({ period: z.enum(['7d', '30d', '90d']).default('30d') })
        .parse(request.query);
      const days = { '7d': 7, '30d': 30, '90d': 90 }[period];
      const shop = await shopOf(ctx.pool, actor(request, 'seller').userId);
      const now = ctx.clock.now();
      const since = new Date(now.getTime() - days * 86_400_000);
      const params = [shop.id, now, days];
      const SINCE_DAY = `${DAY} - ($3::int - 1)`;

      const { rows: totals } = await ctx.pool.query<{
        views: number;
        orders: number;
        sales: string;
        units: number;
      }>(
        `SELECT
           (SELECT coalesce(sum(v.views), 0)::int FROM product_view_days v JOIN products p ON p.id = v.product_id
             WHERE p.seller_id = $1 AND v.day >= ${SINCE_DAY}) AS views,
           count(o.id)::int AS orders,
           coalesce(sum(o.items_subtotal), 0)::text AS sales,
           coalesce((SELECT sum(oi.quantity) FROM order_items oi JOIN orders o2 ON o2.id = oi.order_id
             WHERE o2.seller_id = $1 AND o2.paid_at >= $2::timestamptz - make_interval(days => $3::int)
               AND o2.status NOT IN ('cancelled', 'refunded')), 0)::int AS units
         FROM orders o
         WHERE o.seller_id = $1 AND o.paid_at >= $2::timestamptz - make_interval(days => $3::int)
           AND o.status NOT IN ('cancelled', 'refunded')`,
        params,
      );

      // Ventes des 8 dernières semaines (lundi, heure de Brazzaville).
      const { rows: weeks } = await ctx.pool.query<{ week: string; orders: number; sales: string }>(
        `WITH w AS (
           SELECT generate_series(
             date_trunc('week', $2::timestamptz AT TIME ZONE 'Africa/Brazzaville') - interval '7 weeks',
             date_trunc('week', $2::timestamptz AT TIME ZONE 'Africa/Brazzaville'),
             interval '1 week') AS week
         )
         SELECT to_char(w.week, 'YYYY-MM-DD') AS week, count(o.id)::int AS orders,
                coalesce(sum(o.items_subtotal), 0)::text AS sales
         FROM w LEFT JOIN orders o ON o.seller_id = $1
           AND o.status NOT IN ('cancelled', 'refunded') AND o.paid_at IS NOT NULL
           AND date_trunc('week', o.paid_at AT TIME ZONE 'Africa/Brazzaville') = w.week
         GROUP BY w.week ORDER BY w.week`,
        [shop.id, now],
      );

      const { rows: top } = await ctx.pool.query<{
        id: string;
        title: string;
        views: number;
        sold: number;
      }>(
        `SELECT p.id, p.title,
                coalesce((SELECT sum(v.views) FROM product_view_days v
                  WHERE v.product_id = p.id AND v.day >= ${SINCE_DAY}), 0)::int AS views,
                coalesce((SELECT sum(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                  WHERE oi.product_id = p.id AND o.paid_at >= $2::timestamptz - make_interval(days => $3::int)
                    AND o.status NOT IN ('cancelled', 'refunded')), 0)::int AS sold
         FROM products p WHERE p.seller_id = $1 AND p.status <> 'archived'
         ORDER BY views DESC, sold DESC, p.title LIMIT 5`,
        params,
      );

      // Réactivité : commandes acceptées (ou refusées, laissées sans réponse) et délais.
      const { rows: speed } = await ctx.pool.query<{
        accepted: number;
        missed: number;
        accept_minutes: number | null;
        prep_minutes: number | null;
      }>(
        `WITH h AS (
           SELECT o.id, o.paid_at,
                  min(h.created_at) FILTER (WHERE h.event = 'seller_accepted') AS accepted_at,
                  min(h.created_at) FILTER (WHERE h.event = 'seller_marked_ready') AS ready_at,
                  bool_or(h.event IN ('seller_rejected', 'seller_acceptance_timeout')) AS missed
           FROM orders o JOIN order_status_history h ON h.order_id = o.id
           WHERE o.seller_id = $1 AND o.paid_at >= $2::timestamptz - make_interval(days => $3::int)
           GROUP BY o.id, o.paid_at
         )
         SELECT count(*) FILTER (WHERE accepted_at IS NOT NULL)::int AS accepted,
                count(*) FILTER (WHERE missed)::int AS missed,
                round(avg(extract(epoch FROM accepted_at - paid_at) / 60))::int AS accept_minutes,
                round(avg(extract(epoch FROM ready_at - accepted_at) / 60))::int AS prep_minutes
         FROM h`,
        params,
      );

      const { rows: facts } = await ctx.pool.query<{
        few_photos: number;
        low_stock: number;
        unanswered: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM products p WHERE p.seller_id = $1 AND p.status = 'published'
              AND (SELECT count(*) FROM product_media m WHERE m.product_id = p.id) < 3) AS few_photos,
           (SELECT count(*)::int FROM products p WHERE p.seller_id = $1 AND p.status = 'published'
              AND p.stock <= p.low_stock_threshold) AS low_stock,
           (SELECT count(*)::int FROM reviews r WHERE r.seller_id = $1 AND r.seller_reply IS NULL
              AND NOT r.hidden AND r.comment IS NOT NULL) AS unanswered`,
        [shop.id],
      );

      const t = totals[0]!;
      const s = speed[0]!;
      const f = facts[0]!;
      const handled = s.accepted + s.missed;
      // Sans assez de vues comptées (commandes venues d'un lien partagé hors fiche), pas de taux.
      const conversion =
        t.views > 0 && t.views >= t.orders ? Math.round((t.orders / t.views) * 1000) / 10 : null;
      const tips: SellerTip[] = [];
      if (s.missed > 0 || (s.accept_minutes ?? 0) > 120) tips.push('answer_faster');
      if (f.few_photos > 0) tips.push('add_photos');
      if (t.views >= 50 && (conversion ?? 0) < 1) tips.push('improve_listing');
      if (f.low_stock > 0) tips.push('restock');
      if (f.unanswered > 0) tips.push('reply_reviews');
      if (t.views < 20) tips.push('share_shop');

      return {
        period,
        views: t.views,
        orders: t.orders,
        sales: Number(t.sales),
        unitsSold: t.units,
        conversionPercent: conversion,
        weekly: weeks.map((w) => ({ weekStart: w.week, orders: w.orders, sales: Number(w.sales) })),
        topProducts: top.map((p) => ({
          productId: p.id,
          title: p.title,
          views: p.views,
          sold: p.sold,
        })),
        acceptanceRatePercent: handled ? Math.round((s.accepted / handled) * 100) : null,
        averageAcceptMinutes: s.accept_minutes,
        averagePrepMinutes: s.prep_minutes,
        tips: tips.slice(0, 3),
        counts: { fewPhotos: f.few_photos, lowStock: f.low_stock, unansweredReviews: f.unanswered },
      };
    });
  };
}
