import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { mine, userClient } from '@/lib/api';
import { formatDateTime, formatXaf } from '@/lib/format';
import { STATUS, STATUS_TONE } from '@/lib/labels';
import { endSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Mes achats', robots: { index: false } };

async function logout() {
  'use server';
  await (await userClient()).POST('/v1/auth/logout');
  await endSession();
  redirect('/');
}

export default async function OrdersPage() {
  const { items } = await mine('/commandes', (api) => api.GET('/v1/orders'));
  return (
    <main style={{ maxWidth: 680 }}>
      <h1>Mes achats</h1>
      {items.length === 0 ? (
        <p className="card muted">Vous n’avez pas encore passé de commande.</p>
      ) : null}
      {items.map((o) => (
        <Link
          key={o.id}
          href={`/commandes/${o.id}`}
          className="card stack"
          data-testid={`order-${o.publicRef}`}
        >
          <div className="row small">
            <strong>{o.publicRef}</strong>
            <span className="muted">{formatDateTime(o.createdAt)}</span>
          </div>
          <span className={`status ${STATUS_TONE[o.status] ?? ''}`} style={{ fontSize: 16 }}>
            {STATUS[o.status]}
          </span>
          <div className="row small">
            <span className="muted">
              {o.seller.shopName} · {o.items.map((i) => i.title).join(', ')}
            </span>
            <strong>{formatXaf(o.total)}</strong>
          </div>
        </Link>
      ))}
      <form action={logout}>
        <button type="submit" className="button ghost block">
          Se déconnecter
        </button>
      </form>
    </main>
  );
}
