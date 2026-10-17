import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { S3Storage } from '../src/modules/storage/s3-storage.js';
import {
  CATEGORIES,
  addProduct,
  buyAndDeliver,
  call,
  createTestEnv,
  login,
  openShop,
  setupMarketplace,
  uploadFile,
  type Marketplace,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
let m: Marketplace;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  m = await setupMarketplace(env);
});

describe('Photos produits (F3)', () => {
  it('envoi direct au stockage, rattachement, puis affichage dans le catalogue', async () => {
    const uploadId = await uploadFile(env, m.seller, 'product_photo');
    const attached = await call(env, m.seller, {
      method: 'POST',
      url: `/v1/seller/products/${m.productId}/photos`,
      payload: { uploadId },
    });
    expect(attached.status).toBe(201);
    expect(attached.body.photos).toHaveLength(1);
    const url: string = attached.body.photos[0].url;
    expect(url).toMatch(/^http:\/\/api\.test\/dev\/storage\/public\/products\/.+\.jpg$/);

    const detail = await call(env, null, { method: 'GET', url: `/v1/products/${m.productId}` });
    expect(detail.body.coverImage).toBe(url);
    expect(detail.body.media).toEqual([{ url, width: null, height: null }]);
    const card = await call(env, null, { method: 'GET', url: '/v1/products' });
    expect(card.body.items[0].coverImage).toBe(url);

    const served = await env.app.inject({ method: 'GET', url: new URL(url).pathname });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
  });

  it('refuse type, taille, fichier absent, réutilisation et envoi d’un autre utilisateur', async () => {
    const bad = (payload: object) =>
      call(env, m.seller, { method: 'POST', url: '/v1/uploads', payload });
    expect(
      (await bad({ purpose: 'product_photo', contentType: 'image/gif', sizeBytes: 10 })).body.error
        .code,
    ).toBe('unsupported_file_type');
    expect(
      (await bad({ purpose: 'product_photo', contentType: 'image/jpeg', sizeBytes: 5_000_000 }))
        .body.error.code,
    ).toBe('file_too_large');
    const buyerTry = await call(env, m.buyer, {
      method: 'POST',
      url: '/v1/uploads',
      payload: { purpose: 'product_photo', contentType: 'image/jpeg', sizeBytes: 10 },
    });
    expect(buyerTry.status).toBe(403);

    // Réservé mais jamais déposé.
    const reserved = await bad({
      purpose: 'product_photo',
      contentType: 'image/jpeg',
      sizeBytes: 100,
    });
    const attach = (uploadId: string, who = m.seller) =>
      call(env, who, {
        method: 'POST',
        url: `/v1/seller/products/${m.productId}/photos`,
        payload: { uploadId },
      });
    expect((await attach(reserved.body.uploadId)).body.error.code).toBe('upload_missing');

    // Déposé avec un autre type que celui annoncé.
    const mismatch = await bad({
      purpose: 'product_photo',
      contentType: 'image/png',
      sizeBytes: 100,
    });
    await env.app.inject({
      method: 'PUT',
      url: new URL(mismatch.body.url).pathname,
      headers: { 'content-type': 'image/jpeg' },
      payload: Buffer.alloc(100),
    });
    expect((await attach(mismatch.body.uploadId)).body.error.code).toBe('upload_invalid');

    const ok = await uploadFile(env, m.seller, 'product_photo');
    const rival = await openShop(env, m.admin, '06 444 44 44');
    expect((await attach(ok, rival)).status).toBe(404); // le produit et l'envoi ne sont pas à lui
    expect((await attach(ok)).status).toBe(201);
    expect((await attach(ok)).body.error.code).toBe('upload_already_used');
  });

  it('6 photos au maximum ; suppression possible', async () => {
    for (let i = 0; i < 6; i++) {
      const uploadId = await uploadFile(env, m.seller, 'product_photo');
      await call(env, m.seller, {
        method: 'POST',
        url: `/v1/seller/products/${m.productId}/photos`,
        payload: { uploadId },
      });
    }
    const seventh = await uploadFile(env, m.seller, 'product_photo');
    const refused = await call(env, m.seller, {
      method: 'POST',
      url: `/v1/seller/products/${m.productId}/photos`,
      payload: { uploadId: seventh },
    });
    expect(refused.body.error.code).toBe('too_many_photos');

    const detail = await call(env, null, { method: 'GET', url: `/v1/products/${m.productId}` });
    expect(detail.body.media).toHaveLength(6);
    const list = await call(env, m.seller, { method: 'GET', url: '/v1/seller/products' });
    expect(list.body.items[0].photoCount).toBe(6);
    const { rows } = await env.pool.query<{ id: string }>(
      'SELECT id FROM product_media ORDER BY position LIMIT 1',
    );
    const removed = await call(env, m.seller, {
      method: 'DELETE',
      url: `/v1/seller/products/${m.productId}/photos/${rows[0]!.id}`,
    });
    expect(removed.body.photos).toHaveLength(5);
  });
});

