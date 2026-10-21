import type { Metadata } from 'next';
import { ChevronLeft, Share2, ShieldCheck, Star, Store, Truck } from 'lucide-react';
import Link from 'next/link';
import { catalog, SITE_URL } from '@/lib/api';
import { formatDateTime, formatXaf } from '@/lib/format';
import { CONDITION, GUARANTEE, REVIEW_TAGS } from '@/lib/labels';
import { loadProduct } from '@/lib/product';
import { AddToCart } from '@/components/AddToCart';
import { Price } from '@/components/Price';
import { RememberProduct } from '@/components/RememberProduct';
import { ShareButtons } from '@/components/ShareButtons';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

/**
 * Aperçu du lien dans WhatsApp, Facebook, Messenger : photo, « titre — prix », boutique.
 * C'est la première impression de Zandu pour la plupart des acheteurs.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = await loadProduct((await params).id);
  const title = `${p.title} — ${formatXaf(p.price)}`;
  const description = `Vendu par ${p.seller.shopName} à ${p.city}. Paiement Mobile Money protégé : votre argent reste bloqué jusqu'à la livraison.`;
  // JPEG de partage (ADR-0014) : tous les aperçus de lien le lisent, ce qui n'est pas sûr du WebP.
  const share = p.shareImage
    ? { url: p.shareImage }
    : p.media[0]
      ? { url: p.media[0].url, width: p.media[0].width ?? 600, height: p.media[0].height ?? 600 }
      : null;
  return {
    title,
    description,
    alternates: { canonical: `/produit/${p.id}` },
    openGraph: {
      title,
      description,
      url: `/produit/${p.id}`,
      images: share ? [{ ...share, alt: p.title }] : [],
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function ProductPage({ params }: { params: Params }) {
  const { id } = await params;
  const p = await loadProduct(id);
  const reviews = await catalog((api) =>
    api.GET('/v1/products/{id}/reviews', { params: { path: { id }, query: { limit: 5 } } }),
  );
  const url = `${SITE_URL}/produit/${p.id}`;
  // Données structurées : prix, disponibilité et note dans les résultats de recherche.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    description: p.description,
    image: p.media.map((m) => m.url),
    offers: {
      '@type': 'Offer',
      price: p.price,
      priceCurrency: 'XAF',
      availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url,
      seller: { '@type': 'Organization', name: p.seller.shopName },
    },
    ...(p.reviews && p.reviews.count > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: p.reviews.average,
            reviewCount: p.reviews.count,
          },
        }
      : {}),
  };
  const verified = p.seller.verified;
  const condition = CONDITION[p.condition];
  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <article className="product">
        <div className="hero-photo">
          <div className="gallery" aria-label="Photos">
            {p.media.map((m, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={m.url}
                src={m.url}
                alt={index === 0 ? p.title : ''}
                width={m.width ?? 600}
                height={m.height ?? 600}
                loading={index === 0 ? 'eager' : 'lazy'}
                fetchPriority={index === 0 ? 'high' : 'auto'}
              />
            ))}
          </div>
          <div className="photo-buttons">
            <Link href="/" className="round" aria-label="Retour à l’accueil">
              <ChevronLeft className="icon" aria-hidden />
            </Link>
            <a
              className="round"
              href={`https://wa.me/?text=${encodeURIComponent(`${p.title} — ${formatXaf(p.price)} sur Zandu\n${url}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Partager sur WhatsApp"
            >
              <Share2 className="icon" aria-hidden />
            </a>
          </div>
        </div>
        <div className="stack">
          <span className="shop-line">
            {p.seller.shopName}
            {verified ? <span className="pill-badge brand">Vérifié</span> : null}
            {condition ? <span className="pill-badge">{condition}</span> : null}
          </span>
          <h1>{p.title}</h1>
          {p.reviews && p.reviews.count > 0 ? (
            <span className="rating">
              <Star className="icon star" aria-hidden fill="currentColor" width={16} height={16} />
              {(p.reviews.average ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 1 })}
              <a href="#avis">
                {p.reviews.count} avis vérifié{p.reviews.count > 1 ? 's' : ''}
              </a>
            </span>
          ) : null}
          <Price value={p.price} size="xl" was={p.compareAtPrice} testId="product-price" />
          <section className="guarantee-card">
            <ShieldCheck className="icon" aria-hidden />
            <div>
              <strong>Garantie Zandu</strong>
              <span>{GUARANTEE}</span>
            </div>
          </section>
          <div className="info-row">
            <span className="icon-box">
              <Truck className="icon" aria-hidden />
            </span>
            <div>
              <strong>Livré à Pointe-Noire et Brazzaville</strong>
              <div className="small muted">À domicile, ou en point relais (moins cher)</div>
            </div>
          </div>
          <RememberProduct
            product={{
              id: p.id,
              title: p.title,
              price: p.price,
              coverImage: p.coverImage,
              shopName: p.seller.shopName,
            }}
          />
          <AddToCart
            line={{
              productId: p.id,
              title: p.title,
              price: p.price,
              coverImage: p.coverImage,
              sellerId: p.seller.id,
              shopName: p.seller.shopName,
              stock: p.stock,
            }}
          />
          <Link
            href={`/boutique/${p.seller.slug}`}
            className="card info-row"
            data-testid="shop-link"
          >
            <span className="icon-box">
              <Store className="icon" aria-hidden />
            </span>
            <div>
              <strong>{p.seller.shopName}</strong>{' '}
              {verified ? <span className="verified small">✓ Vérifiée</span> : null}
              <div className="small muted">
                {p.seller.ratingCount
                  ? `★ ${p.seller.ratingAvg} · ${p.seller.ratingCount} avis`
                  : 'Nouveau vendeur'}{' '}
                · Voir la boutique ›
              </div>
            </div>
          </Link>
          <ShareButtons url={url} text={`${p.title} — ${formatXaf(p.price)} sur Zandu`} />
        </div>
      </article>
      {p.description ? (
        <section className="card">
          <h2>Description</h2>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{p.description}</p>
        </section>
      ) : null}
      <section className="card" id="avis">
        <h2>Avis d’acheteurs vérifiés</h2>
        {reviews.items.length === 0 ? <p className="muted">Pas encore d’avis.</p> : null}
        {reviews.items.map((r) => (
          <div key={r.id} className="line" style={{ display: 'block' }}>
            <strong className="verified">{'★'.repeat(r.rating)}</strong>{' '}
            <span className="small muted">
              {r.authorName} · {formatDateTime(r.createdAt)}
            </span>
            {r.comment ? <p style={{ margin: '4px 0 0' }}>{r.comment}</p> : null}
            {r.tags.length ? (
              <div className="tags">
                {r.tags.map((tag) => (
                  <span key={tag} className="pill-badge">
                    {REVIEW_TAGS[tag]}
                  </span>
                ))}
              </div>
            ) : null}
            {r.sellerReply ? (
              <p className="small muted" style={{ margin: '6px 0 0' }}>
                <strong>Réponse du vendeur :</strong> {r.sellerReply}
              </p>
            ) : null}
          </div>
        ))}
      </section>
    </main>
  );
}
