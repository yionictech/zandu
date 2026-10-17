import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Bucket, ObjectStorage, StoredObject, UploadInstructions } from './storage.js';

export interface S3StorageConfig {
  endpoint?: string | undefined;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  buckets: Record<Bucket, string>;
  /** Base des URL publiques (CDN devant le compartiment public). */
  publicBaseUrl: string;
}

/**
 * Adaptateur S3. L'envoi se fait par « presigned POST » : la politique signée impose le
 * type de contenu et une taille maximale, que le stockage vérifie lui-même.
 */
export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async presignUpload(input: {
    bucket: Bucket;
    key: string;
    contentType: string;
    maxBytes: number;
    expiresInSeconds: number;
  }): Promise<UploadInstructions> {
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: this.config.buckets[input.bucket],
      Key: input.key,
      Conditions: [
        ['content-length-range', 1, input.maxBytes],
        ['eq', '$Content-Type', input.contentType],
      ],
      Fields: { 'Content-Type': input.contentType },
      Expires: input.expiresInSeconds,
    });
    return {
      method: 'POST',
      url,
      fields,
      headers: {},
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  presignDownload(input: {
    bucket: Bucket;
    key: string;
    expiresInSeconds: number;
  }): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.buckets[input.bucket], Key: input.key }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  async head(input: { bucket: Bucket; key: string }): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.buckets[input.bucket], Key: input.key }),
      );
      return { size: result.ContentLength ?? 0, contentType: result.ContentType ?? '' };
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
        return null;
      throw error;
    }
  }

  publicUrl(key: string): string {
    return `${this.config.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
}
