import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/**
 * Port vers le stockage objet (compatible S3 : AWS S3, SeaweedFS, Scaleway, Cloudflare R2…).
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
  /**
   * Dépôt direct par le serveur (déclinaisons des photos, démonstration, vérification).
   * `cacheControl` : en-tête servi avec l'objet (ex. contenu immuable, mis en cache un an).
   */
  put(
    bucket: Bucket,
    key: string,
    body: Buffer,
    contentType: string,
    cacheControl?: string,
  ): Promise<void>;
  /** Contenu d'un objet, ou null s'il n'existe pas. */
  download(bucket: Bucket, key: string): Promise<Buffer | null>;
  /** URL publique (CDN) d'un objet du compartiment public. */
  publicUrl(key: string): string;
}

interface MemoryObject extends StoredObject {
  body: Buffer;
}

/**
 * Stockage de développement et de test. En mémoire par défaut ; avec un dossier (`dir`), les
 * fichiers sont aussi écrits sur disque et survivent au redémarrage de l'API.
 * Les envois passent par une route de développement de l'API (`/dev/storage/...`).
 */
export class MemoryStorage implements ObjectStorage {
  private readonly objects = new Map<string, MemoryObject>();

  constructor(
    private readonly apiBaseUrl: string,
    private readonly dir: string | null = null,
  ) {}

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
    const object = await this.get(input.bucket, input.key);
    return object ? { size: object.size, contentType: object.contentType } : null;
  }

  publicUrl(key: string): string {
    return `${this.apiBaseUrl}/dev/storage/public/${key}`;
  }

  async put(bucket: Bucket, key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(`${bucket}/${key}`, { body, size: body.length, contentType });
    if (this.dir) {
      const file = this.fileFor(bucket, key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, body);
      await writeFile(`${file}.type`, contentType);
    }
  }

  async download(bucket: Bucket, key: string): Promise<Buffer | null> {
    return (await this.get(bucket, key))?.body ?? null;
  }

  async get(bucket: Bucket, key: string): Promise<MemoryObject | undefined> {
    const cached = this.objects.get(`${bucket}/${key}`);
    if (cached || !this.dir) return cached;
    try {
      const file = this.fileFor(bucket, key);
      const body = await readFile(file);
      const contentType = await readFile(`${file}.type`, 'utf8');
      return { body, size: body.length, contentType };
    } catch {
      return undefined;
    }
  }

  private fileFor(bucket: Bucket, key: string): string {
    const file = resolve(this.dir!, bucket, key);
    // Défense en profondeur : une clé ne sort jamais du dossier de stockage.
    if (!file.startsWith(resolve(this.dir!, bucket) + sep))
      throw new Error(`Clé invalide : ${key}`);
    return file;
  }
}
