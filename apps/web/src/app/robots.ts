import type { MetadataRoute } from 'next';
import { RECETTE, SITE_URL } from '@/lib/api';

// Lu au démarrage du serveur, pas à la compilation : la même image sert la recette et la production.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  if (RECETTE) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/commande', '/paiement', '/commandes', '/connexion', '/panier', '/api'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
