import type { MetadataRoute } from 'next';
import { catalog, SITE_URL } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Plan du site : accueil, chaque produit en vente, chaque boutique (jusqu'à 1 050 produits). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [{ url: `${SITE_URL}/`, changeFrequency: 'hourly' }];
  const shops = new Set<string>();
  for (let offset = 0; offset <= 1000; offset += 50) {
    const { items } = await catalog((api) =>
      api.GET('/v1/products', { params: { query: { sort: 'newest', limit: 50, offset } } }),
    );
    for (const p of items) {
      entries.push({ url: `${SITE_URL}/produit/${p.id}`, changeFrequency: 'daily' });
      shops.add(p.seller.slug);
    }
    if (items.length < 50) break;
  }
  for (const slug of shops) entries.push({ url: `${SITE_URL}/boutique/${slug}` });
  return entries;
}
