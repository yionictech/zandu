import type { AppContext } from '../../context.js';
import { withTx } from '../../db/pool.js';
import { InvalidImageError, renderVariants, variantKey, type VariantName } from './variants.js';

/** Stockage des déclinaisons : leur clé ne change jamais, le CDN et les téléphones les gardent un an. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
const BATCH = 10;
/** Stockage indisponible : nouvelles tentatives espacées, puis l'original reste affiché. */
const RETRY_MINUTES = [1, 5, 15, 60];
const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;

export interface StoredVariant {
  key: string;
  width: number;
  height: number;
  bytes: number;
}

/** Photo affichable : tout sauf un fichier reconnu comme n'étant pas une image. */
export const DISPLAYABLE = `m.processing_status <> 'invalid'`;

/** Clé de la vignette de couverture d'un produit `p` (l'original tant qu'elle n'est pas prête). */
export const COVER_KEY_SQL = `(SELECT coalesce(m.variants->'thumb'->>'key', m.storage_key)
   FROM product_media m WHERE m.product_id = p.id AND ${DISPLAYABLE}
   ORDER BY m.position LIMIT 1)`;

/** Clé d'une déclinaison de la photo `m`, ou de l'original. */
export const variantKeySql = (name: VariantName): string =>
  `coalesce(m.variants->'${name}'->>'key', m.storage_key)`;

/**
 * Tâche de fond : décline les photos en attente, une transaction par photo (verrou de ligne :
 * plusieurs workers ne traitent jamais la même). Les déclinaisons sont écrites avant la mise à
 * jour de la ligne : en cas d'arrêt brutal, la photo est simplement retraitée.
 */
export async function processProductMedia(ctx: AppContext): Promise<number> {
  let processed = 0;
  while (processed < BATCH) {
    const found = await withTx(ctx.pool, async (tx) => {
      const now = ctx.clock.now();
      const { rows } = await tx.query<{ id: string; storage_key: string; attempts: number }>(
        `SELECT id, storage_key, processing_attempts AS attempts FROM product_media
         WHERE processing_status = 'pending' AND (processing_after IS NULL OR processing_after <= $1)
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [now],
      );
      const media = rows[0];
      if (!media) return false;
      try {
        const original = await ctx.storage.download('public', media.storage_key);
        // Introuvable : stockage incohérent ou mal partagé (développement sans LOCAL_STORAGE_DIR),
        // pas une preuve que le fichier est mauvais. On réessaie, puis l'original reste affiché.
        if (!original) throw new Error('Original introuvable dans le stockage');
        const rendered = await renderVariants(original);
        const variants: Partial<Record<VariantName, StoredVariant>> = {};
        for (const [name, variant] of Object.entries(rendered.variants) as Array<
          [VariantName, (typeof rendered.variants)[VariantName]]
        >) {
          const key = variantKey(media.storage_key, name);
          await ctx.storage.put('public', key, variant.body, variant.contentType, IMMUTABLE);
          variants[name] = {
            key,
            width: variant.width,
            height: variant.height,
            bytes: variant.body.length,
          };
        }
        await tx.query(
          `UPDATE product_media SET variants = $2, width = $3, height = $4,
             processing_status = 'ready', processing_error = NULL WHERE id = $1`,
          [media.id, JSON.stringify(variants), rendered.width, rendered.height],
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const attempts = media.attempts + 1;
        const status =
          error instanceof InvalidImageError
            ? 'invalid'
            : attempts >= MAX_ATTEMPTS
              ? 'failed'
              : 'pending';
        const retryAt =
          status === 'pending'
            ? new Date(now.getTime() + RETRY_MINUTES[attempts - 1]! * 60_000)
            : null;
        await tx.query(
          `UPDATE product_media SET processing_status = $2, processing_attempts = $3,
             processing_after = $4, processing_error = $5 WHERE id = $1`,
          [media.id, status, attempts, retryAt, message.slice(0, 500)],
        );
      }
      return true;
    });
    if (!found) break;
    processed++;
  }
  return processed;
}
