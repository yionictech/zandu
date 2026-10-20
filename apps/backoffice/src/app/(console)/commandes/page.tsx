import Link from 'next/link';
import { ApiError, type OrderStatus } from '@zandu/api-client';
import { Search } from 'lucide-react';
import { act, field, load } from '@/lib/api';
import { displayPhone, formatDateTime, formatTime, formatXaf, OPERATORS } from '@/lib/format';
import { ORDER_SHORT } from '@/lib/labels';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Empty, Flash, Tabs, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Commandes' };

/** Onglets de la maquette « Commandes », avec les statuts qu'ils regroupent. */
const TABS: Array<[string, string, OrderStatus[] | null]> = [
  ['toutes', 'Toutes', null],
  ['payees', 'Payées', ['paid']],
  ['preparation', 'En préparation', ['preparing', 'ready_for_pickup']],
  ['livraison', 'En livraison', ['in_delivery', 'awaiting_collection']],
  ['litige', 'Litige', ['disputed']],
  ['remboursees', 'Remboursées', ['refunded']],
];

/** Étapes de la frise du volet, dans l'ordre de la commande. */
const STEPS: Array<[OrderStatus, string]> = [
  ['paid', 'Payée'],
  ['preparing', 'Acceptée par le vendeur'],
  ['ready_for_pickup', 'Prête pour le livreur'],
  ['in_delivery', 'Retirée par le livreur'],
  ['delivered', 'Remise avec le code client'],
  ['completed', 'Terminée'],
];
const FINAL = ['completed', 'refunded', 'cancelled', 'disputed'];

async function cancel(id: string, back: string, form: FormData) {
  'use server';
  await act(back, 'Commande annulée, remboursement lancé', (api) =>
    api.POST('/v1/support/orders/{id}/cancel', {
      params: { path: { id } },
      body: { reason: field(form, 'reason') },
    }),
  );
}

const time = (iso: string) => {
  const sameDay = new Date(iso).toDateString() === new Date().toDateString();
  return sameDay ? formatTime(iso) : formatDateTime(iso);
};

/** Volet de droite : la commande d'un coup d'œil, les personnes à joindre, les actions. */
async function OrderPanel({ id, back }: { id: string; back: string }) {
  const o = await load((api) => api.GET('/v1/support/orders/{id}', { params: { path: { id } } }));
  const [label, tone] = ORDER_SHORT[o.status];
  const reached = new Map(o.history.map((h) => [h.status, h.at]));
  const next = STEPS.findIndex(([status]) => !reached.has(status));
  const payment = o.payments.find((p) => p.status === 'succeeded');
  return (
    <aside className="card panel" data-testid="order-panel">
      <div className="panel-head">
        <h2 className="ref">{o.publicRef}</h2>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {o.buyer.name ?? o.shippingAddress.recipientName} · {formatXaf(o.total)}
        {payment ? ` · ${OPERATORS[payment.operator]}` : ''}
      </p>
      <ol className="timeline">
        {STEPS.map(([status, stepLabel], i) => {
          const at = reached.get(status);
          return (
            <li key={status} className={at ? '' : i === next ? 'next' : 'todo'}>
              <strong>{stepLabel}</strong>
              <div className="small muted">{at ? formatDateTime(at) : 'En attente'}</div>
            </li>
          );
        })}
      </ol>
      <p className="eyebrow">Contacter</p>
      <div className="chips">
        <a className="button secondary" href={`tel:${o.buyer.phone}`}>
          Acheteur · {displayPhone(o.buyer.phone)}
        </a>
        <a className="button secondary" href={`tel:${o.sellerContact.phone}`}>
          Vendeur
        </a>
        {o.delivery?.riderPhone ? (
          <a className="button secondary" href={`tel:${o.delivery.riderPhone}`}>
            Livreur
          </a>
        ) : null}
      </div>
      <div className="chips">
        <Link className="button secondary" href={`/commandes/${o.id}`}>
          Dossier complet
        </Link>
        {['preparing', 'ready_for_pickup'].includes(o.status) ? (
          <Link className="button secondary" href="/livraisons">
            {o.delivery?.riderPhone ? 'Réassigner le livreur' : 'Assigner un livreur'}
          </Link>
        ) : null}
        {o.dispute ? (
          <Link className="button secondary" href={`/litiges/${o.dispute.id}`}>
            Voir le litige
          </Link>
        ) : null}
      </div>
      {!FINAL.includes(o.status) ? (
        <form action={cancel.bind(null, o.id, back)} className="stack">
          <label>
            Motif de l'annulation (journal d'audit)
            <input name="reason" minLength={3} maxLength={300} required />
          </label>
          <SubmitButton
            variant="danger"
            confirm="Annuler cette commande et rembourser l'acheteur ?"
          >
            Annuler et rembourser
          </SubmitButton>
        </form>
      ) : null}
    </aside>
  );
}

