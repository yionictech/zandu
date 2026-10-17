import { ApiError } from '@zandu/api-client';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { catalog, SITE_URL } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { ProductGrid } from '@/components/ProductTile';
import { ShareButtons } from '@/components/ShareButtons';

export const dynamic = 'force-dynamic';

type Params = Promise<{ slug: string }>;

const loadShop = cache(async (slug: string) => {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) notFound();
  try {
    return await catalog((api) => api.GET('/v1/shops/{slug}', { params: { path: { slug } } }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const shop = await loadShop((await params).slug);
  const title = `${shop.shopName} — boutique ${shop.verified ? 'vérifiée ' : ''}à ${shop.city}`;
  const description = `Commandez chez ${shop.shopName} sur Zandu : paiement Mobile Money protégé jusqu'à la livraison.`;
  return {
    title,
    description,
    alternates: { canonical: `/boutique/${shop.slug}` },
    openGraph: { title, description, url: `/boutique/${shop.slug}` },
  };
}

/** Vitrine d'une boutique : le lien que le vendeur partage dans ses groupes WhatsApp. */
export default async function ShopPage({ params }: { params: Params }) {
  const shop = await loadShop((await params).slug);
  const products = await catalog((api) =>
    api.GET('/v1/products', {
      params: { query: { sellerId: shop.id, sort: 'newest', limit: 40 } },
    }),
  );
  return (
    <main>
      <section className="card stack">
        <h1>{shop.shopName}</h1>
        <span className="small">
          {shop.verified ? <span className="verified">✓ Boutique vérifiée · </span> : null}
          {shop.city} · {shop.salesCount} vente{shop.salesCount > 1 ? 's' : ''} ·{' '}
          {shop.ratingCount ? `★ ${shop.ratingAvg} (${shop.ratingCount} avis)` : 'Nouveau vendeur'}
        </span>
        <span className="small muted">Sur Zandu depuis le {formatDateTime(shop.memberSince)}</span>
        <ShareButtons
          url={`${SITE_URL}/boutique/${shop.slug}`}
          text={`Ma boutique ${shop.shopName} sur Zandu : payez par Mobile Money, argent protégé jusqu'à la livraison`}
        />
      </section>
      {products.items.length ? (
        <ProductGrid products={products.items} />
      ) : (
        <p className="card muted">Aucun produit en vente pour le moment.</p>
      )}
    </main>
  );
}
