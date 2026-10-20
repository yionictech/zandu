import {
  Bike,
  Flag,
  Store,
  TriangleAlert,
  LayoutGrid,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { load } from '@/lib/api';
import { formatF, formatXaf, OPERATORS } from '@/lib/format';
import { DISPUTE_REASON, ORDER_SHORT } from '@/lib/labels';
import { Badge, Tabs, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Vue d’ensemble' };

const PERIODS = [
  ['today', 'Aujourd’hui'],
  ['7d', '7 jours'],
  ['30d', '30 jours'],
] as const;
type Period = (typeof PERIODS)[number][0];

const today = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Brazzaville',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** « 12 », jour du mois d'une date AAAA-MM-JJ. */
const dayOfMonth = (date: string) => String(Number(date.slice(8, 10)));

function Kpi({
  label,
  value,
  note,
  dot,
  testId,
}: {
  label: string;
  value: string;
  note: string;
  dot: string;
  testId?: string;
}) {
  return (
    <div className="card kpi">
      <span className="label dot" style={{ ['--dot' as string]: dot }}>
        {label}
      </span>
      <span className="value" data-testid={testId}>
        {value}
      </span>
      <span className="note">{note}</span>
    </div>
  );
}

function Todo({
  href,
  icon: Icon,
  color,
  title,
  hint,
}: {
  href: string;
  icon: LucideIcon;
  color: string;
  title: string;
  hint: string;
}) {
  return (
    <Link href={href} className="todo-item">
      <span className="todo-icon" style={{ background: color }}>
        <Icon size={18} strokeWidth={2} aria-hidden />
      </span>
      <span className="grow">
        <strong>{title}</strong>
        <span className="small muted">{hint}</span>
      </span>
      <ChevronRight size={18} className="muted" aria-hidden />
    </Link>
  );
}

const s = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Vue d'ensemble (maquette) : la journée en chiffres, 14 jours, ce qui attend, dernières commandes. */
export default async function Overview({ searchParams }: { searchParams: SearchParams }) {
  const { one } = await readParams(searchParams);
  const period = (PERIODS.find(([p]) => p === one('periode'))?.[0] ?? 'today') as Period;
  const [d, recent] = await Promise.all([
    load((api) => api.GET('/v1/support/dashboard', { params: { query: { period } } })),
    load((api) => api.GET('/v1/support/orders', { params: { query: {} } })),
  ]);
  const max = Math.max(1, ...d.daily.map((x) => x.orders));
  const todo = [
    d.disputes.open
      ? {
          href: d.disputes.first ? `/litiges/${d.disputes.first.id}` : '/litiges',
          icon: Flag,
          color: 'var(--danger)',
          title: s(d.disputes.open, 'litige ouvert', 'litiges ouverts'),
          hint: d.disputes.first
            ? `Dont ${d.disputes.first.publicRef} : ${DISPUTE_REASON[d.disputes.first.reason].toLowerCase()}`
            : '',
        }
      : null,
    d.todo.kycPending
      ? {
          href: '/vendeurs',
          icon: Store,
          color: 'var(--brand)',
          title: s(d.todo.kycPending, 'vendeur à vérifier', 'vendeurs à vérifier'),
          hint: 'Pièces d’identité reçues',
        }
      : null,
    d.todo.productsPending
      ? {
          href: '/produits',
          icon: LayoutGrid,
          color: 'var(--accent)',
          title: s(d.todo.productsPending, 'produit à valider', 'produits à valider'),
          hint: 'Avant d’être visibles dans le catalogue',
        }
      : null,
    d.todo.moneyFailures
      ? {
          href: '/alertes',
          icon: TriangleAlert,
          color: 'var(--waiting)',
          title: s(d.todo.moneyFailures, 'versement en échec', 'versements en échec'),
          hint: 'Reversement ou remboursement à reprendre',
        }
      : null,
    d.todo.deliveriesToAssign
      ? {
          href: '/livraisons',
          icon: Bike,
          color: 'var(--muted)',
          title: s(d.todo.deliveriesToAssign, 'livraison à assigner', 'livraisons à assigner'),
          hint: 'Colis prêts en tête de liste',
        }
      : null,
  ].filter((x) => x !== null);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Vue d’ensemble</h1>
          <div className="subtitle">
            {today.format(new Date()).replace(/^./, (c) => c.toUpperCase())} · Pointe-Noire et
            Brazzaville
          </div>
        </div>
        <Tabs
          items={PERIODS.map(([p, label]) => ({
            href: p === 'today' ? '/' : `/?periode=${p}`,
            label,
            active: p === period,
          }))}
        />
      </header>

      <section className="grid grid-4">
        <Kpi
          label={period === 'today' ? 'Volume du jour' : 'Volume'}
          value={formatF(d.volume.amount)}
          note={s(d.volume.paidOrders, 'commande payée', 'commandes payées')}
          dot="var(--brand)"
          testId="kpi-paid-orders"
        />
        <Kpi
          label="Argent bloqué"
          value={formatF(d.escrow.amount)}
          note={s(d.escrow.orders, 'commande en cours', 'commandes en cours')}
          dot="var(--waiting)"
        />
        {d.commission ? (
          <Kpi
            label="Commissions"
            value={formatF(d.commission.amount)}
            note={`${(d.commission.rateBps / 100).toLocaleString('fr-FR')} % des articles`}
            dot="var(--accent)"
          />
        ) : (
          <Kpi
            label="À valider"
            value={String(d.todo.productsPending + d.todo.kycPending)}
            note="produits et boutiques"
            dot="var(--accent)"
          />
        )}
        <Kpi
          label="Litiges ouverts"
          value={String(d.disputes.open)}
          note={
            d.disputes.dueToday
              ? `${d.disputes.dueToday} à trancher aujourd’hui`
              : 'Objectif : décision sous 72 h'
          }
          dot="var(--danger)"
        />
      </section>

      <section className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 400px' }}>
        <div className="card">
          <h2>Commandes · 14 derniers jours</h2>
          <div className="bars" aria-label="Commandes payées par jour">
            {d.daily.map((x, i) => (
              <div
                key={x.date}
                className={`bar ${i === d.daily.length - 1 ? 'today' : ''}`}
                title={`${x.date} : ${x.orders}`}
              >
                <span style={{ height: `${(x.orders / max) * 100}%` }} />
                <small>{dayOfMonth(x.date)}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h2>À traiter</h2>
          {todo.length ? (
            <div className="todo-list">
              {todo.map((t) => (
                <Todo key={t.href} {...t} />
              ))}
            </div>
          ) : (
            <p className="muted">Rien en attente.</p>
          )}
        </div>
      </section>

      <section className="grid">
        <div className="page-header">
          <h2 style={{ margin: 0 }}>Commandes récentes</h2>
          <Link href="/commandes">Tout voir</Link>
        </div>
        <div className="card table-card">
          <table>
            <thead>
              <tr>
                <th>Commande</th>
                <th>Acheteur</th>
                <th>Vendeur</th>
                <th className="num">Montant</th>
                <th>Paiement</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {recent.items.slice(0, 6).map((o) => {
                const [label, tone] = ORDER_SHORT[o.status];
                return (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/commandes?id=${o.id}`} className="ref">
                        {o.publicRef}
                      </Link>
                    </td>
                    <td>{o.buyerName ?? '—'}</td>
                    <td className="muted">{o.seller.shopName}</td>
                    <td className="num">
                      <strong>{formatXaf(o.total)}</strong>
                    </td>
                    <td className="muted">{o.operator ? OPERATORS[o.operator] : '—'}</td>
                    <td>
                      <Badge tone={tone}>{label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
