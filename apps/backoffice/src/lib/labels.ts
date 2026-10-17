import type {
  DisputeReason,
  KycDocumentType,
  OrderStatus,
  VerificationStatus,
} from '@zandu/api-client';

type Tone = 'trust' | 'waiting' | 'danger' | 'brand' | 'neutral';

export const VERIFICATION: Record<VerificationStatus, [string, Tone]> = {
  unverified: ['Dossier incomplet', 'neutral'],
  pending_review: ['À vérifier', 'waiting'],
  verified: ['Vérifiée', 'trust'],
  rejected: ['Refusée', 'danger'],
  suspended: ['Suspendue', 'danger'],
};

export const DOCUMENTS: Record<KycDocumentType, string> = {
  national_id: "Carte nationale d'identité",
  passport: 'Passeport',
  residence_proof: 'Justificatif de domicile',
  selfie: 'Selfie avec la pièce',
  rccm: 'RCCM',
  niu: 'NIU',
};

export const ORDER_STATUS: Record<OrderStatus, [string, Tone]> = {
  pending_payment: ['En attente de paiement', 'neutral'],
  paid: ['Payée — attend le vendeur', 'waiting'],
  preparing: ['En préparation', 'waiting'],
  ready_for_pickup: ['Prête pour le livreur', 'brand'],
  in_delivery: ['En livraison', 'brand'],
  awaiting_collection: ['Au point relais', 'brand'],
  delivered: ['Remise — délai de réclamation', 'trust'],
  completed: ['Terminée', 'trust'],
  disputed: ['Litige', 'danger'],
  refunded: ['Remboursée', 'neutral'],
  cancelled: ['Annulée', 'neutral'],
};

export const DISPUTE_REASON: Record<DisputeReason, string> = {
  not_received: 'Rien reçu',
  not_as_described: "Différent de l'annonce",
  damaged: 'Abîmé',
  counterfeit: 'Contrefaçon',
  missing_items: 'Articles manquants',
  other: 'Autre',
};

export const MONEY_STATUS: Record<string, [string, Tone]> = {
  created: ['Créé', 'neutral'],
  pending: ['En attente', 'waiting'],
  processing: ['En cours', 'waiting'],
  succeeded: ['Réussi', 'trust'],
  failed: ['Échec', 'danger'],
  expired: ['Expiré', 'neutral'],
};

export const ALERT_KIND = {
  payout_failed: 'Reversement vendeur en échec',
  refund_failed: 'Remboursement acheteur en échec',
  dispute_overdue: 'Litige en retard',
} as const;

/** Libellé d'un compte du grand livre (les comptes par vendeur et par livreur sont regroupés). */
export function accountLabel(code: string): string {
  const fixed: Record<string, string> = {
    'liability:escrow': 'Séquestre (argent des acheteurs en attente de livraison)',
    'liability:refunds_in_transit': 'Remboursements en cours',
    'liability:payouts_in_transit': 'Reversements en cours',
    'liability:suspense': "Compte d'attente (à régulariser)",
    'revenue:commission': 'Commissions Zandu',
    'revenue:delivery_margin': 'Marge sur la livraison',
    'expense:payment_fees': "Frais de l'agrégateur",
  };
  if (fixed[code]) return fixed[code];
  if (code.startsWith('asset:provider_cash:'))
    return `Trésorerie chez l'agrégateur (${code.slice(20)})`;
  if (code.startsWith('liability:seller_payable:')) return 'Dû aux vendeurs';
  if (code.startsWith('liability:courier_payable:')) return 'Dû aux livreurs partenaires';
  return code;
}

/** Motif d'un remboursement : code du domaine (« seller_rejected: Rupture ») → texte lisible. */
export function refundReason(reason: string): string {
  const [code = '', ...detail] = reason.split(':');
  const labels: Record<string, string> = {
    buyer_cancelled: "Annulée par l'acheteur",
    seller_rejected: 'Refusée par le vendeur',
    seller_acceptance_timeout: 'Vendeur sans réponse sous 24 h',
    support: 'Annulée par le support',
    dispute_refund_full: 'Litige : remboursement intégral',
    dispute_refund_partial: 'Litige : remboursement partiel',
    late_payment: 'Paiement arrivé après expiration',
  };
  const label = labels[code.trim()] ?? reason;
  const text = detail.join(':').trim();
  return text && labels[code.trim()] ? `${label} — ${text}` : label;
}
