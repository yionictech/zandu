import {
  lineCommission,
  parseCongoMobile,
  resolveCommissionRate,
  sellerPayableAccount,
} from '@zandu/domain';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Actor, AppContext } from '../../context.js';
import { withTx, type Db, type Tx } from '../../db/pool.js';
import { randomDigits } from '../../lib/crypto.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { audit } from '../admin/audit.js';
import { actor, currentUser, requireAuth } from '../auth/guards.js';
import { loadCategoryPaths, loadCommissionRules } from '../checkout/checkout.service.js';
import { accountBalance, sellerEscrowBalance } from '../ledger/ledger.repository.js';
import { consumeUpload } from '../uploads/uploads.service.js';

const MAX_PHOTOS = 6;

interface Shop {
  id: string;
  kind: 'individual' | 'business';
  city: string;
  verification_status: string;
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

async function shopOf(db: Db, userId: string | null): Promise<Shop> {
  const { rows } = await db.query<Shop>(
    'SELECT id, kind, city, verification_status FROM seller_profiles WHERE user_id = $1',
    [userId],
  );
  if (!rows[0]) throw new HttpError(409, 'no_shop', "Ouvrez d'abord votre boutique");
  return rows[0];
}

/** Verrouille un produit de la boutique de l'acteur (404 s'il appartient à un autre vendeur). */
async function ownProduct(tx: Tx, productId: string, shop: Shop) {
  const { rows } = await tx.query<{ id: string; status: string }>(
    'SELECT id, status FROM products WHERE id = $1 AND seller_id = $2 FOR UPDATE',
    [productId, shop.id],
  );
  if (!rows[0]) throw notFound('Produit');
  return rows[0];
}

/**
 * Rampe de confiance : un vendeur non vérifié repasse en modération dès qu'il modifie le
 * contenu visible (texte, catégorie, photos) d'un produit publié.
 */
function statusAfterContentChange(shop: Shop, current: string): string {
  return shop.verification_status !== 'verified' && current === 'published'
    ? 'pending_review'
    : current;
}

async function productPhotos(ctx: AppContext, db: Db, productId: string) {
  const { rows } = await db.query<{ id: string; storage_key: string; position: number }>(
    'SELECT id, storage_key, position FROM product_media WHERE product_id = $1 ORDER BY position',
    [productId],
  );
  return rows.map((r) => ({
    id: r.id,
    position: r.position,
    url: ctx.storage.publicUrl(r.storage_key),
  }));
}

/** Pièces exigées pour demander la vérification : identité + selfie (+ RCCM et NIU pour une entreprise). */
function missingKycDocuments(kind: Shop['kind'], types: Set<string>): string[] {
  const missing: string[] = [];
  if (!types.has('national_id') && !types.has('passport')) missing.push('national_id');
  if (!types.has('selfie')) missing.push('selfie');
  if (kind === 'business') {
    if (!types.has('rccm')) missing.push('rccm');
    if (!types.has('niu')) missing.push('niu');
  }
  return missing;
}

async function kycView(db: Db, shopId: string) {
  const { rows: shops } = await db.query<{
    kind: Shop['kind'];
    verification_status: string;
    rejection_reason: string | null;
  }>('SELECT kind, verification_status, rejection_reason FROM seller_profiles WHERE id = $1', [
    shopId,
  ]);
  const { rows: documents } = await db.query<{
    id: string;
    type: string;
    status: string;
    createdAt: Date;
  }>(
    `SELECT id, type, status, created_at AS "createdAt" FROM kyc_documents
     WHERE seller_id = $1 AND status <> 'rejected' ORDER BY created_at`,
    [shopId],
  );
  const shop = shops[0]!;
  return {
    verificationStatus: shop.verification_status,
    rejectionReason: shop.rejection_reason,
    documents,
    missing: missingKycDocuments(shop.kind, new Set(documents.map((d) => d.type))),
  };
}

export function sellerRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));

    /** Ouvrir sa boutique : en quelques champs, sans attendre la vérification. */
    app.post('/v1/seller/shop', async (request, reply) => {
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
        if (exists.rowCount) throw new HttpError(409, 'shop_exists', 'Vous avez déjà une boutique');
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
        await audit(tx, { role: 'buyer', userId: user.id, ip: request.ip }, 'seller.shop_created', {
          type: 'seller',
          id: rows[0]!.id,
        });
        return rows[0]!.id;
      });
      return reply.status(201).send({ id });
    });

    app.get('/v1/seller/shop', async (request) => {
      const a = actor(request, 'seller');
      const { rows } = await ctx.pool.query(
        `SELECT id, shop_name AS "shopName", slug, kind, city, pickup_zone_id AS "pickupZoneId",
                payout_msisdn AS "payoutPhone", payout_operator AS "payoutOperator",
                verification_status AS "verificationStatus", rating_avg::float AS "ratingAvg",
                rating_count AS "ratingCount"
         FROM seller_profiles WHERE user_id = $1`,
        [a.userId],
      );
      if (!rows[0]) throw notFound('Boutique');
      return rows[0];
    });

    /** « Vous recevrez : 45 000 FCFA » — affiché pendant la saisie du prix. */
    app.get('/v1/seller/commission-preview', async (request) => {
      const query = z
        .object({
          categoryId: z.uuid(),
          price: z.coerce.number().int().positive().max(100_000_000),
        })
        .parse(request.query);
      const shop = await shopOf(ctx.pool, actor(request, 'seller').userId);
      const rate = resolveCommissionRate(
        await loadCommissionRules(ctx.pool),
        {
          sellerId: shop.id,
          categoryPath: (await loadCategoryPaths(ctx.pool)).get(query.categoryId) ?? [],
        },
        ctx.clock.now(),
      );
      const commission = lineCommission(query.price, rate);
      return { rateBps: rate, commission, net: query.price - commission };
    });

    // ---------------- Produits ----------------

    app.get('/v1/seller/products', async (request) => {
      const shop = await shopOf(ctx.pool, actor(request, 'seller').userId);
      const { rows } = await ctx.pool.query<{ coverImage: string | null }>(
        `SELECT p.id, p.title, p.price, p.stock, p.status, p.category_id AS "categoryId",
                p.rejection_reason AS "rejectionReason", p.updated_at AS "updatedAt",
                (SELECT storage_key FROM product_media m WHERE m.product_id = p.id ORDER BY position LIMIT 1) AS "coverImage",
                (SELECT count(*)::int FROM product_media m WHERE m.product_id = p.id) AS "photoCount"
         FROM products p WHERE p.seller_id = $1 AND p.status <> 'archived'
         ORDER BY p.updated_at DESC LIMIT 200`,
        [shop.id],
      );
      return {
        items: rows.map((r) => ({
          ...r,
          coverImage: r.coverImage ? ctx.storage.publicUrl(r.coverImage) : null,
        })),
      };
    });

    /**
     * Publier un produit (F3). Vendeur vérifié : en ligne immédiatement (modération a
     * posteriori). Vendeur non vérifié : file de modération (rampe de confiance).
     */
    app.post('/v1/seller/products', async (request, reply) => {
      const body = z
        .object({
          categoryId: z.uuid(),
          title: z.string().trim().min(3).max(140),
          description: z.string().trim().max(5000).default(''),
          price: z.int().positive().max(100_000_000),
          stock: z.int().min(0).max(100_000),
        })
        .parse(request.body);
      const shop = await shopOf(ctx.pool, actor(request, 'seller').userId);
      if (shop.verification_status === 'suspended') {
        throw new HttpError(403, 'seller_suspended', 'Boutique suspendue');
      }
      const status = shop.verification_status === 'verified' ? 'published' : 'pending_review';
      const { rows } = await ctx.pool.query<{ id: string; status: string }>(
        `INSERT INTO products (seller_id, category_id, title, description, price, stock, city, status, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::product_status,
                 CASE WHEN $8::product_status = 'published' THEN $9::timestamptz END)
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

    /** Modifier, archiver ou remettre en vente un produit. */
    app.patch('/v1/seller/products/:id', async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const body = z
        .object({
          categoryId: z.uuid().optional(),
          title: z.string().trim().min(3).max(140).optional(),
          description: z.string().trim().max(5000).optional(),
          price: z.int().positive().max(100_000_000).optional(),
          stock: z.int().min(0).max(100_000).optional(),
          status: z.enum(['archived', 'published']).optional(),
        })
        .refine((b) => Object.keys(b).length > 0, 'Aucune modification')
        .parse(request.body);
      const a = actor(request, 'seller');
      return withTx(ctx.pool, async (tx) => {
        const shop = await shopOf(tx, a.userId);
        const product = await ownProduct(tx, id, shop);
        let status = product.status;
        if (
          body.title !== undefined ||
          body.description !== undefined ||
          body.categoryId !== undefined
        ) {
          status = statusAfterContentChange(shop, status);
        }
        if (body.status === 'archived') status = 'archived';
        if (body.status === 'published' && product.status === 'archived') {
          status = shop.verification_status === 'verified' ? 'published' : 'pending_review';
        }
        const { rows } = await tx.query(
          `UPDATE products SET
             category_id = coalesce($2, category_id), title = coalesce($3, title),
             description = coalesce($4, description), price = coalesce($5, price),
             stock = coalesce($6, stock), status = $7::product_status,
             published_at = CASE WHEN $7::product_status = 'published' THEN coalesce(published_at, $8::timestamptz)
                                 ELSE published_at END
           WHERE id = $1
           RETURNING id, title, price, stock, status`,
          [
            id,
            body.categoryId ?? null,
            body.title ?? null,
            body.description ?? null,
            body.price ?? null,
            body.stock ?? null,
            status,
            ctx.clock.now(),
          ],
        );
        return rows[0];
      });
    });

    /** Ajouter une photo déjà envoyée au stockage (jusqu'à 6 par produit). */
    app.post('/v1/seller/products/:id/photos', async (request, reply) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const { uploadId } = z.object({ uploadId: z.uuid() }).parse(request.body);
      const a = actor(request, 'seller');
      await withTx(ctx.pool, async (tx) => {
        const shop = await shopOf(tx, a.userId);
        const product = await ownProduct(tx, id, shop);
        const { rows } = await tx.query<{ position: number }>(
          'SELECT position FROM product_media WHERE product_id = $1',
          [id],
        );
        const used = new Set(rows.map((r) => r.position));
        const position = [...Array(MAX_PHOTOS).keys()].find((p) => !used.has(p));
        if (position === undefined) {
          throw new HttpError(
            409,
            'too_many_photos',
            `${MAX_PHOTOS} photos au maximum par produit`,
          );
        }
        const upload = await consumeUpload(ctx, tx, {
          uploadId,
          userId: a.userId!,
          purpose: 'product_photo',
        });
        await tx.query(
          'INSERT INTO product_media (product_id, storage_key, position, upload_id) VALUES ($1, $2, $3, $4)',
          [id, upload.storageKey, position, upload.id],
        );
        const status = statusAfterContentChange(shop, product.status);
        if (status !== product.status) {
          await tx.query('UPDATE products SET status = $2::product_status WHERE id = $1', [
            id,
            status,
          ]);
        }
      });
      return reply.status(201).send({ photos: await productPhotos(ctx, ctx.pool, id) });
    });

    app.delete('/v1/seller/products/:id/photos/:photoId', async (request) => {
      const { id, photoId } = z.object({ id: z.uuid(), photoId: z.uuid() }).parse(request.params);
      const a = actor(request, 'seller');
      await withTx(ctx.pool, async (tx) => {
        await ownProduct(tx, id, await shopOf(tx, a.userId));
        const { rowCount } = await tx.query(
          'DELETE FROM product_media WHERE id = $1 AND product_id = $2',
          [photoId, id],
        );
        if (!rowCount) throw notFound('Photo');
      });
      return { photos: await productPhotos(ctx, ctx.pool, id) };
    });

    // ---------------- Vérification (KYC, F2) ----------------

    app.get('/v1/seller/kyc', async (request) => {
      const shop = await shopOf(ctx.pool, actor(request, 'seller').userId);
      return kycView(ctx.pool, shop.id);
    });

    /**
     * Ajoute une pièce. Quand le dossier est complet, la boutique passe en « en cours de
     * vérification » et apparaît dans la file du support.
     */
    app.post('/v1/seller/kyc-documents', async (request, reply) => {
      const body = z
        .object({
          uploadId: z.uuid(),
          type: z.enum(['national_id', 'passport', 'residence_proof', 'selfie', 'rccm', 'niu']),
        })
        .parse(request.body);
      const a: Actor = actor(request, 'seller');
      const shopId = await withTx(ctx.pool, async (tx) => {
        const shop = await shopOf(tx, a.userId);
        await tx.query('SELECT 1 FROM seller_profiles WHERE id = $1 FOR UPDATE', [shop.id]);
        if (shop.verification_status === 'verified' || shop.verification_status === 'suspended') {
          throw new HttpError(409, 'kyc_closed', 'Votre dossier ne peut plus être modifié');
        }
        const upload = await consumeUpload(ctx, tx, {
          uploadId: body.uploadId,
          userId: a.userId!,
          purpose: 'kyc_document',
        });
        await tx.query(
          'INSERT INTO kyc_documents (seller_id, type, storage_key, upload_id) VALUES ($1, $2, $3, $4)',
          [shop.id, body.type, upload.storageKey, upload.id],
        );
        const view = await kycView(tx, shop.id);
        if (
          view.missing.length === 0 &&
          ['unverified', 'rejected'].includes(shop.verification_status)
        ) {
          await tx.query(
            `UPDATE seller_profiles SET verification_status = 'pending_review', rejection_reason = NULL WHERE id = $1`,
            [shop.id],
          );
          await audit(tx, a, 'seller.kyc_submitted', { type: 'seller', id: shop.id });
        }
        return shop.id;
      });
      return reply.status(201).send(await kycView(ctx.pool, shopId));
    });

    // ---------------- Argent (F15) ----------------

    /** Tableau de bord vendeur : solde disponible, argent en séquestre, reversements. */
    app.get('/v1/seller/balance', async (request) => {
      const shop = await shopOf(ctx.pool, actor(request, 'seller').userId);
      const { rows: payouts } = await ctx.pool.query(
        `SELECT id, amount, status, order_id AS "orderId", created_at AS "createdAt", succeeded_at AS "succeededAt"
         FROM payouts WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [shop.id],
      );
      return {
        available: await accountBalance(ctx.pool, sellerPayableAccount(shop.id)),
        inEscrow: await sellerEscrowBalance(ctx.pool, shop.id),
        payouts,
      };
    });
  };
}
