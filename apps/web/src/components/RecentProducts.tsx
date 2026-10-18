'use client';

import Link from 'next/link';
import { formatXaf } from '@/lib/format';
import { useRecentProducts } from '@/lib/recent';

/** Produits déjà consultés sur ce téléphone (leur fiche est enregistrée). */
export function RecentProducts() {
  const products = useRecentProducts();
  if (!products.length) return null;
  return (
    <section>
      <h2>Vus récemment</h2>
      <ul className="recent-list" data-testid="recent-products">
        {products.map((p) => (
          <li key={p.id}>
            <Link href={`/produit/${p.id}`} className="card recent-item">
              <span className="tile-title">{p.title}</span>
              <span className="tile-price">{formatXaf(p.price)}</span>
              <span className="small muted">{p.shopName}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
