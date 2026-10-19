import type { Metadata } from 'next';
import type { ReactNode } from 'react';
// Polices servies par le back-office lui-même, caractères latins seulement.
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/unbounded/latin-700.css';
import '@zandu/design/tokens.css';
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
