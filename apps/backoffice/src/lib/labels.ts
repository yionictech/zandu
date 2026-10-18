import type {
  Discrepancy,
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
    'liability:platform_funding': "Apports de Zandu chez l'agrégateur",
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

/** Rapprochement : nature de l'écart, et ce que l'administrateur doit faire. */
export const DISCREPANCY_KIND: Record<Discrepancy['kind'], { label: string; help: string }> = {
  missing_internal: {
    label: 'Inconnu de Zandu',
    help: "L'agrégateur a bougé de l'argent sans opération Zandu correspondante. Demandez-lui le détail ; s'il s'agit de frais, enregistrez-les.",
  },
  missing_provider: {
    label: 'Absent du relevé',
    help: "Zandu a enregistré ce mouvement, l'agrégateur ne l'a pas exécuté. Vérifiez avec lui avant toute nouvelle tentative ; si l'argent n'est jamais parti, passez la différence en compte d'attente.",
  },
  status_mismatch: {
    label: 'Statut différent',
    help: "L'agrégateur a exécuté l'opération, Zandu ne l'a pas enregistrée comme réussie. Pour un reversement échoué chez Zandu, bloquez tout nouveau reversement au vendeur avant de régulariser.",
  },
  amount_mismatch: {
    label: 'Montant différent',
    help: "Demandez la correction à l'agrégateur, ou enregistrez la différence.",
  },
  fee_mismatch: {
    label: 'Frais différents',
    help: 'Les frais du relevé ne sont pas ceux annoncés. Vérifiez la grille tarifaire du contrat, puis enregistrez la différence en frais.',
  },
  balance_mismatch: {
    label: 'Solde inexpliqué',
    help: "Le solde de l'agrégateur contient un mouvement absent de son relevé détaillé. Mettez la différence en compte d'attente le temps de l'enquête.",
  },
};

export const RUN_STATUS: Record<string, [string, Tone]> = {
  balanced: ['Équilibré', 'trust'],
  discrepancies: ['Écarts à traiter', 'danger'],
  error: ['Relevé indisponible', 'danger'],
  running: ['En cours', 'waiting'],
};

export const ADJUSTMENTS = {
  payment_fees: "Frais de l'agrégateur",
  platform_funding: "Apport de Zandu (fonds versés chez l'agrégateur)",
  suspense: "Compte d'attente (à investiguer)",
} as const;

export const STAFF_ROLE = {
  support: 'Agent du support',
  admin: 'Administrateur',
} as const;

/** Journal d'audit : action technique → libellé ; inconnue, elle s'affiche telle quelle. */
const AUDIT_ACTIONS: Record<string, string> = {
  'seller.verified': 'Boutique vérifiée',
  'seller.rejected': 'Boutique refusée',
  'seller.suspended': 'Boutique suspendue',
  'seller.kyc_viewed': "Pièces d'identité consultées",
  'product.approved': 'Produit accepté',
  'product.rejected': 'Produit refusé',
  'delivery.assigned': 'Livreur assigné',
  'dispute.evidence_viewed': "Preuves d'un litige consultées",
  'dispute.resolved': 'Litige tranché',
  'report.orders_exported': 'Export CSV des commandes',
  'commission_rule.created': 'Taux de commission créé',
  'commission_rule.ended': 'Taux de commission terminé',
  'commission_rule.cancelled': 'Taux de commission annulé',
  'reconciliation.run_requested': 'Contrôle de caisse lancé',
  'reconciliation.discrepancy_resolved': 'Écart de caisse clos',
  'staff.added': 'Membre du personnel ajouté',
  'staff.role_changed': 'Rôle changé',
  'staff.revoked': 'Accès retiré',
  'staff.signed_out': 'Déconnexion partout',
  'mfa.enabled': 'Second facteur activé',
  'mfa.reset': 'Second facteur réinitialisé',
};
export const auditAction = (action: string): string => AUDIT_ACTIONS[action] ?? action;

const AUDIT_ENTITIES: Record<string, string> = {
  user: 'compte',
  seller: 'boutique',
  product: 'produit',
  order: 'commande',
  dispute: 'litige',
  report: 'rapport',
  commission_rule: 'taux de commission',
  reconciliation_run: 'contrôle de caisse',
  reconciliation_discrepancy: 'écart de caisse',
};
export const auditEntity = (type: string): string => AUDIT_ENTITIES[type] ?? type;
