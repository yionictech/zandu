import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPool, type Db } from './pool.js';

const SEEDS_DIR = fileURLToPath(new URL('../../../../db/seeds/', import.meta.url));

/** Charge les données de référence (catégories, zones, tarifs, commissions). Idempotent. */
export async function seedReference(db: Db): Promise<void> {
  await db.query(await readFile(`${SEEDS_DIR}reference.sql`, 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool(
    process.env.DATABASE_URL ?? 'postgres://zandu:zandu@localhost:5432/zandu',
  );
  const { rowCount } = await pool.query('SELECT 1 FROM commission_rules LIMIT 1');
  if (rowCount) {
    console.log('Données de référence déjà présentes.');
  } else {
    await seedReference(pool);
    console.log('Données de référence chargées.');
  }
  await pool.end();
}
