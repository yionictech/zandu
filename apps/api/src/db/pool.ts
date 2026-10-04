import pg from 'pg';

// Les BIGINT (montants FCFA, count) arrivent en chaîne par défaut : on les convertit en
// nombre, en refusant toute valeur qui ne serait pas représentable exactement.
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`Entier hors limites : ${value}`);
  return n;
});

export type Pool = pg.Pool;
export type Tx = pg.PoolClient;
/** Tout ce qui sait exécuter une requête : le pool ou une transaction en cours. */
export interface Db {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
}

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}

/**
 * Exécute `fn` dans une transaction (READ COMMITTED). Les verrous de ligne
 * (SELECT … FOR UPDATE) sont pris explicitement par les services.
 */
export async function withTx<T>(pool: Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function one<T extends pg.QueryResultRow>(
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  if (rows.length !== 1) throw new Error(`Une ligne attendue, ${rows.length} obtenue(s)`);
  return rows[0]!;
}

export async function maybeOne<T extends pg.QueryResultRow>(
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0] ?? null;
}
