import { BadgeCheck, MapPin, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { catalog } from '@/lib/api';
import { currentCity } from '@/lib/city';
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

/**
 * Recherche tolérante aux fautes (« samsumg » trouve Samsung), catégorie, tri, et les filtres
 * de la maquette : « Livrable à {ville} » et « Vendeur vérifié ». Rien que des liens.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const city = await currentCity();
  const q = params.q?.trim().slice(0, 100) || undefined;
  const categoryId = params.categorie && UUID.test(params.categorie) ? params.categorie : undefined;
  const sort = SORTS.find(([s]) => s === params.tri)?.[0] ?? 'relevance';
  const inCity = params.livrable === '1';
  const verified = params.verifie === '1';
  const [categories, results] = await Promise.all([
    catalog((api) => api.GET('/v1/categories')),
    catalog((api) =>
      api.GET('/v1/products', {
        params: {
          query: {
            ...(q ? { q } : {}),
            ...(categoryId ? { categoryId } : {}),
            ...(inCity ? { city } : {}),
            ...(verified ? { verified: true } : {}),
            sort,
            limit: 40,
          },
        },
      }),
    ),
  ]);
  const link = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = {
      q,
      categorie: categoryId,
      tri: sort,
      livrable: inCity ? '1' : undefined,
      verifie: verified ? '1' : undefined,
      ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    return `/recherche?${next.toString()}`;
  };
  const category = categories.find((c) => c.id === categoryId);
  const count = results.items.length;
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
      <nav className="chips" aria-label="Filtres">
        <Link
          href={link({ livrable: inCity ? undefined : '1' })}
          className={`chip filter ${inCity ? 'active' : ''}`}
          aria-pressed={inCity}
          data-testid="filter-city"
        >
          <MapPin className="icon" aria-hidden />
          Livrable à {city}
          {inCity ? <X className="icon" aria-hidden /> : null}
        </Link>
        <Link
          href={link({ verifie: verified ? undefined : '1' })}
          className={`chip filter ${verified ? 'active' : ''}`}
          aria-pressed={verified}
          data-testid="filter-verified"
        >
          <BadgeCheck className="icon" aria-hidden />
          Vendeur vérifié
          {verified ? <X className="icon" aria-hidden /> : null}
        </Link>
      </nav>
      <p className="small muted" style={{ margin: 0 }}>
        {q ? (
          <>
            Résultats pour <strong>{q}</strong> ·{' '}
          </>
        ) : null}
        {count} produit{count > 1 ? 's' : ''}
      </p>
      {count ? (
        <ProductGrid products={results.items} />
      ) : (
        <p className="card muted">Aucun résultat. Essayez un autre mot ou retirez un filtre.</p>
      )}
    </main>
  );
}
