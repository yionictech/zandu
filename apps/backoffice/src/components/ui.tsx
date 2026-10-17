import Link from 'next/link';
import type { ReactNode } from 'react';

type Tone = 'trust' | 'waiting' | 'danger' | 'brand' | 'neutral';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone === 'neutral' ? '' : tone}`}>{children}</span>;
}

/** Message après une action : `?ok=…` ou `?erreur=…` dans l'adresse. */
export function Flash({ ok, erreur }: { ok?: string | undefined; erreur?: string | undefined }) {
  if (erreur)
    return (
      <div className="flash erreur" role="alert">
        {erreur}
      </div>
    );
  if (ok)
    return (
      <div className="flash ok" role="status">
        ✔ {ok}
      </div>
    );
  return null;
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <div className="subtitle">{subtitle}</div> : null}
      </div>
      {children}
    </header>
  );
}

export function Tabs({
  items,
}: {
  items: Array<{ href: string; label: string; active: boolean; count?: number }>;
}) {
  return (
    <nav className="tabs" aria-label="Filtres">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`tab ${item.active ? 'active' : ''}`}
          aria-current={item.active ? 'page' : undefined}
        >
          {item.label}
          {item.count !== undefined ? ` (${item.count})` : ''}
        </Link>
      ))}
    </nav>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card empty">{children}</div>;
}

/** Paramètres de recherche d'une page (Next.js 16 : promesse). */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function readParams(searchParams: SearchParams) {
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return { one, ok: one('ok'), erreur: one('erreur') };
}
