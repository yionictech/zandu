import type { Metadata } from 'next';
import Link from 'next/link';
import { catalog } from '@/lib/api';
import { ProductGrid } from '@/components/ProductTile';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Recherche', robots: { index: false } };

type Sort = 'relevance' | 'newest' | 'price_asc' | 'price_desc';
const SORTS: Array<[Sort, string]> = [
  ['relevance', 'Pertinence'],
  ['price_asc', 'Prix croissant'],
  ['price_desc', 'Prix décroissant'],
  ['newest', 'Nouveautés'],
];
const UUID = /^[0-9a-f-]{36}$/;

/** Recherche tolérante aux fautes (« samsumg » trouve Samsung), filtre par catégorie, tri. */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 100) || undefined;
  const categoryId = params.categorie && UUID.test(params.categorie) ? params.categorie : undefined;
  const sort = SORTS.find(([s]) => s === params.tri)?.[0] ?? 'relevance';
  const [categories, results] = await Promise.all([
    catalog((api) => api.GET('/v1/categories')),
    catalog((api) =>
      api.GET('/v1/products', {
        params: {
          query: { ...(q ? { q } : {}), ...(categoryId ? { categoryId } : {}), sort, limit: 40 },
        },
      }),
    ),
  ]);
  const link = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { q, categorie: categoryId, tri: sort, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    return `/recherche?${next.toString()}`;
  };
  const category = categories.find((c) => c.id === categoryId);
  return (
    <main>
      <h1>{q ? `« ${q} »` : (category?.name ?? 'Tous les produits')}</h1>
      <nav className="chips" aria-label="Tri">
        {SORTS.map(([s, label]) => (
          <Link key={s} href={link({ tri: s })} className={`chip ${s === sort ? 'active' : ''}`}>
            {label}
          </Link>
        ))}
      </nav>
      {results.items.length ? (
        <ProductGrid products={results.items} />
      ) : (
        <p className="card muted">Aucun résultat. Essayez un autre mot ou une autre catégorie.</p>
      )}
    </main>
  );
}
