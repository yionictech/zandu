import { parseCongoMobile, sellerPayableAccount } from '@zandu/domain';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { withTx, type Db } from '../../db/pool.js';
import { randomDigits } from '../../lib/crypto.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { audit } from '../admin/audit.js';
import { actor, currentUser, requireAuth } from '../auth/guards.js';
import { accountBalance, sellerEscrowBalance } from '../ledger/ledger.repository.js';

const ProductQuery = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
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
                    'verified', s.verification_status = 'verified', 'ratingAvg', s.rating_avg) AS seller`;

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
  const { rows } = await db.query(
    `SELECT ${PRODUCT_CARD}, ${rank} AS rank
     FROM products p JOIN seller_profiles s ON s.id = p.seller_id
     WHERE ${where.join(' AND ')}
     ORDER BY ${order}, p.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map(({ rank: _rank, ...product }) => product);
}

function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'boutique'
  );
}

export function catalogRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.get('/v1/categories', async () => {
      const { rows } = await ctx.pool.query(
        `SELECT id, parent_id AS "parentId", slug, name FROM categories WHERE active ORDER BY position, name`,
      );
      return rows;
    });

    app.get('/v1/products', async (request) => ({
      items: await searchProducts(ctx.pool, ProductQuery.parse(request.query)),
    }));

    app.get('/v1/products/:id', async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const { rows } = await ctx.pool.query(
        `SELECT ${PRODUCT_CARD}, p.description,
                (SELECT coalesce(json_agg(json_build_object('key', m.storage_key, 'width', m.width, 'height', m.height)
                                          ORDER BY m.position), '[]') FROM product_media m WHERE m.product_id = p.id) AS media,
                (SELECT json_build_object('average', round(avg(r.rating), 1), 'count', count(*))
                 FROM reviews r WHERE r.product_id = p.id AND NOT r.hidden) AS reviews
         FROM products p JOIN seller_profiles s ON s.id = p.seller_id
         WHERE p.id = $1 AND p.status = 'published'`,
        [id],
      );
      if (!rows[0]) throw notFound('Produit');
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

    // ---------------- Espace vendeur ----------------
    app.register(async (seller) => {
      seller.addHook('preHandler', requireAuth(ctx));

      /** Ouvrir sa boutique : en quelques champs, sans attendre la vérification. */
      seller.post('/v1/seller/shop', async (request, reply) => {
        const body = z
          .object({
            shopName: z.string().trim().min(2).max(80),
            city: z.string().trim().min(2).max(60),
            pickupZoneId: z.uuid(),
            payoutPhone: z.string(),
            payoutOperator: z.enum(['mtn', 'airtel']),
            kind: z.enum(['individual', 'business']).default('individual'),
          })
          .parse(request.body);
        const user = currentUser(request);
        const payoutPhone = parseCongoMobile(body.payoutPhone).e164;
        const id = await withTx(ctx.pool, async (tx) => {
          const exists = await tx.query('SELECT 1 FROM seller_profiles WHERE user_id = $1', [
            user.id,
          ]);
          if (exists.rowCount)
            throw new HttpError(409, 'shop_exists', 'Vous avez déjà une boutique');
          const { rows } = await tx.query<{ id: string }>(
            `INSERT INTO seller_profiles (user_id, shop_name, slug, kind, city, pickup_zone_id, payout_msisdn, payout_operator)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [
              user.id,
              body.shopName,
              `${slugify(body.shopName)}-${randomDigits(4)}`,
              body.kind,
              body.city,
              body.pickupZoneId,
              payoutPhone,
              body.payoutOperator,
            ],
          );
          await tx.query(
            `UPDATE users SET roles = array_append(roles, 'seller') WHERE id = $1 AND NOT 'seller' = ANY(roles)`,
            [user.id],
          );
          await audit(
            tx,
            { role: 'buyer', userId: user.id, ip: request.ip },
            'seller.shop_created',
            { type: 'seller', id: rows[0]!.id },
          );
          return rows[0]!.id;
        });
        return reply.status(201).send({ id });
      });

      /**
       * Publier un produit (F3). Vendeur vérifié : en ligne immédiatement (modération a
       * posteriori). Vendeur non vérifié : file de modération (rampe de confiance).
       */
      seller.post('/v1/seller/products', async (request, reply) => {
        const body = z
          .object({
            categoryId: z.uuid(),
            title: z.string().trim().min(3).max(140),
            description: z.string().trim().max(5000).default(''),
            price: z.int().positive().max(100_000_000),
            stock: z.int().min(0).max(100_000),
          })
          .parse(request.body);
        const a = actor(request, 'seller');
        const { rows: sellers } = await ctx.pool.query<{
          id: string;
          city: string;
          verification_status: string;
        }>('SELECT id, city, verification_status FROM seller_profiles WHERE user_id = $1', [
          a.userId,
        ]);
        const shop = sellers[0];
        if (!shop) throw new HttpError(409, 'no_shop', "Ouvrez d'abord votre boutique");
        if (shop.verification_status === 'suspended')
          throw new HttpError(403, 'seller_suspended', 'Boutique suspendue');
        const status = shop.verification_status === 'verified' ? 'published' : 'pending_review';
        const { rows } = await ctx.pool.query<{ id: string; status: string }>(
          `INSERT INTO products (seller_id, category_id, title, description, price, stock, city, status, published_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::product_status, CASE WHEN $8::product_status = 'published' THEN $9::timestamptz END)
           RETURNING id, status`,
          [
            shop.id,
            body.categoryId,
            body.title,
            body.description,
            body.price,
            body.stock,
            shop.city,
            status,
            ctx.clock.now(),
          ],
        );
        return reply.status(201).send(rows[0]);
      });

      /** Tableau de bord vendeur (F15) : solde disponible, argent en séquestre, reversements. */
      seller.get('/v1/seller/balance', async (request) => {
        const a = actor(request, 'seller');
        const { rows } = await ctx.pool.query<{ id: string }>(
          'SELECT id FROM seller_profiles WHERE user_id = $1',
          [a.userId],
        );
        if (!rows[0]) throw notFound('Boutique');
        const sellerId = rows[0].id;
        const { rows: payouts } = await ctx.pool.query(
          `SELECT id, amount, status, order_id AS "orderId", created_at AS "createdAt", succeeded_at AS "succeededAt"
           FROM payouts WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 50`,
          [sellerId],
        );
        return {
          available: await accountBalance(ctx.pool, sellerPayableAccount(sellerId)),
          inEscrow: await sellerEscrowBalance(ctx.pool, sellerId),
          payouts,
        };
      });
    });
  };
}
