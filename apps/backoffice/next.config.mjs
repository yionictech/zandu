// @ts-check

/**
 * Back-office : application distincte, sur un domaine distinct (ADR-0006, ADR-0012).
 * Rendu serveur uniquement : le jeton de session ne quitte jamais le serveur (cookie httpOnly).
 *
 * @type {import('next').NextConfig}
 */
const config = {
  poweredByHeader: false,
  // TypeScript 7 (compilateur natif) n'expose pas l'API JavaScript qu'utilise `next build` :
  // la vérification des types passe par `pnpm typecheck`, exécutée en CI.
  typescript: { ignoreBuildErrors: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Les URL signées des pièces KYC ne doivent pas fuiter vers d'autres sites.
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default config;
