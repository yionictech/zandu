import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/api';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/commande', '/paiement', '/commandes', '/connexion', '/panier', '/api'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
