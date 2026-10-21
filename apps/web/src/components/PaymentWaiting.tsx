'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const pad = (n: number) => String(n).padStart(2, '0');
/** Durée de validité d'une demande de paiement (PAYMENT_TTL_MINUTES, 10 min par défaut). */
const RING_SECONDS = 600;

/**
 * Attente de la validation du code PIN sur le téléphone : compte à rebours et interrogation
 * légère toutes les 3 s (quelques centaines d'octets). La vérité vient du webhook signé reçu
 * par l'API ; cette page ne fait que l'afficher.
 */
export function PaymentWaiting({
  paymentId,
  expiresAt,
  retryHref,
  simulator,
}: {
  paymentId: string;
  expiresAt: string;
  retryHref: string;
  simulator: boolean;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/paiements/${paymentId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const payment = (await res.json()) as {
          status: string;
          failure: { message: string } | null;
        };
        if (payment.status === 'succeeded') router.refresh();
        else if (payment.status === 'failed' || payment.status === 'expired')
          router.replace(
            `${retryHref}${retryHref.includes('?') ? '&' : '?'}erreur=${encodeURIComponent(
              payment.failure?.message ?? 'Le paiement n’a pas abouti.',
            )}`,
          );
      } catch {
        // réseau coupé : on réessaie au prochain tour
      }
    }, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [paymentId, retryHref, router]);
  const left = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
  return (
    <>
      {/* Anneau de 10 minutes (maquette) : la part restante en corail. */}
      <div className="ring" style={{ ['--left' as string]: Math.min(1, left / RING_SECONDS) }}>
        <div className="ring-inner">
          <div className="countdown" aria-label="Temps restant">
            {pad(Math.floor(left / 60))}:{pad(left % 60)}
          </div>
          <span className="small muted">pour valider</span>
        </div>
      </div>
      {simulator ? (
        <button
          type="button"
          className="button secondary"
          data-testid="payment-simulate"
          onClick={() => void fetch(`/api/paiements/${paymentId}/simuler`, { method: 'POST' })}
        >
          Simuler la validation du PIN (développement)
        </button>
      ) : null}
    </>
  );
}
