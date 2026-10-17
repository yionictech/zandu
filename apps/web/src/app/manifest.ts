import type { MetadataRoute } from 'next';

/** Installable sur l'écran d'accueil (PWA) : une icône, sans passer par un magasin d'applications. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Zandu — marché Mobile Money',
    short_name: 'Zandu',
    description: "Achetez en confiance : paiement Mobile Money protégé jusqu'à la livraison.",
    lang: 'fr',
    start_url: '/',
    display: 'standalone',
    background_color: '#F3F4F6',
    theme_color: '#C2410C',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
