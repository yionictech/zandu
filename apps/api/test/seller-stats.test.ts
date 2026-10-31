import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buyAndDeliver,
  call,
  createTestEnv,
  setupMarketplace,
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

describe('Statistiques vendeur', () => {
  it('vues, ventes, produits phares, réactivité et conseils', async () => {
    for (let i = 0; i < 4; i++)
      expect(
        (await call(env, null, { method: 'POST', url: `/v1/products/${m.productId}/view` })).status,
      ).toBe(204);
    await buyAndDeliver(env, m);

    const stats = await call(env, m.seller, { method: 'GET', url: '/v1/seller/stats?period=7d' });
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({
      period: '7d',
      views: 4,
      orders: 1,
      unitsSold: 1,
      conversionPercent: 25,
      acceptanceRatePercent: 100,
      averageAcceptMinutes: 0,
    });
    expect(stats.body.sales).toBeGreaterThan(0);
    expect(stats.body.weekly).toHaveLength(8);
    expect(stats.body.weekly.at(-1)).toMatchObject({ orders: 1 });
    expect(stats.body.topProducts[0]).toMatchObject({ productId: m.productId, views: 4, sold: 1 });
    // Peu de vues : partager la boutique ; une seule photo : en ajouter.
    expect(stats.body.tips).toEqual(expect.arrayContaining(['share_shop', 'add_photos']));
  });

  it('réservé aux vendeurs ; vue d’un produit inconnu sans effet', async () => {
    expect((await call(env, m.buyer, { method: 'GET', url: '/v1/seller/stats' })).status).toBe(403);
    expect(
      (
        await call(env, null, {
          method: 'POST',
          url: '/v1/products/00000000-0000-4000-8000-000000000000/view',
        })
      ).status,
    ).toBe(204);
  });
});