describe('Gestion des produits par le vendeur', () => {
  it('modifier, archiver et remettre en vente', async () => {
    const edited = await call(env, m.seller, {
      method: 'PATCH',
      url: `/v1/seller/products/${m.productId}`,
      payload: { price: 45_000, stock: 9 },
    });
    expect(edited.body).toMatchObject({ price: 45_000, stock: 9, status: 'published' });

    await call(env, m.seller, {
      method: 'PATCH',
      url: `/v1/seller/products/${m.productId}`,
      payload: { status: 'archived' },
    });
    expect((await call(env, null, { method: 'GET', url: '/v1/products' })).body.items).toHaveLength(
      0,
    );
    const back = await call(env, m.seller, {
      method: 'PATCH',
      url: `/v1/seller/products/${m.productId}`,
      payload: { status: 'published' },
    });
    expect(back.body.status).toBe('published');
  });

  it('un vendeur non vérifié repasse en modération quand il change le contenu', async () => {
    const newcomer = await openShop(env, m.admin, '06 333 33 33', false);
    const productId = await addProduct(env, newcomer, { title: 'Sac en raphia' });
    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/admin/products/${productId}/moderation`,
      payload: { decision: 'published' },
    });
    const priceOnly = await call(env, newcomer, {
      method: 'PATCH',
      url: `/v1/seller/products/${productId}`,
      payload: { price: 19_000 },
    });
    expect(priceOnly.body.status).toBe('published');
    const retitled = await call(env, newcomer, {
      method: 'PATCH',
      url: `/v1/seller/products/${productId}`,
      payload: { title: 'Sac en raphia tressé main' },
    });
    expect(retitled.body.status).toBe('pending_review');
  });

  it('« Vous recevrez » : aperçu de la commission pendant la saisie du prix', async () => {
    const maison = await call(env, m.seller, {
      method: 'GET',
      url: `/v1/seller/commission-preview?categoryId=${CATEGORIES.maison}&price=50000`,
    });
    expect(maison.body).toEqual({ rateBps: 1000, commission: 5000, net: 45000 });
    const phone = await call(env, m.seller, {
      method: 'GET',
      url: `/v1/seller/commission-preview?categoryId=${CATEGORIES.telephones}&price=50000`,
    });
    expect(phone.body).toMatchObject({ rateBps: 800, net: 46000 }); // 8 % hérité d'« Électronique »
  });
});

describe('Vérification des vendeurs (F2)', () => {
  it('dossier complet → file du support → pièces consultées (journalisé) → vérifié', async () => {
    const newcomer = await openShop(env, m.admin, '06 333 33 33', false);
    const kyc = (type: string, uploadId: string) =>
      call(env, newcomer, {
        method: 'POST',
        url: '/v1/seller/kyc-documents',
        payload: { type, uploadId },
      });

    const first = await kyc(
      'national_id',
      await uploadFile(env, newcomer, 'kyc_document', { contentType: 'application/pdf' }),
    );
    expect(first.body).toMatchObject({ verificationStatus: 'unverified', missing: ['selfie'] });
    const second = await kyc('selfie', await uploadFile(env, newcomer, 'kyc_document'));
    expect(second.body).toMatchObject({ verificationStatus: 'pending_review', missing: [] });

    const queue = await call(env, m.admin, { method: 'GET', url: '/v1/admin/sellers' });
    expect(queue.body.items).toEqual([
      expect.objectContaining({ id: newcomer.sellerId, pendingDocuments: 2 }),
    ]);
    const documents = await call(env, m.admin, {
      method: 'GET',
      url: `/v1/admin/sellers/${newcomer.sellerId}/kyc-documents`,
    });
    expect(documents.body.items).toHaveLength(2);
    expect(documents.body.items[0].url).toMatch(/\/dev\/storage\/private\/kyc\//);
    const viewed = await env.pool.query(
      `SELECT 1 FROM audit_logs WHERE action = 'seller.kyc_viewed'`,
    );
    expect(viewed.rowCount).toBe(1);

    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/admin/sellers/${newcomer.sellerId}/verification`,
      payload: { decision: 'verified' },
    });
    const after = await call(env, newcomer, { method: 'GET', url: '/v1/seller/kyc' });
    expect(after.body.verificationStatus).toBe('verified');
    expect(after.body.documents.map((d: { status: string }) => d.status)).toEqual([
      'accepted',
      'accepted',
    ]);
    expect(
      (await kyc('passport', await uploadFile(env, newcomer, 'kyc_document'))).body.error.code,
    ).toBe('kyc_closed');
  });

  it('les pièces KYC vont dans le compartiment privé', async () => {
    const reserved = await call(env, m.seller, {
      method: 'POST',
      url: '/v1/uploads',
      payload: { purpose: 'kyc_document', contentType: 'application/pdf', sizeBytes: 1000 },
    });
    expect(reserved.body.url).toMatch(/\/dev\/storage\/private\/kyc\//);
  });
});

