import Link from 'next/link';
import { catalog } from '@/lib/api';
import { GUARANTEE } from '@/lib/labels';
import { ProductGrid } from '@/components/ProductTile';

export const dynamic = 'force-dynamic';

/** Accueil : catégories, garantie, nouveautés. Douze vignettes, le reste par la recherche. */
export default async function Home() {
  const [categories, latest] = await Promise.all([
    catalog((api) => api.GET('/v1/categories')),
    catalog((api) => api.GET('/v1/products', { params: { query: { sort: 'newest', limit: 12 } } })),
  ]);
  return (
    <main>
      <nav className="chips" aria-label="Catégories">
        {categories
          .filter((c) => c.parentId === null)
          .map((c) => (
            <Link key={c.id} href={`/recherche?categorie=${c.id}`} className="chip">
              {c.name}
            </Link>
          ))}
      </nav>
      <section className="guarantee">
        <strong>🛡 Garantie Zandu.</strong> {GUARANTEE}
      </section>
      <h1>Nouveautés</h1>
      <ProductGrid products={latest.items} />
    </main>
  );
}
