import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPool, withTx, type Pool } from './pool.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../db/migrations/', import.meta.url));

/** Applique dans l'ordre les fichiers db/migrations/*.sql pas encore appliqués. */
export async function migrate(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    const sql = await readFile(`${dir}${file}`, 'utf8');
    const done = await withTx(pool, async (tx) => {
      // Verrou consultatif : deux instances qui démarrent ensemble ne migrent pas en parallèle.
      await tx.query('SELECT pg_advisory_xact_lock(4242)');
      const { rowCount } = await tx.query('SELECT 1 FROM schema_migrations WHERE name = $1', [
        file,
      ]);
      if (rowCount) return false;
      await tx.query(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      return true;
    });
    if (done) applied.push(file);
  }
  return applied;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool(
    process.env.DATABASE_URL ?? 'postgres://zandu:zandu@localhost:5432/zandu',
  );
  migrate(pool)
    .then((applied) =>
      console.log(
        applied.length ? `Migrations appliquées : ${applied.join(', ')}` : 'Base à jour.',
      ),
    )
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
