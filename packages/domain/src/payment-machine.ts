import { DomainError } from './errors.js';

/**
 * Cycle de vie d'une tentative de paiement Mobile Money.
 *
 *   created ──► pending ──► succeeded
 *      │           ├──────► failed ────┐
 *      │           └──────► expired ───┤ succès tardif (late success) :
 *      └──► failed / expired           └──► succeeded  l'argent a bougé, on le rembourse.
 *
 * Les informations de l'agrégateur arrivent dans le désordre (webhook, interrogation,
 * rejeu) : la fonction est idempotente et ne fait jamais reculer un statut.
 */
export const PAYMENT_STATUSES = ['created', 'pending', 'succeeded', 'failed', 'expired'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Ce que l'agrégateur peut nous dire, ou « expired » quand notre délai de 10 min est écoulé. */
export type PaymentSignal = 'pending' | 'succeeded' | 'failed' | 'expired';

export interface PaymentStatusChange {
  status: PaymentStatus;
  changed: boolean;
  /** Succès arrivé après expiration ou échec : la commande n'existe plus, il faut rembourser. */
  lateSuccess: boolean;
}

const ALLOWED: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  created: ['pending', 'succeeded', 'failed', 'expired'],
  pending: ['succeeded', 'failed', 'expired'],
  expired: ['succeeded'],
  failed: ['succeeded'],
  succeeded: [],
};

export function applyPaymentSignal(
  current: PaymentStatus,
  signal: PaymentSignal,
): PaymentStatusChange {
  const unchanged = { status: current, changed: false, lateSuccess: false };
  if (signal === current) return unchanged;

  if (current === 'succeeded' && signal === 'failed') {
    // L'agrégateur contredit un succès déjà comptabilisé : à traiter par un humain.
    throw new DomainError(
      'payment_status_conflict',
      "L'agrégateur signale un échec sur un paiement réussi",
    );
  }
  if (!ALLOWED[current].includes(signal)) return unchanged; // information périmée : on l'ignore

  return {
    status: signal,
    changed: true,
    lateSuccess: signal === 'succeeded' && (current === 'expired' || current === 'failed'),
  };
}

export function isPaymentActive(status: PaymentStatus): boolean {
  return status === 'created' || status === 'pending';
}
