import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processProductMedia } from '../src/modules/media/media.service.js';
import { variantKey } from '../src/modules/media/variants.js';
import {
  call,
  createTestEnv,
  setupMarketplace,
  uploadFile,
  type Marketplace,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
let m: Marketplace;
let photo: Buffer;

/**
 * Photo comparable à celle qu'envoie l'application : 1600 × 1200, JPEG ≈ 280 Ko, prise téléphone
 * tourné (orientation EXIF 6 : à afficher en portrait), avec métadonnées d'appareil.
 */
async function phonePhoto(): Promise<Buffer> {
  return sharp({
    create: {
      width: 1600,
      height: 1200,
      channels: 3,
      background: '#808080',
      noise: { type: 'gaussian', mean: 128, sigma: 60 },
    },
  })
    .blur(2)
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD0: { Make: 'Tecno', Model: 'Spark 20' } })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function addPhoto(body: Buffer): Promise<void> {
  const uploadId = await uploadFile(env, m.seller, 'product_photo', { body });
  const res = await call(env, m.seller, {
    method: 'POST',
    url: `/v1/seller/products/${m.productId}/photos`,
    payload: { uploadId },
  });
  expect(res.status).toBe(201);
}

const cover = async () =>
  (await call(env, null, { method: 'GET', url: '/v1/products?limit=5' })).body.items[0]
    .coverImage as string | null;
const mediaRow = async () =>
  (
    await env.pool.query<{
      storage_key: string;
      processing_status: string;
      processing_attempts: number;
      width: number | null;
      height: number | null;
    }>(
      'SELECT storage_key, processing_status, processing_attempts, width, height FROM product_media',
    )
  ).rows[0]!;
const stored = async (key: string) => (await env.storage.download('public', key))!;

beforeAll(async () => {
  env = await createTestEnv();
  photo = await phonePhoto();
});
afterAll(async () => env.close());
beforeEach(async () => {
  m = await setupMarketplace(env);
});

describe('Déclinaisons des photos produits', () => {
  it('vignette légère pour les listes, grande image pour la fiche, JPEG pour le partage', async () => {
    await addPhoto(photo);
    const { storage_key: original } = await mediaRow();
    // Avant le passage du worker : l'original, pour ne jamais afficher de trou.
    expect(await cover()).toBe(env.storage.publicUrl(original));

    expect(await processProductMedia(env.ctx)).toBe(1);
    expect(await processProductMedia(env.ctx)).toBe(0); // rien à refaire
    const row = await mediaRow();
    expect(row).toMatchObject({ processing_status: 'ready', width: 1200, height: 1600 });

    // Les listes reçoivent la vignette : 240 × 320 (téléphone redressé), quelques Ko.
    expect(await cover()).toBe(env.storage.publicUrl(variantKey(original, 'thumb')));
    expect(variantKey(original, 'thumb')).toMatch(/-thumb320\.webp$/);
    const thumb = await stored(variantKey(original, 'thumb'));
    expect(await sharp(thumb).metadata()).toMatchObject({
      format: 'webp',
      width: 240,
      height: 320,
    });
    expect(thumb.length).toBeLessThan(photo.length / 10);

    const detail = await call(env, null, { method: 'GET', url: `/v1/products/${m.productId}` });
    expect(detail.body.media).toEqual([
      { url: env.storage.publicUrl(variantKey(original, 'large')), width: 600, height: 800 },
    ]);
    expect(detail.body.shareImage).toBe(env.storage.publicUrl(variantKey(original, 'share')));
    const share = await sharp(await stored(variantKey(original, 'share'))).metadata();
    expect(share).toMatchObject({ format: 'jpeg', width: 900, height: 1200 });

    // Aucune métadonnée de l'appareil (ni position GPS) dans ce qui est servi au public.
    for (const name of ['thumb', 'large', 'share'] as const) {
      const meta = await sharp(await stored(variantKey(original, name))).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
    }

    // Le vendeur voit ses vignettes ; la modération, les grandes images.
    const own = await call(env, m.seller, {
      method: 'GET',
      url: `/v1/seller/products/${m.productId}`,
    });
    expect(own.body.photos[0].url).toBe(env.storage.publicUrl(variantKey(original, 'thumb')));
  });

  it('un fichier qui n’est pas une image n’est jamais affiché ni retenté', async () => {
    await addPhoto(Buffer.from('<html><script>alert(1)</script></html>'.padEnd(2048, ' ')));
    await processProductMedia(env.ctx);
    expect(await mediaRow()).toMatchObject({
      processing_status: 'invalid',
      processing_attempts: 1,
    });
    expect(await cover()).toBeNull();
    const detail = await call(env, null, { method: 'GET', url: `/v1/products/${m.productId}` });
    expect(detail.body.media).toEqual([]);
    expect(detail.body.shareImage).toBeNull();
    expect(await processProductMedia(env.ctx)).toBe(0);
  });

  it('stockage indisponible : nouvelles tentatives espacées, puis l’original reste affiché', async () => {
    await addPhoto(photo);
    const { storage_key: original } = await mediaRow();
    const download = env.storage.download.bind(env.storage);
    env.storage.download = async () => {
      throw new Error('Stockage injoignable');
    };
    try {
      await processProductMedia(env.ctx);
      expect(await mediaRow()).toMatchObject({
        processing_status: 'pending',
        processing_attempts: 1,
      });
      expect(await processProductMedia(env.ctx)).toBe(0); // pas avant la prochaine échéance
      for (const minutes of [1, 5, 15, 60]) {
        env.clock.advanceMinutes(minutes);
        expect(await processProductMedia(env.ctx)).toBe(1);
      }
      expect(await mediaRow()).toMatchObject({
        processing_status: 'failed',
        processing_attempts: 5,
      });
      expect(await cover()).toBe(env.storage.publicUrl(original));
    } finally {
      env.storage.download = download;
    }
  });
});