/** Commandes (maquette) : onglets par statut, recherche, tableau et volet de détail. */
export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const { one, ok, erreur } = await readParams(searchParams);
  const q = one('q')?.trim() ?? '';
  const tab = TABS.find(([key]) => key === one('onglet')) ?? TABS[0]!;
  const selected = one('id');
  const query = (extra: Record<string, string>) => {
    const params = new URLSearchParams({
      ...(q ? { q } : {}),
      ...(tab[0] !== 'toutes' ? { onglet: tab[0] } : {}),
      ...extra,
    });
    const text = params.toString();
    return `/commandes${text ? `?${text}` : ''}`;
  };
  let data: Awaited<ReturnType<typeof search>> | null = null;
  let searchError: string | null = null;
  async function search() {
    return load((api) =>
      api.GET('/v1/support/orders', {
        params: {
          query: { ...(q ? { q } : {}), ...(tab[2] ? { status: tab[2].join(',') } : {}) },
        },
      }),
    );
  }
  try {
    data = await search();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    searchError = error.message;
  }
  const counts = data?.counts ?? {};
  const countOf = (statuses: OrderStatus[] | null) =>
    statuses
      ? statuses.reduce((n, s) => n + (counts[s] ?? 0), 0)
      : Object.values(counts).reduce((n, c) => n + c, 0);
  const items = data?.items ?? [];

  return (
    <>
      <header className="page-header">
        <h1>Commandes</h1>
        <form className="inline" role="search">
          {tab[0] !== 'toutes' ? <input type="hidden" name="onglet" value={tab[0]} /> : null}
          <Search size={18} className="muted" aria-hidden />
          <input
            name="q"
            defaultValue={q}
            placeholder="N° de commande ou téléphone"
            aria-label="Référence ou téléphone"
            size={30}
          />
          <button type="submit" className="button">
            Chercher
          </button>
        </form>
      </header>
      <Flash ok={ok} erreur={erreur ?? searchError ?? undefined} />
      <Tabs
        items={TABS.map(([key, label, statuses]) => ({
          href: `/commandes?${new URLSearchParams({ ...(q ? { q } : {}), ...(key !== 'toutes' ? { onglet: key } : {}) })}`,
          label,
          active: key === tab[0],
          count: countOf(statuses),
        }))}
      />
      <div className={selected ? 'split' : ''}>
        {items.length === 0 && !searchError ? (
          <Empty>Aucune commande{q ? ` pour « ${q} »` : ''}.</Empty>
        ) : items.length ? (
          <div className="card table-card">
            <table>
              <thead>
                <tr>
                  <th>Commande</th>
                  <th>Heure</th>
                  <th>Acheteur</th>
                  <th>Vendeur</th>
                  <th>Livreur</th>
                  <th className="num">Montant</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => {
                  const [label, tone] = ORDER_SHORT[o.status];
                  return (
                    <tr key={o.id} className={o.id === selected ? 'selected' : ''}>
                      <td>
                        <Link
                          href={query({ id: o.id })}
                          className="ref"
                          data-testid={`order-${o.publicRef}`}
                          scroll={false}
                        >
                          {o.publicRef}
                        </Link>
                      </td>
                      <td className="muted nowrap">{time(o.createdAt)}</td>
                      <td>{o.buyerName ?? '—'}</td>
                      <td className="muted">{o.seller.shopName}</td>
                      <td className="muted">{o.riderName ?? '—'}</td>
                      <td className="num">
                        <strong>{formatXaf(o.total)}</strong>
                      </td>
                      <td>
                        <Badge tone={tone}>{label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {selected ? <OrderPanel id={selected} back={query({ id: selected })} /> : null}
      </div>
    </>
  );
}
