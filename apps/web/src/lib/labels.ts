import type { DisputeReason, OrderStatus } from '@zandu/api-client';

/** Statuts vus par l'acheteur (mêmes textes que l'application). */
export const STATUS: Record<OrderStatus, string> = {
  pending_payment: 'En attente de paiement',
  paid: 'Payée — en attente du vendeur',
  preparing: 'Le vendeur prépare votre commande',
  ready_for_pickup: 'Prête, bientôt en route',
  in_delivery: 'En route',
  awaiting_collection: 'Vous attend au point relais',
  delivered: 'Colis remis',
  completed: 'Terminée',
  disputed: 'Problème signalé — le support examine',
  refunded: 'Remboursée',
  cancelled: 'Annulée',
};

export const STATUS_TONE: Partial<Record<OrderStatus, 'trust' | 'danger' | 'muted'>> = {
  delivered: 'trust',
  completed: 'trust',
  disputed: 'danger',
  refunded: 'muted',
  cancelled: 'muted',
};

export const TIMELINE: Array<[OrderStatus, string]> = [
  ['paid', 'Payée'],
  ['preparing', 'Acceptée par le vendeur'],
  ['ready_for_pickup', 'Prête'],
  ['in_delivery', 'En route'],
  ['delivered', 'Remise'],
  ['completed', 'Terminée'],
];

export const DISPUTE_REASONS: Record<DisputeReason, string> = {
  not_received: 'Je n’ai rien reçu',
  not_as_described: 'Différent de l’annonce',
  damaged: 'Abîmé',
  counterfeit: 'Contrefaçon',
  missing_items: 'Articles manquants',
  other: 'Autre',
};

export const OPERATORS = { mtn: 'MTN MoMo', airtel: 'Airtel Money' } as const;

export const GUARANTEE =
  "Votre argent reste bloqué jusqu'à la livraison. Remboursé si vous ne recevez rien.";
