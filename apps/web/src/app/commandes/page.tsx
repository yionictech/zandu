import type { OrderStatus } from '@zandu/api-client';
import { AlertTriangle, Check, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { mine, userClient } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { STATUS_SHORT } from '@/lib/labels';
import { endSession } from '@/lib/session';
import { Price } from '@/components/Price';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Mes commandes', robots: { index: false } };

const DONE: OrderStatus[] = ['completed', 'refunded', 'cancelled'];
/** Avancement de la barre (maquette « Commandes ») : payée → remise. */
const PROGRESS: Partial<Record<OrderStatus, number>> = {
  pending_payment: 0.05,
  paid: 0.2,
  preparing: 0.4,
  ready_for_pickup: 0.55,
  in_delivery: 0.75,
  awaiting_collection: 0.85,
  delivered: 0.95,
  disputed: 0.95,
};

async function logout() {
  'use server';
  await (await userClient()).POST('/v1/auth/logout');
  await endSession();
  redirect('/');
}

/** Mes commandes : en cours (barre d'avancement) ou terminées (« Racheter »). */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { vue } = await searchParams;
  const { items } = await mine('/commandes', (api) => api.GET('/v1/orders'));
  const finished = items.filter((o) => DONE.includes(o.status));
  const current = items.filter((o) => !DONE.includes(o.status));
  const showDone =
    vue === 'terminees' || (vue === undefined && !current.length && !!finished.length);
  const shown = showDone ? finished : current;
  return (
    <main style={{ maxWidth: 680 }}>
      <h1>Mes commandes</h1>
      <nav className="tabs" aria-label="Commandes">
        <Link href="/commandes?vue=en-cours" className={`chip ${showDone ? '' : 'active'}`}>
          En cours · {current.length}
        </Link>
        <Link href="/commandes?vue=terminees" className={`chip ${showDone ? 'active' : ''}`}>
          Terminées · {finished.length}
        </Link>
      </nav>
      {shown.length === 0 ? (
        <p className="card muted">
          {items.length ? 'Rien dans cette liste.' : 'Vous n’avez pas encore passé de commande.'}
        </p>
      ) : null}
      {shown.map((o) => {
        const reviewed = o.items.every((i) => i.reviewed);
        return (
          <article key={o.id} className="card order-card" data-testid={`order-${o.publicRef}`}>
            <Link href={`/commandes/${o.id}`} className="stack" style={{ gap: 6 }}>
              <div className="row small">
                <strong>{o.publicRef}</strong>
                <span className="muted">{formatDateTime(o.createdAt)}</span>
              </div>
              <div className="row" style={{ alignItems: 'baseline' }}>
                <span className="tile-title" style={{ minHeight: 0 }}>
                  {o.items.map((i) => i.title).join(', ')}
                </span>
                <Price value={o.total} size="sm" />
              </div>
              {!showDone ? (
                <div className="progress" aria-hidden>
                  <span style={{ width: `${(PROGRESS[o.status] ?? 0) * 100}%` }} />
                </div>
              ) : null}
            </Link>
            <div className="foot">
              {o.status === 'disputed' ? (
                <span className="state problem">
                  <AlertTriangle className="icon" aria-hidden />
                  {STATUS_SHORT[o.status]}
                </span>
              ) : showDone ? (
                <span className={`state ${o.status === 'completed' ? 'done' : ''}`}>
                  <Check className="icon" aria-hidden />
                  {STATUS_SHORT[o.status]}
                  {o.status === 'completed' && reviewed ? ' · avis publié' : ''}
                </span>
              ) : (
                <span className="state">
                  <Truck className="icon" aria-hidden />
                  {STATUS_SHORT[o.status]} · {o.seller.shopName}
                </span>
              )}
              {showDone ? (
                <Link href={`/racheter/${o.id}`} className="button secondary small">
                  Racheter
                </Link>
              ) : null}
            </div>
          </article>
        );
      })}
      <form action={logout}>
        <button type="submit" className="button ghost block">
          Se déconnecter
        </button>
      </form>
    </main>
  );
}
