'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';

function subscribe(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/**
 * Site utilisable quand le réseau coupe (ADR-0016) : installe le service worker, prévient
 * l'acheteur qu'il voit une version enregistrée, et fait oublier les pages personnelles
 * (suivi de commande) dès qu'il n'est plus connecté.
 */
export function OfflineSupport({ signedIn }: { signedIn: boolean }) {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );

  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  // Pages ouvertes par un lien du site : le service worker n'a pas vu passer leur HTML.
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false; // la page chargée en entier est déjà enregistrée
      return;
    }
    if (!navigator.onLine || !navigator.serviceWorker?.controller) return;
    fetch(search ? `${pathname}?${search}` : pathname, {
      headers: { accept: 'text/html', 'x-zandu-remember': '1' },
    }).catch(() => undefined);
  }, [pathname, search]);

  useEffect(() => {
    if (signedIn || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready
      .then((registration) => registration.active?.postMessage('forget-private'))
      .catch(() => undefined);
  }, [signedIn]);

  if (online) return null;
  return (
    <div className="offline-banner" role="status" data-testid="offline-banner">
      Hors connexion : vous voyez la dernière version enregistrée. Votre panier est gardé ; le
      paiement attendra le retour du réseau.
    </div>
  );
}
