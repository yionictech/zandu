/**
 * Port vers le stockage objet (compatible S3 : AWS S3, MinIO, Scaleway, Cloudflare R2…).
 * Deux compartiments : « public » (photos produits, servies par le CDN) et « private »
 * (pièces d'identité, preuves de litige : accessibles seulement par URL signée de courte durée).
 */
export type Bucket = 'public' | 'private';

/** Ce que l'application doit faire pour envoyer le fichier. */
export interface UploadInstructions {
  /** POST multipart (champs `fields` puis le fichier dans `file`) ou PUT du contenu brut. */
  method: 'POST' | 'PUT';
  url: string;
  fields: Record<string, string>;
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface StoredObject {
  size: number;
  contentType: string;
}

export interface ObjectStorage {
  presignUpload(input: {
    bucket: Bucket;
    key: string;
    contentType: string;
    maxBytes: number;
    expiresInSeconds: number;
  }): Promise<UploadInstructions>;
  presignDownload(input: {
    bucket: Bucket;
    key: string;
    expiresInSeconds: number;
  }): Promise<string>;
  head(input: { bucket: Bucket; key: string }): Promise<StoredObject | null>;
  /** URL publique (CDN) d'un objet du compartiment public. */
  publicUrl(key: string): string;
}

interface MemoryObject extends StoredObject {
  body: Buffer;
}

/**
 * Stockage en mémoire pour le développement et les tests (perdu au redémarrage).
 * Les envois passent par une route de développement de l'API (`/dev/storage/...`).
 */
export class MemoryStorage implements ObjectStorage {
  private readonly objects = new Map<string, MemoryObject>();

  constructor(private readonly apiBaseUrl: string) {}

  async presignUpload(input: {
    bucket: Bucket;
    key: string;
    contentType: string;
    maxBytes: number;
    expiresInSeconds: number;
  }): Promise<UploadInstructions> {
    return {
      method: 'PUT',
      url: `${this.apiBaseUrl}/dev/storage/${input.bucket}/${input.key}`,
      fields: {},
      headers: { 'content-type': input.contentType },
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async presignDownload(input: { bucket: Bucket; key: string }): Promise<string> {
    return `${this.apiBaseUrl}/dev/storage/${input.bucket}/${input.key}`;
  }

  async head(input: { bucket: Bucket; key: string }): Promise<StoredObject | null> {
    const object = this.objects.get(`${input.bucket}/${input.key}`);
    return object ? { size: object.size, contentType: object.contentType } : null;
  }

  publicUrl(key: string): string {
    return `${this.apiBaseUrl}/dev/storage/public/${key}`;
  }

  put(bucket: Bucket, key: string, body: Buffer, contentType: string): void {
    this.objects.set(`${bucket}/${key}`, { body, size: body.length, contentType });
  }

  get(bucket: Bucket, key: string): MemoryObject | undefined {
    return this.objects.get(`${bucket}/${key}`);
  }
}
