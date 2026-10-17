import { randomUUID } from 'node:crypto';
import type { AppContext } from '../../context.js';
import type { Tx } from '../../db/pool.js';
import { addHours, addSeconds } from '../../lib/clock.js';
import { HttpError } from '../../lib/errors.js';
import type { Bucket, UploadInstructions } from '../storage/storage.js';

export type UploadPurpose = 'product_photo' | 'kyc_document' | 'dispute_evidence';

interface PurposeRule {
  bucket: Bucket;
  prefix: string;
  contentTypes: Record<string, string>;
  maxBytes: number;
}

const IMAGES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * Règles par usage. Les photos produits sont compressées sur le téléphone avant l'envoi
 * (≈ 200-400 Ko) : 2 Mo est une limite large. Les pièces KYC peuvent être des PDF.
 */
export const UPLOAD_RULES: Record<UploadPurpose, PurposeRule> = {
  product_photo: {
    bucket: 'public',
    prefix: 'products',
    contentTypes: IMAGES,
    maxBytes: 2 * 1024 * 1024,
  },
  kyc_document: {
    bucket: 'private',
    prefix: 'kyc',
    contentTypes: { ...IMAGES, 'application/pdf': 'pdf' },
    maxBytes: 5 * 1024 * 1024,
  },
  dispute_evidence: {
    bucket: 'private',
    prefix: 'disputes',
    contentTypes: IMAGES,
    maxBytes: 3 * 1024 * 1024,
  },
};

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const MAX_UPLOADS_PER_HOUR = 60;
/** Délai pour rattacher un fichier envoyé (brouillon terminé hors ligne puis synchronisé). */
const ATTACH_WINDOW_HOURS = 24;

export interface ReservedUpload extends UploadInstructions {
  uploadId: string;
  maxBytes: number;
}

/** Réserve un envoi et renvoie l'URL signée sur laquelle le téléphone dépose le fichier. */
export async function reserveUpload(
  ctx: AppContext,
  tx: Tx,
  input: { userId: string; purpose: UploadPurpose; contentType: string; sizeBytes: number },
): Promise<ReservedUpload> {
  const rule = UPLOAD_RULES[input.purpose];
  const extension = rule.contentTypes[input.contentType];
  if (!extension) {
    throw new HttpError(422, 'unsupported_file_type', 'Type de fichier non accepté', {
      accepted: Object.keys(rule.contentTypes),
    });
  }
  if (input.sizeBytes > rule.maxBytes) {
    throw new HttpError(422, 'file_too_large', 'Fichier trop volumineux', {
      maxBytes: rule.maxBytes,
    });
  }
  const now = ctx.clock.now();
  const { rows } = await tx.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM uploads WHERE user_id = $1 AND created_at > $2',
    [input.userId, addHours(now, -1)],
  );
  if (rows[0]!.n >= MAX_UPLOADS_PER_HOUR) {
    throw new HttpError(
      429,
      'upload_rate_limited',
      "Trop d'envois de fichiers, réessayez plus tard",
    );
  }

  const key = `${rule.prefix}/${input.userId}/${randomUUID()}.${extension}`;
  const { rows: created } = await tx.query<{ id: string }>(
    `INSERT INTO uploads (user_id, purpose, bucket, storage_key, content_type, max_bytes, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.userId,
      input.purpose,
      rule.bucket,
      key,
      input.contentType,
      rule.maxBytes,
      addSeconds(now, UPLOAD_URL_TTL_SECONDS),
      now,
    ],
  );
  const instructions = await ctx.storage.presignUpload({
    bucket: rule.bucket,
    key,
    contentType: input.contentType,
    maxBytes: rule.maxBytes,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  });
  return { uploadId: created[0]!.id, maxBytes: rule.maxBytes, ...instructions };
}

export interface ConsumedUpload {
  id: string;
  bucket: Bucket;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Rattache un envoi à son usage final. Vérifie : qu'il appartient à l'utilisateur, qu'il a
 * le bon usage, qu'il n'a jamais servi, et que le fichier existe vraiment avec le type et
 * une taille conformes. Un envoi ne sert qu'une fois.
 */
export async function consumeUpload(
  ctx: AppContext,
  tx: Tx,
  input: { uploadId: string; userId: string; purpose: UploadPurpose },
): Promise<ConsumedUpload> {
  const { rows } = await tx.query<{
    bucket: Bucket;
    storage_key: string;
    content_type: string;
    max_bytes: number;
    consumed_at: Date | null;
    created_at: Date;
  }>(
    `SELECT bucket, storage_key, content_type, max_bytes, consumed_at, created_at FROM uploads
     WHERE id = $1 AND user_id = $2 AND purpose = $3::upload_purpose FOR UPDATE`,
    [input.uploadId, input.userId, input.purpose],
  );
  const upload = rows[0];
  if (!upload) throw new HttpError(404, 'upload_not_found', 'Fichier introuvable');
  if (upload.consumed_at)
    throw new HttpError(409, 'upload_already_used', 'Ce fichier est déjà utilisé');
  if (addHours(upload.created_at, ATTACH_WINDOW_HOURS) < ctx.clock.now()) {
    throw new HttpError(410, 'upload_expired', 'Envoi trop ancien : renvoyez le fichier');
  }

  const object = await ctx.storage.head({ bucket: upload.bucket, key: upload.storage_key });
  if (!object)
    throw new HttpError(409, 'upload_missing', "Le fichier n'a pas été reçu : renvoyez-le");
  if (object.size > upload.max_bytes || object.contentType !== upload.content_type) {
    throw new HttpError(422, 'upload_invalid', 'Fichier non conforme (type ou taille)');
  }
  await tx.query('UPDATE uploads SET consumed_at = $2, size_bytes = $3 WHERE id = $1', [
    input.uploadId,
    ctx.clock.now(),
    object.size,
  ]);
  return {
    id: input.uploadId,
    bucket: upload.bucket,
    storageKey: upload.storage_key,
    contentType: upload.content_type,
    sizeBytes: object.size,
  };
}
