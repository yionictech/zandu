import Link from 'next/link';
import { load } from '@/lib/api';
import { formatXaf } from '@/lib/format';
import { PageHeader } from '@/components/ui';

export const metadata = { title: 'Tableau de bord' };

/** Ce qui attend le support, file par file, avec l'objectif de délai de chacune. */
export default async function Dashboard() {
  const { queues: q, today } = await load((api) => api.GET('/v1/support/overview'));
  const cards = [
    {
      href: '/litiges',
      label: 'Litiges ouverts',
      value: q.disputesOpen,
      note: q.disputesOverdue
        ? `${q.disputesOverdue} au-delà de 72 h`
        : 'Objectif : décision sous 72 h',
      late: q.disputesOverdue > 0,
    },
    {
      href: '/livraisons',
      label: 'Livraisons à assigner',
      value: q.deliveriesToAssign,
      note: 'Colis prêts en tête de liste',
    },
    {
      href: '/vendeurs',
      label: 'Boutiques à vérifier',
      value: q.kycPending,
      note: 'Objectif : sous 24 h',
    },
    {
      href: '/produits',
      label: 'Produits à modérer',
      value: q.productsPending,
      note: 'Objectif : sous 2 h',
    },
    {
      href: '/alertes',
      label: 'Alertes',
      value: q.alerts,
      note: 'Argent en échec, litiges en retard',
      late: q.alerts > 0,
    },
  ];
  return (
    <>
      <PageHeader title="Tableau de bord" subtitle="Aujourd'hui à Pointe-Noire" />
      <section className="grid grid-4">
        <div className="card kpi">
          <span className="label">Commandes payées</span>
          <span className="value" data-testid="kpi-paid-orders">
            {today.paidOrders}
          </span>
        </div>
        <div className="card kpi">
          <span className="label">Montant encaissé (séquestre)</span>
          <span className="value">{formatXaf(today.paidAmount)}</span>
        </div>
        <div className="card kpi">
          <span className="label">Commandes terminées</span>
          <span className="value">{today.completedOrders}</span>
        </div>
        <div className="card kpi">
          <span className="label">Nouvelles boutiques</span>
          <span className="value">{today.newShops}</span>
        </div>
      </section>
      <h2>Files de travail</h2>
      <section className="grid grid-4">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className={`card queue ${card.late ? 'late' : card.value ? 'todo' : ''}`}
          >
            <span className="muted">{card.label}</span>
            <span className="value">{card.value}</span>
            <span className={`small ${card.late ? '' : 'muted'}`}>{card.note}</span>
          </Link>
        ))}
      </section>
    </>
  );
}
