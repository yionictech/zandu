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
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          Zandu
          <small>Back-office</small>
        </div>
        <Nav
          items={[
            { href: '/', label: 'Tableau de bord' },
            { href: '/vendeurs', label: 'Vérifications', count: q.kycPending },
            { href: '/produits', label: 'Modération', count: q.productsPending },
            { href: '/livraisons', label: 'Livraisons', count: q.deliveriesToAssign },
            {
              href: '/litiges',
              label: 'Litiges',
              count: q.disputesOpen,
              hot: q.disputesOverdue > 0,
            },
            { href: '/commandes', label: 'Commandes' },
            { href: '/alertes', label: 'Alertes', count: q.alerts, hot: q.alerts > 0 },
            { href: '/comptabilite', label: 'Comptabilité' },
          ]}
        />
        <div className="sidebar-footer">
          <span>
            {displayPhone(me.phone)} · {me.roles.includes('admin') ? 'administrateur' : 'support'}
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
