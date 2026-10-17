import Link from 'next/link';
import { load } from '@/lib/api';
import { formatXaf } from '@/lib/format';
import { formatDay, formatRate, pickMonth, recentMonths } from '@/lib/periods';
import { DailyChart } from '@/components/DailyChart';
import { Empty, PageHeader, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Rapports' };

/**
 * Rapport d'activité du mois (administrateurs) : ce qui s'est vendu, ce que la plateforme a
 * réellement gagné (grand livre), d'où viennent les ventes, et l'argent dû aux vendeurs.
 */
export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const { one } = await readParams(searchParams);
  const month = pickMonth(one('mois'));
  const r = await load((api) =>
    api.GET('/v1/admin/reports/activity', {
      params: { query: { from: month.from, to: month.to } },
    }),
  );
  const s = r.sales;
  return (
    <>
      <PageHeader
        title="Rapports"
        subtitle={`Du ${formatDay(month.from)} au ${formatDay(month.to)} · heure du Congo`}
      >
        <a
          className="button secondary"
          href={`/rapports/export?mois=${month.key}`}
          data-testid="export-csv"
        >
          Exporter les commandes (CSV)
        </a>
      </PageHeader>

      <form className="filters" method="get">
        <label>
          Mois
          <select name="mois" defaultValue={month.key}>
            {recentMonths().map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="button secondary">
          Afficher
        </button>
      </form>

      <section className="grid grid-4">
        <div className="card kpi">
          <span className="label">Volume d'affaires</span>
          <span className="value" data-testid="kpi-gmv">
            {formatXaf(s.gmv)}
          </span>
          <span className="note">
            {s.paidOrders} commande{s.paidOrders > 1 ? 's' : ''} payée{s.paidOrders > 1 ? 's' : ''}
          </span>
        </div>
        <div className="card kpi">
          <span className="label">Panier moyen</span>
          <span className="value">{formatXaf(s.averageBasket)}</span>
          <span className="note">livraison comprise</span>
        </div>
        <div className="card kpi">
          <span className="label">Commissions acquises</span>
          <span className="value" data-testid="kpi-commission">
            {formatXaf(r.revenue.commission)}
          </span>
          <span className="note">
            + {formatXaf(r.revenue.upcomingCommission)} à venir (séquestre)
          </span>
        </div>
        <div className="card kpi">
          <span className="label">Résultat de la plateforme</span>
          <span className="value">{formatXaf(r.revenue.net)}</span>
          <span className="note">commissions + marge livraison − frais</span>
        </div>
      </section>

      <section className="card">
        <h2>Volume d'affaires par jour (FCFA)</h2>
        {s.paidOrders ? (
          <>
            <DailyChart days={r.daily} />
            <details>
              <summary>Voir le tableau</summary>
              <table>
                <thead>
                  <tr>
                    <th>Jour</th>
                    <th className="num">Commandes</th>
                    <th className="num">Volume d'affaires</th>
                  </tr>
                </thead>
                <tbody>
                  {r.daily
                    .filter((d) => d.orders > 0)
                    .map((d) => (
                      <tr key={d.date}>
                        <td>{formatDay(d.date)}</td>
                        <td className="num">{d.orders}</td>
                        <td className="num">{formatXaf(d.gmv)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
          </>
        ) : (
          <p className="muted">Aucune commande payée sur la période.</p>
        )}
      </section>

      <section className="grid grid-2">
        <div className="card table-card">
          <h2>Revenus de la plateforme</h2>
          <table data-testid="revenue">
            <tbody>
              <tr>
                <td>Commissions sur ventes</td>
                <td className="num">{formatXaf(r.revenue.commission)}</td>
              </tr>
              <tr>
                <td>Marge sur la livraison</td>
                <td className="num">{formatXaf(r.revenue.deliveryMargin)}</td>
              </tr>
              <tr>
                <td>Frais Mobile Money</td>
                <td className="num">− {formatXaf(r.revenue.paymentFees)}</td>
              </tr>
              <tr>
                <th>Résultat</th>
                <th className="num">{formatXaf(r.revenue.net)}</th>
              </tr>
            </tbody>
          </table>
          <p className="definitions">
            Écritures du grand livre de la période : une commission est acquise quand le séquestre
            est libéré (réception confirmée). Commission prévue sur les ventes du mois :{' '}
            {formatXaf(s.expectedCommission)} ; remboursements : {s.refunds.count} (
            {formatXaf(s.refunds.amount)}).
          </p>
        </div>
        <div className="card table-card">
          <h2>Argent des vendeurs</h2>
          <table>
            <tbody>
              <tr>
                <td>Reversés ce mois (nombre)</td>
                <td className="num">
                  {formatXaf(r.payouts.sent.amount)}{' '}
                  <span className="muted">({r.payouts.sent.count})</span>
                </td>
              </tr>
              <tr>
                <td>En échec ce mois</td>
                <td className="num">
                  {formatXaf(r.payouts.failed.amount)}{' '}
                  <span className="muted">({r.payouts.failed.count})</span>
                </td>
              </tr>
              <tr>
                <td>En cours d'envoi</td>
                <td className="num">
                  {formatXaf(r.payouts.pending.amount)}{' '}
                  <span className="muted">({r.payouts.pending.count})</span>
                </td>
              </tr>
              <tr>
                <td>Dû aux vendeurs (à reverser)</td>
                <td className="num">{formatXaf(r.payouts.owedToSellers)}</td>
              </tr>
              <tr>
                <td>Au séquestre (commandes en cours)</td>
                <td className="num">{formatXaf(r.payouts.inEscrow)}</td>
              </tr>
            </tbody>
          </table>
          <p className="definitions">
            Les trois dernières lignes donnent l'état actuel, quel que soit le mois affiché.
          </p>
        </div>
      </section>

      <section className="grid">
        <div className="card table-card">
          <h2>Par catégorie</h2>
          {r.categories.length ? (
            <table data-testid="categories">
              <thead>
                <tr>
                  <th>Catégorie</th>
                  <th className="num">Commandes</th>
                  <th className="num">Ventes</th>
                  <th className="num">Commission</th>
                  <th className="num">Taux moyen</th>
                </tr>
              </thead>
              <tbody>
                {r.categories.map((c) => (
                  <tr key={c.categoryId}>
                    <td>{c.name}</td>
                    <td className="num">{c.orders}</td>
                    <td className="num">{formatXaf(c.sales)}</td>
                    <td className="num">{formatXaf(c.commission)}</td>
                    <td className="num">{formatRate(c.averageRateBps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Aucune vente sur la période.</Empty>
          )}
          <p className="definitions">
            Articles hors livraison ; sous-catégories comptées dans leur catégorie. Taux :{' '}
            <Link href="/commissions">règles de commission</Link>.
          </p>
        </div>
        <div className="card table-card">
          <h2>Meilleures boutiques</h2>
          {r.topShops.length ? (
            <table data-testid="top-shops">
              <thead>
                <tr>
                  <th>Boutique</th>
                  <th className="num">Commandes</th>
                  <th className="num">Ventes</th>
                  <th className="num">Commission</th>
                </tr>
              </thead>
              <tbody>
                {r.topShops.map((shop) => (
                  <tr key={shop.sellerId}>
                    <td>
                      <Link href={`/vendeurs/${shop.sellerId}`}>{shop.shopName}</Link>
                    </td>
                    <td className="num">{shop.orders}</td>
                    <td className="num">{formatXaf(shop.sales)}</td>
                    <td className="num">{formatXaf(shop.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Aucune vente sur la période.</Empty>
          )}
        </div>
      </section>
    </>
  );
}
