import { Redirect, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { t } from '../i18n/fr';
import { useSession } from '../session';
import { Empty, Loading } from './Layout';

type Role = 'seller' | 'rider';

/**
 * Garde des espaces vendeur et livreur : connexion d'abord ; sans boutique, l'espace vendeur
 * mène à « Ouvrir ma boutique ».
 */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { ready, user } = useSession();
  const pathname = usePathname();
  if (!ready) return <Loading />;
  if (!user) return <Redirect href={{ pathname: '/connexion', params: { next: pathname } }} />;
  if (!user.roles.includes(role)) {
    if (role === 'seller') return <Redirect href="/vendeur/ouvrir" />;
    return <Empty message={t.rider.notRider} />;
  }
  return <>{children}</>;
}

/** Écran d'un compte (notifications…) : connexion d'abord, puis retour à l'écran. */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const { ready, user } = useSession();
  const pathname = usePathname();
  if (!ready) return <Loading />;
  if (!user) return <Redirect href={{ pathname: '/connexion', params: { next: pathname } }} />;
  return <>{children}</>;
}
