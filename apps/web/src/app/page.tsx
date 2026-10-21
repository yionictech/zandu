import Link from 'next/link';
import { catalog } from '@/lib/api';
import { currentCity } from '@/lib/city';
import { CategoryIcon } from '@/components/CategoryIcon';
import { ProductGrid } from '@/components/ProductTile';

export const dynamic = 'force-dynamic';

/**
 * Accueil (maquette) : catégories en tuiles, nouveautés livrables dans la ville choisie.
 * Douze vignettes, le reste par la recherche.
 */
export default async function Home() {
  const city = await currentCity();
  const [categories, latest] = await Promise.all([
    catalog((api) => api.GET('/v1/categories')),
    catalog((api) =>
      api.GET('/v1/products', { params: { query: { sort: 'newest', limit: 12, city } } }),
    ),
  ]);
  return (
    <main>
      <nav className="cats" aria-label="Catégories">
        <Link href="/recherche" className="cat active">
          <span className="cat-icon">
            <CategoryIcon slug={null} />
          </span>
          Tout
        </Link>
        {categories
          .filter((c) => c.parentId === null)
          .map((c) => (
            <Link key={c.id} href={`/recherche?categorie=${c.id}`} className="cat">
              <span className="cat-icon">
                <CategoryIcon slug={c.slug} />
              </span>
              {c.name}
            </Link>
          ))}
      </nav>
      <div className="section-title">
        <h1>Nouveautés</h1>
        <span className="small muted">Livrables à {city}</span>
      </div>
      {latest.items.length ? (
        <ProductGrid products={latest.items} />
      ) : (
        <p className="card muted">Pas encore de produits livrables à {city}.</p>
      )}
    </main>
  );
}
