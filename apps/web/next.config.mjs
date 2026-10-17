// @ts-check
import { fileURLToPath } from 'node:url';

/**
 * Site web acheteurs (ADR-0006) : rendu serveur pour que le premier octet contienne déjà le
 * produit, son prix et sa photo (3G, aperçus WhatsApp). Le jeton de session reste côté serveur.
 *
 * @type {import('next').NextConfig}
 */
const config = {
  poweredByHeader: false,
  // Image Docker (ADR-0013) : serveur autonome avec ses seules dépendances, tracées depuis la
  // racine du monorepo. `next start` reste utilisé en développement et pour les parcours.
  ...(process.env.NEXT_OUTPUT === 'standalone' && {
    output: 'standalone',
    outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  }),
  // TypeScript 7 (compilateur natif) : vérification des types par `pnpm typecheck` (ADR-0012).
  typescript: { ignoreBuildErrors: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
};

export default config;
