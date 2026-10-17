import Link from 'next/link';
import { ApiError } from '@zandu/api-client';
import { load } from '@/lib/api';
import { formatDateTime, formatXaf } from '@/lib/format';
import { ORDER_STATUS } from '@/lib/labels';
import { Badge, Empty, Flash, PageHeader, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Commandes' };

/** Recherche universelle : référence ZD-… ou téléphone (acheteur, vendeur ou destinataire). */
export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const { one, ok, erreur } = await readParams(searchParams);
  const q = one('q')?.trim() ?? '';
  let items: Awaited<ReturnType<typeof search>> = [];
  let searchError: string | null = null;
  async function search() {
    return (
      await load((api) => api.GET('/v1/support/orders', { params: { query: q ? { q } : {} } }))
    ).items;
  }
  try {
    items = await search();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    searchError = error.message;
  }
  return (
    <>
      <PageHeader
        title="Commandes"
        subtitle={q ? `Résultats pour « ${q} »` : '50 dernières commandes'}
      >
        <form className="inline" role="search">
          <input
            name="q"
            defaultValue={q}
            placeholder="ZD-7K3M9Q2P ou 06 612 34 56"
            aria-label="Référence ou téléphone"
            size={28}
          />
          <button type="submit" className="button">
            Chercher
          </button>
        </form>
      </PageHeader>
      <Flash ok={ok} erreur={erreur ?? searchError ?? undefined} />
      {items.length === 0 && !searchError ? (
        <Empty>Aucune commande trouvée.</Empty>
      ) : items.length ? (
        <div className="card table-card">
          <table>
            <thead>
              <tr>
                <th>Commande</th>
                <th>Statut</th>
                <th>Boutique</th>
                <th>Destinataire</th>
                <th className="num">Total</th>
                <th>Créée le</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => {
                const [label, tone] = ORDER_STATUS[o.status];
                return (
                  <tr key={o.id}>
                    <td>
                      <Link
                        href={`/commandes/${o.id}`}
                        className="ref"
                        data-testid={`order-${o.publicRef}`}
                      >
                        {o.publicRef}
                      </Link>
                    </td>
                    <td>
                      <Badge tone={tone}>{label}</Badge>
                    </td>
                    <td>{o.seller.shopName}</td>
                    <td>{o.shippingAddress.recipientName}</td>
                    <td className="num">{formatXaf(o.total)}</td>
                    <td>{formatDateTime(o.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
