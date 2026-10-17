import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Back-office Zandu', template: '%s · Back-office Zandu' },
  robots: { index: false, follow: false },
};

/** Recette (ADR-0013) : rappelle à l'agent que rien n'est réel avant qu'il ne décide. */
const RECETTE = process.env.ZANDU_ENV === 'recette';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        {RECETTE && (
          <div className="recette-banner" role="note">
            Recette : données de test, paiements simulés
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
