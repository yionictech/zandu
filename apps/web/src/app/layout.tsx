import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { RECETTE, SITE_URL } from '@/lib/api';
import { sessionToken } from '@/lib/session';
import { CartCount } from '@/components/CartCount';
import { LateFonts } from '@/components/LateFonts';
import { OfflineSupport } from '@/components/OfflineSupport';
import '@zandu/design/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Zandu — achetez et vendez en confiance, payé par Mobile Money',
    template: '%s · Zandu',
  },
  description:
    "La place de marché du Congo : payez avec MTN MoMo ou Airtel Money, votre argent reste bloqué jusqu'à la livraison.",
  applicationName: 'Zandu',
  openGraph: { siteName: 'Zandu', locale: 'fr_CG', type: 'website' },
  ...(RECETTE && { robots: { index: false, follow: false } }),
};

export const viewport: Viewport = { themeColor: '#0B0E15', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const signedIn = (await sessionToken()) !== null;
  return (
    <html lang="fr">
      <body>
        {RECETTE && (
          <div className="recette-banner" role="note">
            Site de test · paiements simulés
          </div>
        )}
        <header className="header">
          <div className="header-row">
            <Link href="/" className="logo" aria-label="Zandu, accueil">
              zandu<span className="logo-dot">.</span>
            </Link>
            <form action="/recherche" className="search" role="search">
              <input
                name="q"
                type="search"
                placeholder="Téléphone, pagne, ventilateur…"
                aria-label="Rechercher"
              />
              <button type="submit" aria-label="Lancer la recherche">
                Chercher
              </button>
            </form>
            <Link href="/panier" className="header-link" data-testid="header-cart">
              Panier
              <CartCount />
            </Link>
            <Link href={signedIn ? '/commandes' : '/connexion'} className="header-link">
              {signedIn ? 'Achats' : 'Connexion'}
            </Link>
          </div>
        </header>
        <Suspense fallback={null}>
          <OfflineSupport signedIn={signedIn} />
          <LateFonts />
        </Suspense>
        <div className="trust-banner">🛡 Mobile Money protégé jusqu’à la livraison</div>
        {children}
        <footer className="footer">
          Zandu · Pointe-Noire et Brazzaville · Paiement MTN MoMo et Airtel Money ·{' '}
          <Link href="/vendre">Vendre sur Zandu</Link>
        </footer>
      </body>
    </html>
  );
}
