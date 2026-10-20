import type { VerificationStatus } from '@zandu/api-client';
import Link from 'next/link';
import { load } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Badge, Empty, Flash, Tabs, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Vendeurs' };

const STATUSES: Array<[VerificationStatus, string]> = [
  ['pending_review', 'À vérifier'],
  ['verified', 'Actifs'],
  ['suspended', 'Suspendus'],
  ['unverified', 'Dossier incomplet'],
  ['rejected', 'Refusés'],
];

/** « il y a 2 h », « hier », sinon la date. */
function received(iso: string | null): string {
  if (!iso) return '—';
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'à l’instant';
  if (hours < 24) return `il y a ${hours} h`;
  if (hours < 48) return 'hier';
  return formatDateTime(iso);
}

/** Vendeurs (maquette) : file de vérification (F2) d'abord, puis boutiques actives et suspendues. */
export default async function SellersPage({ searchParams }: { searchParams: SearchParams }) {
  const { one, ok, erreur } = await readParams(searchParams);
  const status = (STATUSES.find(([s]) => s === one('statut'))?.[0] ??
    'pending_review') as VerificationStatus;
  const { items, counts } = await load((api) =>
    api.GET('/v1/admin/sellers', { params: { query: { status } } }),
  );
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Vendeurs</h1>
          <div className="subtitle">
            Pièce d'identité et selfie (plus RCCM et NIU pour une entreprise). Objectif : sous 24 h.
          </div>
        </div>
        <Tabs
          items={STATUSES.map(([s, label]) => ({
            href: `/vendeurs?statut=${s}`,
            label,
            active: s === status,
            count: counts[s],
          }))}
        />
      </header>
      <Flash ok={ok} erreur={erreur} />
      {items.length === 0 ? (
        <Empty>Aucune boutique dans cette liste.</Empty>
      ) : (
        <div className="card table-card">
          <table>
            <thead>
              <tr>
                <th>Boutique</th>
                <th>Gérant</th>
                <th>Ville</th>
                <th>Documents</th>
                <th>Reçu</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.shopName}</strong>
                    <div className="small muted">
                      {s.kind === 'business' ? 'Entreprise' : 'Particulier'}
                    </div>
                  </td>
                  <td>{s.managerName ?? '—'}</td>
                  <td>{s.city}</td>
                  <td>
                    {s.documentsComplete ? (
                      <Badge tone="brand">Complet</Badge>
                    ) : (
                      <Badge tone="danger">Pièces manquantes</Badge>
                    )}
                  </td>
                  <td className="muted">{received(s.lastDocumentAt)}</td>
                  <td className="num">
                    <Link href={`/vendeurs/${s.id}`} data-testid={`seller-${s.shopName}`}>
                      <strong>Examiner</strong>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
