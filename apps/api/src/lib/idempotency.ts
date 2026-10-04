import type { Tx } from '../db/pool.js';
import { sha256, stableStringify } from './crypto.js';
import { HttpError } from './errors.js';

export interface IdempotencyRequest {
  userId: string;
  key: string | undefined;
  method: string;
  path: string;
  body: unknown;
}

/**
 * Réserve la clé Idempotency-Key dans la transaction courante.
 * - Clé nouvelle : renvoie null ; l'appelant exécute l'opération puis appelle completeIdempotency.
 * - Clé déjà utilisée avec le même corps : renvoie l'identifiant de la ressource créée la 1re fois.
 * - Clé réutilisée avec un autre corps : erreur 422.
 * Deux requêtes simultanées avec la même clé se sérialisent sur la clé primaire.
 */
export async function claimIdempotency(tx: Tx, req: IdempotencyRequest): Promise<string | null> {
  if (!req.key || req.key.length < 8 || req.key.length > 128) {
    throw new HttpError(
      400,
      'idempotency_key_required',
      'En-tête Idempotency-Key requis (8 à 128 caractères)',
    );
  }
  const requestHash = sha256(stableStringify(req.body ?? null));
  const inserted = await tx.query(
    `INSERT INTO idempotency_keys (user_id, key, method, path, request_hash)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
    [req.userId, req.key, req.method, req.path, requestHash],
  );
  if (inserted.rowCount === 1) return null;

  const { rows } = await tx.query<{
    request_hash: string;
    path: string;
    response_body: { resourceId: string } | null;
  }>(
    'SELECT request_hash, path, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2',
    [req.userId, req.key],
  );
  const existing = rows[0];
  if (
    !existing ||
    existing.request_hash !== requestHash ||
    existing.path !== req.path ||
    !existing.response_body
  ) {
    throw new HttpError(
      422,
      'idempotency_key_reused',
      'Cette clé a déjà servi pour une autre requête',
    );
  }
  return existing.response_body.resourceId;
}

export async function completeIdempotency(
  tx: Tx,
  userId: string,
  key: string,
  resourceId: string,
  status = 201,
): Promise<void> {
  await tx.query(
    'UPDATE idempotency_keys SET response_status = $3, response_body = $4 WHERE user_id = $1 AND key = $2',
    [userId, key, status, { resourceId }],
  );
}
