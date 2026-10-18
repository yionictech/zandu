import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://zandu:zandu@localhost:5432/zandu_test';

/** Repart d'un schéma vide et applique toutes les migrations, une fois par exécution. */
export default async function setup(): Promise<void> {
  const pool = createPool(TEST_DATABASE_URL);
  try {
    await pool.query(
      'DROP SCHEMA IF EXISTS simulator CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
    );
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
