import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { VARIANTS, variantKey, type VariantName } from '../modules/media/variants.js';

/**
 * Après un changement de réglage des déclinaisons (VARIANTS) : remet en file les photos dont les
 * déclinaisons ne correspondent plus, ainsi que celles en échec. Le worker les refait ; l'original
 * s'affiche en attendant. Usage : node dist/cli/reprocess-media.js
 */
const pool = createPool(loadConfig().databaseUrl);
const { rows } = await pool.query<{
  id: string;
  storage_key: string;
  variants: Partial<Record<VariantName, { key: string }>> | null;
}>(
  `SELECT id, storage_key, variants FROM product_media WHERE processing_status IN ('ready', 'failed')`,
);
const stale = rows
  .filter(
    (m) =>
      !m.variants ||
      (Object.keys(VARIANTS) as VariantName[]).some(
        (name) => m.variants![name]?.key !== variantKey(m.storage_key, name),
      ),
  )
  .map((m) => m.id);
if (stale.length) {
  await pool.query(
    `UPDATE product_media SET processing_status = 'pending', variants = NULL,
       processing_attempts = 0, processing_after = NULL, processing_error = NULL
     WHERE id = ANY($1::uuid[])`,
    [stale],
  );
}
console.log(`${stale.length} photo(s) remise(s) en file sur ${rows.length}.`);
await pool.end();
