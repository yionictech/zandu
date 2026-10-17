import Link from 'next/link';
import { load } from '@/lib/api';
import { deadline, formatDateTime, formatXaf } from '@/lib/format';
import { DISPUTE_REASON } from '@/lib/labels';
import { Badge, Empty, Flash, PageHeader, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Litiges' };

/** Litiges ouverts (F12), les plus proches de l'échéance de 72 h en tête. */
export default async function DisputesPage({ searchParams }: { searchParams: SearchParams }) {
  const { ok, erreur } = await readParams(searchParams);
  const { items } = await load((api) => api.GET('/v1/support/disputes'));
  return (
    <>
      <PageHeader
        title="Litiges ouverts"
        subtitle="Le reversement au vendeur est gelé jusqu'à la décision. Objectif : sous 72 h."
      />
      <Flash ok={ok} erreur={erreur} />
      {items.length === 0 ? (
        <Empty>Aucun litige ouvert.</Empty>
      ) : (
        <div className="card table-card">
          <table>
            <thead>
              <tr>
                <th>Commande</th>
                <th>Motif</th>
                <th className="num">Montant</th>
                <th>Ouvert le</th>
                <th>Échéance</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => {
                const due = deadline(d.slaDueAt);
                return (
                  <tr key={d.id}>
                    <td>
                      <Link
                        href={`/litiges/${d.id}`}
                        className="ref"
                        data-testid={`dispute-${d.publicRef}`}
                      >
                        {d.publicRef}
                      </Link>
                    </td>
                    <td>{DISPUTE_REASON[d.reason]}</td>
                    <td className="num">{formatXaf(d.total)}</td>
                    <td>{formatDateTime(d.createdAt)}</td>
                    <td>
                      <Badge tone={due.late ? 'danger' : 'waiting'}>{due.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
