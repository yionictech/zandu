import type { VerificationStatus } from '@zandu/api-client';
import Link from 'next/link';
import { load } from '@/lib/api';
import { displayPhone, formatDateTime } from '@/lib/format';
import {
  Badge,
  Empty,
  Flash,
  PageHeader,
  Tabs,
  readParams,
  type SearchParams,
} from '@/components/ui';

export const metadata = { title: 'Vérifications' };

const STATUSES: Array<[VerificationStatus, string]> = [
  ['pending_review', 'À vérifier'],
  ['unverified', 'Dossier incomplet'],
  ['rejected', 'Refusées'],
  ['verified', 'Vérifiées'],
  ['suspended', 'Suspendues'],
];

/** File de vérification (F2) : dossiers complets d'abord, du plus ancien au plus récent. */
export default async function SellersPage({ searchParams }: { searchParams: SearchParams }) {
  const { one, ok, erreur } = await readParams(searchParams);
  const status = (STATUSES.find(([s]) => s === one('statut'))?.[0] ??
    'pending_review') as VerificationStatus;
  const { items } = await load((api) =>
    api.GET('/v1/admin/sellers', { params: { query: { status } } }),
  );
  return (
    <>
      <PageHeader
        title="Vérification des boutiques"
        subtitle="Pièce d'identité et selfie (plus RCCM et NIU pour une entreprise). Objectif : sous 24 h."
      />
      <Flash ok={ok} erreur={erreur} />
      <Tabs
        items={STATUSES.map(([s, label]) => ({
          href: `/vendeurs?statut=${s}`,
          label,
          active: s === status,
        }))}
      />
      {items.length === 0 ? (
        <Empty>Aucune boutique dans cette file.</Empty>
      ) : (
        <div className="card table-card">
          <table>
            <thead>
              <tr>
                <th>Boutique</th>
                <th>Type</th>
                <th>Ville</th>
                <th>Téléphone</th>
                <th>Pièces à examiner</th>
                <th>Ouverte le</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/vendeurs/${s.id}`} data-testid={`seller-${s.shopName}`}>
                      <strong>{s.shopName}</strong>
                    </Link>
                  </td>
                  <td>{s.kind === 'business' ? 'Entreprise' : 'Particulier'}</td>
                  <td>{s.city}</td>
                  <td>{displayPhone(s.phone)}</td>
                  <td>
                    {s.pendingDocuments ? (
                      <Badge tone="waiting">{s.pendingDocuments}</Badge>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{formatDateTime(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
