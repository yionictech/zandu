import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { apiClient, load } from '@/lib/api';
import { displayPhone } from '@/lib/format';
import { endSession } from '@/lib/session';
import { Nav } from '@/components/Nav';

async function logout() {
  'use server';
  await (await apiClient()).POST('/v1/auth/logout');
  await endSession();
  redirect('/connexion');
}

/** Coque du back-office : chaque page vérifie la session ET le second facteur (via l'API). */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const [me, overview] = await Promise.all([
    load((api) => api.GET('/v1/me')),
    load((api) => api.GET('/v1/support/overview')),
  ]);
  const q = overview.queues;
  const admin = me.roles.includes('admin');
  // Écarts de caisse ouverts : signalés dans le menu des administrateurs.
  const reconciliation = admin
    ? await load((api) =>
        api.GET('/v1/admin/reconciliation/runs', { params: { query: { limit: 1 } } }),
      )
    : null;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          zandu<span className="logo-dot">.</span>
          <span className="logo-badge">Admin</span>
        </div>
        <Nav
          items={[
            { href: '/', label: 'Vue d’ensemble', icon: 'home' },
            { href: '/commandes', label: 'Commandes', icon: 'orders' },
            {
              href: '/litiges',
              label: 'Litiges',
              icon: 'disputes',
              count: q.disputesOpen,
              hot: q.disputesOpen > 0,
            },
            {
              href: '/vendeurs',
              label: 'Vendeurs',
              icon: 'sellers',
              count: q.kycPending,
              hot: q.kycPending > 0,
            },
            {
              href: '/livraisons',
              label: 'Livreurs',
              icon: 'riders',
              count: q.deliveriesToAssign,
              hot: q.deliveriesToAssign > 0,
            },
            { href: '/clients', label: 'Clients', icon: 'customers' },
            {
              href: '/produits',
              label: 'Catalogue',
              icon: 'catalog',
              count: q.productsPending,
              hot: q.productsPending > 0,
            },
            {
              href: '/paiements',
              label: 'Paiements',
              icon: 'payments',
              count: q.alerts,
              hot: q.alerts > 0,
            },
            ...(admin
              ? [{ href: '/parametres', label: 'Paramètres', icon: 'settings' as const }]
              : []),
          ]}
        />
        {/* Chiffre d'affaires, taux, caisse et équipe : administrateurs seulement (l'API le vérifie aussi). */}
        {admin ? (
          <Nav
            title="Pilotage"
            items={[
              { href: '/rapports', label: 'Rapports', icon: 'reports' },
              {
                href: '/rapprochement',
                label: 'Rapprochement',
                icon: 'reconciliation',
                count: reconciliation!.open.count,
                hot: reconciliation!.open.count > 0,
              },
              { href: '/commissions', label: 'Commissions', icon: 'commissions' },
              { href: '/personnel', label: 'Personnel', icon: 'staff' },
            ]}
          />
        ) : null}
        <div className="sidebar-footer">
          <span>
            {displayPhone(me.phone)} · {admin ? 'administrateur' : 'support'}
          </span>
          <form action={logout}>
            <button type="submit" className="button secondary">
              Se déconnecter
            </button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
