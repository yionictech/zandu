import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';
import type { ObjectStorage } from '../storage/storage.js';

const ProductQuery = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  sellerId: z.uuid().optional(),
  city: z.string().max(60).optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().positive().optional(),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc']).default('relevance'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
});

const PRODUCT_CARD = `
  p.id, p.title, p.price, p.compare_at_price AS "compareAtPrice", p.stock, p.city,
  p.category_id AS "categoryId",
  (SELECT storage_key FROM product_media m WHERE m.product_id = p.id ORDER BY position LIMIT 1) AS "coverImage",
  json_build_object('id', s.id, 'shopName', s.shop_name, 'slug', s.slug,
                    'verified', s.verification_status = 'verified',
                    'ratingAvg', s.rating_avg::float, 'ratingCount', s.rating_count) AS seller`;

/** Les clés de stockage deviennent des URL publiques (CDN) au moment de la réponse. */
function withImageUrl<T extends { coverImage: string | null }>(storage: ObjectStorage, row: T): T {
  return { ...row, coverImage: row.coverImage ? storage.publicUrl(row.coverImage) : null };
}

/** Catalogue public (F4) : recherche plein texte française, tolérante aux accents et aux fautes. */
async function searchProducts(db: Db, query: z.infer<typeof ProductQuery>) {
  const params: unknown[] = [];
  const where = [`p.status = 'published'`, `p.stock > 0`];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  let rank = '0';
  if (query.q) {
    params.push(query.q);
    const q = `$${params.length}`;
    // Plein texte OU similarité de mots par trigrammes (« samsumg » trouve « Samsung »).
    // Seuil réglable : pg_trgm.word_similarity_threshold (0,6 par défaut).
    where.push(`(p.search_vector @@ websearch_to_tsquery('fr_unaccent', ${q})
                 OR f_unaccent(lower(${q})) <% f_unaccent(lower(p.title)))`);
    rank = `ts_rank(p.search_vector, websearch_to_tsquery('fr_unaccent', ${q}))
            + word_similarity(f_unaccent(lower(${q})), f_unaccent(lower(p.title)))`;
  }
  if (query.categoryId) {
    add(
      `p.category_id IN (WITH RECURSIVE tree AS (
           SELECT id FROM categories WHERE id = ?
           UNION ALL SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id) SELECT id FROM tree)`,
      query.categoryId,
    );
  }
  if (query.sellerId) add('p.seller_id = ?', query.sellerId);
  if (query.city) add('p.city = ?', query.city);
  if (query.minPrice !== undefined) add('p.price >= ?', query.minPrice);
  if (query.maxPrice !== undefined) add('p.price <= ?', query.maxPrice);

  const order = {
    relevance: query.q ? 'rank DESC, p.published_at DESC' : 'p.published_at DESC',
    newest: 'p.published_at DESC',
    price_asc: 'p.price ASC',
    price_desc: 'p.price DESC',
  }[query.sort];
  params.push(query.limit, query.offset);
  const { rows } = await db.query<{ coverImage: string | null; rank: number }>(
    `SELECT ${PRODUCT_CARD}, ${rank} AS rank
     FROM products p JOIN seller_profiles s ON s.id = p.seller_id
     WHERE ${where.join(' AND ')}
     ORDER BY ${order}, p.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map(({ rank: _rank, ...product }) => product);
}

export function catalogRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.get('/v1/categories', async () => {
      const { rows } = await ctx.pool.query(
        `SELECT id, parent_id AS "parentId", slug, name FROM categories WHERE active ORDER BY position, name`,
      );
      return rows;
    });

    app.get('/v1/products', async (request) => {
      const items = await searchProducts(ctx.pool, ProductQuery.parse(request.query));
      return { items: items.map((p) => withImageUrl(ctx.storage, p)) };
    });

    app.get('/v1/products/:id', async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const { rows } = await ctx.pool.query<{
        coverImage: string | null;
        media: Array<{ key: string; width: number | null; height: number | null }>;
      }>(
        `SELECT ${PRODUCT_CARD}, p.description,
                (SELECT coalesce(json_agg(json_build_object('key', m.storage_key, 'width', m.width, 'height', m.height)
                                          ORDER BY m.position), '[]') FROM product_media m WHERE m.product_id = p.id) AS media,
                (SELECT json_build_object('average', round(avg(r.rating), 1)::float, 'count', count(*))
                 FROM reviews r WHERE r.product_id = p.id AND NOT r.hidden) AS reviews
         FROM products p JOIN seller_profiles s ON s.id = p.seller_id
         WHERE p.id = $1 AND p.status = 'published'`,
        [id],
      );
      const product = rows[0];
      if (!product) throw notFound('Produit');
      return {
        ...withImageUrl(ctx.storage, product),
        media: product.media.map(({ key, ...size }) => ({
          url: ctx.storage.publicUrl(key),
          ...size,
        })),
      };
    });

    /** Avis vérifiés : seuls les acheteurs livrés ont pu les écrire (F11). */
    app.get('/v1/products/:id/reviews', async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const { limit, offset } = z
        .object({
          limit: z.coerce.number().int().min(1).max(50).default(20),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .parse(request.query);
      const { rows } = await ctx.pool.query(
        `SELECT r.id, r.rating, r.comment, r.created_at AS "createdAt",
                coalesce(split_part(u.full_name, ' ', 1), 'Acheteur') AS "authorName"
         FROM reviews r JOIN users u ON u.id = r.buyer_id
         WHERE r.product_id = $1 AND NOT r.hidden
         ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      );
      return { items: rows };
    });

    /** Vitrine publique d'une boutique (lien partagé par le vendeur sur WhatsApp). */
    app.get('/v1/shops/:slug', async (request) => {
      const { slug } = z
        .object({
          slug: z
            .string()
            .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
            .max(60),
        })
        .parse(request.params);
      const { rows } = await ctx.pool.query(
        `SELECT s.id, s.shop_name AS "shopName", s.slug, s.city, s.verification_status = 'verified' AS verified,
                s.rating_avg::float AS "ratingAvg", s.rating_count AS "ratingCount",
                (SELECT count(*)::int FROM orders o WHERE o.seller_id = s.id AND o.status = 'completed') AS "salesCount",
                s.created_at AS "memberSince"
         FROM seller_profiles s
         WHERE s.slug = $1 AND s.verification_status <> 'suspended'`,
        [slug],
      );
      if (!rows[0]) throw notFound('Boutique');
      return rows[0];
    });

    app.get('/v1/delivery/zones', async () => {
      const { rows } = await ctx.pool.query(
        `SELECT z.id, z.city, z.name,
                coalesce((SELECT json_agg(json_build_object('id', pp.id, 'name', pp.name, 'landmark', pp.landmark))
                          FROM pickup_points pp WHERE pp.zone_id = z.id AND pp.active), '[]') AS "pickupPoints"
         FROM delivery_zones z WHERE z.active ORDER BY z.city, z.name`,
      );
      return rows;
    });
  };
}
