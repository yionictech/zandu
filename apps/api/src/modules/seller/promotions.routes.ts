import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { withTx } from '../../db/pool.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { actor, currentUser, requireAuth, requireRole } from '../auth/guards.js';
import { usableCoupon } from '../checkout/checkout.service.js';
import { shopOf } from './seller.routes.js';

const IdParam = z.object({ id: z.uuid() });
const Code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{3,20}$/, 'De 3 à 20 lettres ou chiffres, sans espace');

/** Prix soldé arrondi à 50 FCFA près (prix « ronds »), toujours sous l'ancien prix. */
export function salePrice(original: number, percent: number): number {
  const raw = (original * (100 - percent)) / 100;
  const rounded = Math.max(50, Math.round(raw / 50) * 50);
  return rounded < original ? rounded : Math.max(1, original - 1);
}

/** Fin des promotions arrivées à échéance : l'ancien prix revient tout seul. */
export async function endSales(ctx: AppContext): Promise<number> {
  const { rowCount } = await ctx.pool.query(
    `UPDATE products SET price = compare_at_price, compare_at_price = NULL, sale_ends_at = NULL,
            updated_at = $1
     WHERE compare_at_price IS NOT NULL AND sale_ends_at <= $1`,
    [ctx.clock.now()],
  );
  return rowCount ?? 0;
}

/**
 * Réductions du vendeur : prix barré sur un produit (avec date de fin) et codes promo de la
 * boutique. La remise est toujours payée par le vendeur : elle baisse le montant des articles.
 */
export function promotionRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const now = () => ctx.clock.now();

    /** Acheteur : vérifier un code avant de payer (boutique concernée, remise, minimum). */
    app.get('/v1/coupons/:code', async (request) => {
      const { code } = z.object({ code: Code }).parse(request.params);
      const c = await usableCoupon(ctx.pool, code, currentUser(request).id, now());
      return {
        code: c.code,
        sellerId: c.seller_id,
        shopName: c.shop_name,
        percent: c.percent,
        minSubtotal: c.min_subtotal,
        endsAt: c.ends_at?.toISOString() ?? null,
      };
    });

    app.register(async (seller) => {
      seller.addHook('preHandler', requireRole('seller'));

      seller.get('/v1/seller/coupons', async (request) => {
        const shop = await shopOf(ctx.pool, actor(request, 'seller').userId);
        const { rows } = await ctx.pool.query(
          `SELECT c.id, c.code, c.percent, c.min_subtotal::int AS "minSubtotal", c.max_uses AS "maxUses",
                  c.ends_at AS "endsAt", c.active, c.created_at AS "createdAt",
                  (SELECT count(*)::int FROM orders o WHERE o.coupon_id = c.id AND o.paid_at IS NOT NULL) AS uses,
                  (SELECT coalesce(sum(o.discount_total), 0)::int FROM orders o
                     WHERE o.coupon_id = c.id AND o.paid_at IS NOT NULL) AS "discountGiven"
           FROM shop_coupons c WHERE c.seller_id = $1 ORDER BY c.active DESC, c.created_at DESC`,
          [shop.id],
        );
        return { items: rows };
      });

      seller.post('/v1/seller/coupons', async (request, reply) => {
        const body = z
          .object({
            code: Code,
            percent: z.int().min(5).max(50),
            minSubtotal: z.int().min(0).max(100_000_000).default(0),
            maxUses: z.int().min(1).max(100_000).optional(),
            endsAt: z.iso.datetime({ offset: true }).optional(),
          })
          .parse(request.body);
        const shop = await shopOf(ctx.pool, actor(request, 'seller').userId);
        if (body.endsAt && new Date(body.endsAt) <= now())
          throw new HttpError(422, 'ends_in_past', 'La date de fin est déjà passée');
        const { rows } = await ctx.pool.query<{ id: string }>(
          `INSERT INTO shop_coupons (seller_id, code, percent, min_subtotal, max_uses, ends_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (code) DO NOTHING RETURNING id`,
          [
            shop.id,
            body.code,
            body.percent,
            body.minSubtotal,
            body.maxUses ?? null,
            body.endsAt ?? null,
            now(),
          ],
        );
        if (!rows[0])
          throw new HttpError(409, 'code_taken', 'Ce code est déjà pris : choisissez-en un autre');
        return reply.status(201).send({ id: rows[0].id, code: body.code });
      });

      seller.post('/v1/seller/coupons/:id/disable', async (request, reply) => {
        const { id } = IdParam.parse(request.params);
        const shop = await shopOf(ctx.pool, actor(request, 'seller').userId);
        const { rowCount } = await ctx.pool.query(
          'UPDATE shop_coupons SET active = false WHERE id = $1 AND seller_id = $2',
          [id, shop.id],
        );
        if (!rowCount) throw notFound('Code promo');
        return reply.status(204).send();
      });

      /** Mettre un produit en promotion : prix barré, nouveau prix, fin facultative. */
      seller.post('/v1/seller/products/:id/sale', async (request) => {
        const { id } = IdParam.parse(request.params);
        const body = z
          .object({
            percent: z.int().min(5).max(70),
            endsAt: z.iso.datetime({ offset: true }).optional(),
          })
          .parse(request.body);
        const shop = await shopOf(ctx.pool, actor(request, 'seller').userId);
        if (body.endsAt && new Date(body.endsAt) <= now())
          throw new HttpError(422, 'ends_in_past', 'La date de fin est déjà passée');
        return withTx(ctx.pool, async (tx) => {
          const { rows } = await tx.query<{ price: number; compare_at_price: number | null }>(
            `SELECT price::int AS price, compare_at_price::int AS compare_at_price FROM products
             WHERE id = $1 AND seller_id = $2 AND status <> 'archived' FOR UPDATE`,
            [id, shop.id],
          );
          const p = rows[0];
          if (!p) throw notFound('Produit');
          // Déjà en promotion : la nouvelle remise part de l'ancien prix, pas du prix soldé.
          const original = p.compare_at_price ?? p.price;
          const price = salePrice(original, body.percent);
          await tx.query(
            `UPDATE products SET price = $3, compare_at_price = $4, sale_ends_at = $5, updated_at = $6
             WHERE id = $1 AND seller_id = $2`,
            [id, shop.id, price, original, body.endsAt ?? null, now()],
          );
          return { price, compareAtPrice: original, saleEndsAt: body.endsAt ?? null };
        });
      });

      /** Arrêter la promotion : l'ancien prix revient. */
      seller.delete('/v1/seller/products/:id/sale', async (request, reply) => {
        const { id } = IdParam.parse(request.params);
        const shop = await shopOf(ctx.pool, actor(request, 'seller').userId);
        await ctx.pool.query(
          `UPDATE products SET price = compare_at_price, compare_at_price = NULL, sale_ends_at = NULL,
                  updated_at = $3
           WHERE id = $1 AND seller_id = $2 AND compare_at_price IS NOT NULL`,
          [id, shop.id, now()],
        );
        return reply.status(204).send();
      });
    });
  };
}
