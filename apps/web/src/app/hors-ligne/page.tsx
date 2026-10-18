import type { Metadata } from 'next';
import Link from 'next/link';
import { RecentProducts } from '@/components/RecentProducts';

export const metadata: Metadata = { title: 'Hors connexion', robots: { index: false } };

/**
 * Affichée par le service worker quand une page n'a jamais été consultée et que le réseau
 * manque : ce qui reste utile sans réseau (produits déjà vus, panier).
 */
export default function OfflinePage() {
  return (
    <main>
      <div className="card offline-card">
        <h1>Pas de réseau pour le moment</h1>
        <p className="muted">
          Cette page n'a pas encore été enregistrée sur votre téléphone. Elle s'affichera dès le
          retour du réseau. En attendant, vos produits déjà vus et votre panier restent disponibles.
        </p>
        <Link href="/panier" className="button block">
          Voir mon panier
        </Link>
      </div>
      <RecentProducts />
    </main>
  );
}
