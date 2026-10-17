import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SITE_URL } from '@/lib/api';
import { sessionToken } from '@/lib/session';
import { CartCount } from '@/components/CartCount';
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
};

export const viewport: Viewport = { themeColor: '#C2410C', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const signedIn = (await sessionToken()) !== null;
  return (
    <html lang="fr">
      <body>
        <header className="header">
          <div className="header-row">
            <Link href="/" className="logo" aria-label="Zandu, accueil">
              Zandu
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
