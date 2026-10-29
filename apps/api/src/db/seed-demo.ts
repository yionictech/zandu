import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createStorage } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import { createPool, withTx } from './pool.js';
import { seedReference } from './seed.js';
import { loadDevEnvFile } from '../env-file.js';

/**
 * Données de démonstration (développement et recette uniquement) : trois boutiques vérifiées
 * de Pointe-Noire, douze produits avec photos, un administrateur et un livreur.
 * Idempotent. Les photos sont copiées dans le stockage configuré : S3 (recette) ou dossier de
 * développement (LOCAL_STORAGE_DIR).
 *
 * Comptes (connexion par code SMS, visible via GET /dev/messages, protégé par clé en recette) :
 *   administrateur 06 900 00 00 · livreur 06 800 00 00
 *   vendeurs 06 100 00 01 (électronique), 06 100 00 02 (mode), 05 100 00 03 (alimentation)
 */
const DEMO_DIR = fileURLToPath(new URL('../../../../db/seeds/demo/', import.meta.url));

const SHOPS = {
  electro: { phone: '+242061000001', name: 'Mama Grâce Électro', operator: 'mtn' },
  pagnes: { phone: '+242061000002', name: 'Pagnes & Style de Tié-Tié', operator: 'mtn' },
  saveurs: { phone: '+242051000003', name: 'Saveurs du Kouilou', operator: 'airtel' },
} as const;

const CATEGORY_IDS: Record<string, string> = {
  telephones: '10000000-0000-4000-8000-000000000002',
  informatique: '10000000-0000-4000-8000-000000000003',
  mode: '10000000-0000-4000-8000-000000000004',
  beaute: '10000000-0000-4000-8000-000000000005',
  maison: '10000000-0000-4000-8000-000000000006',
  alimentation: '10000000-0000-4000-8000-000000000007',
};
const LUMUMBA = '20000000-0000-4000-8000-000000000001';
const COURIER_PARTNER = '40000000-0000-4000-8000-000000000001';

interface DemoProduct {
  slug: string;
  shop: keyof typeof SHOPS;
  category: string;
  title: string;
  price: number;
  stock: number;
  description: string;
}

loadDevEnvFile();
const config = loadConfig();
if (config.env === 'production')
  throw new Error('Données de démonstration interdites en production');
const pool = createPool(config.databaseUrl);
// Stockage en mémoire sans dossier : les photos disparaîtraient avec ce processus.
const storage = config.storage.driver === 's3' || config.storage.dir ? createStorage(config) : null;

try {
  const { rowCount } = await pool.query('SELECT 1 FROM commission_rules LIMIT 1');
  if (!rowCount) await seedReference(pool);

  const products = JSON.parse(await readFile(`${DEMO_DIR}products.json`, 'utf8')) as DemoProduct[];
  await withTx(pool, async (tx) => {
    const user = async (phone: string, roles: string[]) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO users (phone, roles) VALUES ($1, $2::user_role[])
         ON CONFLICT (phone) DO UPDATE SET roles = EXCLUDED.roles RETURNING id`,
        [phone, roles],
      );
      return rows[0]!.id;
    };
    await user('+242069000000', ['buyer', 'admin']);
    const riderUser = await user('+242068000000', ['buyer', 'rider']);
    await tx.query(
      `INSERT INTO riders (user_id, courier_partner_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
      [riderUser, COURIER_PARTNER],
    );

    const shopIds: Record<string, string> = {};
    for (const [key, shop] of Object.entries(SHOPS)) {
      const userId = await user(shop.phone, ['buyer', 'seller']);
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO seller_profiles (user_id, shop_name, slug, city, pickup_zone_id, payout_msisdn, payout_operator,
                                      verification_status, verified_at)
         VALUES ($1, $2, $3, 'Pointe-Noire', $4, $5, $6, 'verified', now() - interval '60 days')
         ON CONFLICT (user_id) DO UPDATE SET shop_name = EXCLUDED.shop_name RETURNING id`,
        [userId, shop.name, `demo-${key}`, LUMUMBA, shop.phone, shop.operator],
      );
      shopIds[key] = rows[0]!.id;
    }

    for (const [index, p] of products.entries()) {
      const exists = await tx.query('SELECT 1 FROM products WHERE seller_id = $1 AND title = $2', [
        shopIds[p.shop],
        p.title,
      ]);
      if (exists.rowCount) continue;
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO products (seller_id, category_id, title, description, price, stock, city, status, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'Pointe-Noire', 'published', now() - make_interval(mins => $7))
         RETURNING id`,
        [
          shopIds[p.shop],
          CATEGORY_IDS[p.category],
          p.title,
          p.description,
          p.price,
          p.stock,
          index * 37,
        ],
      );
      if (storage) {
        const key = `products/demo/${p.slug}.jpg`;
        await storage.put(
          'public',
          key,
          await readFile(`${DEMO_DIR}images/${p.slug}.jpg`),
          'image/jpeg',
        );
        await tx.query(
          'INSERT INTO product_media (product_id, storage_key, position, width, height) VALUES ($1, $2, 0, 600, 600)',
          [rows[0]!.id, key],
        );
      }
    }
  });
  console.log(
    storage
      ? 'Données de démonstration chargées.'
      : 'Données de démonstration chargées SANS photos (définir LOCAL_STORAGE_DIR ou STORAGE_DRIVER=s3).',
  );
} finally {
  await pool.end();
}
