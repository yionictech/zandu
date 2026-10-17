import Link from 'next/link';
import { load } from '@/lib/api';
import { formatDateTime, formatXaf } from '@/lib/format';
import { ALERT_KIND } from '@/lib/labels';
import { Badge, Empty, PageHeader } from '@/components/ui';

export const metadata = { title: 'Alertes' };

/**
 * Ce qui demande une intervention : reversement ou remboursement en échec définitif après
 * 3 tentatives (l'argent est revenu sur le bon compte, il faut contacter la personne), litiges
 * en retard.
 */
export default async function AlertsPage() {
  const { items } = await load((api) => api.GET('/v1/support/alerts'));
  return (
    <>
      <PageHeader
        title="Alertes"
        subtitle="Reversements et remboursements en échec (30 derniers jours), litiges au-delà de 72 h."
      />
      {items.length === 0 ? (
        <Empty>Aucune alerte. Tout l'argent circule normalement.</Empty>
      ) : (
        <div className="card table-card">
          <table>
            <thead>
              <tr>
                <th>Alerte</th>
                <th>Commande</th>
                <th className="num">Montant</th>
                <th>Détail</th>
                <th>Depuis</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={`${a.kind}-${a.id}`}>
                  <td>
                    <Badge tone="danger">{ALERT_KIND[a.kind]}</Badge>
                  </td>
                  <td>
                    {a.orderId ? (
                      <Link href={`/commandes/${a.orderId}`} className="ref">
                        {a.publicRef}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="num">{formatXaf(a.amount)}</td>
                  <td className="small">{a.message ?? '—'}</td>
                  <td>{formatDateTime(a.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
