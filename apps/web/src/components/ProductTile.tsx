import type { ProductCard } from '@zandu/api-client';
import Link from 'next/link';
import { Price } from './Price';

/** Vignette produit : photo, titre sur deux lignes, prix, « ✓ Vérifié · boutique ». */
export function ProductTile({ product, eager = false }: { product: ProductCard; eager?: boolean }) {
  return (
    <Link href={`/produit/${product.id}`} className="tile" data-testid={`tile-${product.title}`}>
      {product.coverImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.coverImage}
          alt=""
          width={300}
          height={300}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
        />
      ) : (
        <div className="placeholder" />
      )}
      <div className="tile-body">
        <span className="tile-title">{product.title}</span>
        <Price value={product.price} size="sm" was={product.compareAtPrice} />
        <span className="small muted verified-line">
          {product.seller.verified ? <span className="verified">✓ Vérifié · </span> : null}
          {product.seller.shopName}
        </span>
      </div>
    </Link>
  );
}

export function ProductGrid({ products }: { products: ProductCard[] }) {
  return (
    <div className="grid">
      {products.map((p, index) => (
        // Les 4 premières photos tout de suite (au-dessus de la ligne de flottaison), le reste au défilement.
        <ProductTile key={p.id} product={p} eager={index < 4} />
      ))}
    </div>
  );
}