describe('Avis vérifiés (F11) et preuves de litige (F12)', () => {
  it('seul l’acheteur livré note, une seule fois ; la note du vendeur est recalculée', async () => {
    const orderId = await buyAndDeliver(env, m);
    const order = await call(env, m.buyer, { method: 'GET', url: `/v1/orders/${orderId}` });
    const itemId: string = order.body.items[0].itemId;
    expect(order.body.items[0].reviewed).toBe(false);

    const intruder = await login(env, '05 777 77 77');
    expect(
      (
        await call(env, intruder, {
          method: 'POST',
          url: `/v1/order-items/${itemId}/review`,
          payload: { rating: 1 },
        })
      ).status,
    ).toBe(404);
    const review = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/order-items/${itemId}/review`,
      payload: { rating: 4, comment: 'Bon ventilateur, livré vite.' },
    });
    expect(review.status).toBe(201);
    const again = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/order-items/${itemId}/review`,
      payload: { rating: 5 },
    });
    expect(again.body.error.code).toBe('already_reviewed');

    const listed = await call(env, null, {
      method: 'GET',
      url: `/v1/products/${m.productId}/reviews`,
    });
    expect(listed.body.items).toEqual([
      expect.objectContaining({ rating: 4, comment: 'Bon ventilateur, livré vite.' }),
    ]);
    const detail = await call(env, null, { method: 'GET', url: `/v1/products/${m.productId}` });
    expect(detail.body.reviews).toEqual({ average: 4, count: 1 });
    expect(detail.body.seller).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
  });

  it('refuse un avis avant la réception', async () => {
    const co = await call(env, m.buyer, {
      method: 'POST',
      url: '/v1/checkouts',
      headers: { 'idempotency-key': 'avis-avant-reception' },
      payload: {
        items: [{ productId: m.productId, quantity: 1 }],
        delivery: {
          mode: 'home',
          zoneId: '20000000-0000-4000-8000-000000000003',
          recipientName: 'Grâce',
          phone: '05 555 55 55',
          landmark: 'Tié-Tié, portail bleu',
        },
      },
    });
    const itemId: string = co.body.orders[0].items[0].itemId;
    const early = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/order-items/${itemId}/review`,
      payload: { rating: 5 },
    });
    expect(early.body.error.code).toBe('not_delivered');
  });

  it('photos jointes à un litige, consultées par le support', async () => {
    const orderId = await buyAndDeliver(env, m);
    const dispute = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/orders/${orderId}/disputes`,
      payload: { reason: 'damaged', description: 'Le pied du ventilateur est fendu.' },
    });
    const photo = await uploadFile(env, m.buyer, 'dispute_evidence');
    const added = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/disputes/${dispute.body.id}/evidence`,
      payload: { uploadId: photo },
    });
    expect(added.status).toBe(201);

    const queue = await call(env, m.admin, { method: 'GET', url: '/v1/support/disputes' });
    expect(queue.body.items).toEqual([expect.objectContaining({ id: dispute.body.id, orderId })]);
    const detail = await call(env, m.admin, {
      method: 'GET',
      url: `/v1/support/disputes/${dispute.body.id}`,
    });
    expect(detail.body.evidence).toHaveLength(1);
    expect(detail.body.evidence[0].url).toMatch(/\/dev\/storage\/private\/disputes\//);
    expect(detail.body.order.publicRef).toMatch(/^ZD-/);
  });
});

describe('Web et stockage S3', () => {
  it('CORS : le site web peut appeler l’API (pré-vérification)', async () => {
    const res = await env.app.inject({
      method: 'OPTIONS',
      url: '/v1/products',
      headers: {
        origin: 'http://localhost:8081',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'idempotency-key',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    expect(String(res.headers['access-control-allow-headers'])).toContain('idempotency-key');
  });

  it('adaptateur S3 : politique d’envoi signée (type et taille imposés), lien de lecture signé', async () => {
    const s3 = new S3Storage({
      endpoint: 'https://s3.exemple.test',
      region: 'eu-west-3',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secret',
      forcePathStyle: true,
      buckets: { public: 'zandu-public', private: 'zandu-private' },
      publicBaseUrl: 'https://media.exemple.test/',
    });
    const upload = await s3.presignUpload({
      bucket: 'public',
      key: 'products/u/x.jpg',
      contentType: 'image/jpeg',
      maxBytes: 2048,
      expiresInSeconds: 900,
    });
    expect(upload.method).toBe('POST');
    expect(upload.url).toBe('https://s3.exemple.test/zandu-public');
    expect(upload.fields).toMatchObject({ key: 'products/u/x.jpg', 'Content-Type': 'image/jpeg' });
    const policy = JSON.parse(Buffer.from(upload.fields.Policy!, 'base64').toString('utf8'));
    expect(policy.conditions).toContainEqual(['content-length-range', 1, 2048]);
    const download = await s3.presignDownload({
      bucket: 'private',
      key: 'kyc/u/id.pdf',
      expiresInSeconds: 300,
    });
    expect(download).toMatch(
      /^https:\/\/s3\.exemple\.test\/zandu-private\/kyc\/u\/id\.pdf\?.*X-Amz-Signature=/,
    );
    expect(s3.publicUrl('products/u/x.jpg')).toBe('https://media.exemple.test/products/u/x.jpg');
  });
});
