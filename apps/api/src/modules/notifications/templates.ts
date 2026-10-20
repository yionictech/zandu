/**
 * Modèles de messages en français. Les traductions lingala / kituba s'ajoutent ici sans
 * toucher au code métier (exigence « textes séparés du code »).
 */
type Vars = Record<string, string>;

export const TEMPLATES: Record<string, (v: Vars) => string> = {
  otp_code: (v) =>
    `Zandu : votre code est ${v.code}. Il expire dans 5 minutes. Ne le communiquez à personne, même au support.`,
  buyer_payment_confirmed: (v) =>
    `Zandu : paiement de ${v.amount} reçu pour la commande ${v.ref}. Votre argent est bloqué en sécurité jusqu'à la livraison.`,
  buyer_handover_code: (v) =>
    `Zandu : code de remise de la commande ${v.ref} : ${v.code}. Donnez-le au livreur uniquement quand vous avez le colis en main.`,
  seller_new_order: (v) =>
    `Zandu : nouvelle commande ${v.ref} payée (${v.amount}). Acceptez-la dans l'application avant ${v.deadline}.`,
  buyer_order_accepted: (v) => `Zandu : le vendeur prépare votre commande ${v.ref}.`,
  buyer_in_delivery: (v) =>
    `Zandu : votre commande ${v.ref} est en route. Préparez votre code de remise.`,
  buyer_awaiting_collection: (v) => `Zandu : votre commande ${v.ref} vous attend au point relais.`,
  buyer_delivered: (v) =>
    `Zandu : commande ${v.ref} remise. Un problème ? Signalez-le dans l'application avant ${v.deadline}.`,
  seller_order_completed: (v) =>
    `Zandu : commande ${v.ref} terminée. ${v.amount} ont été crédités sur votre solde.`,
  order_cancelled: (v) =>
    `Zandu : la commande ${v.ref} est annulée.${v.refund ? ` Remboursement de ${v.refund} en cours.` : ''}`,
  seller_dispute_opened: (v) =>
    `Zandu : un litige est ouvert sur la commande ${v.ref}. Le reversement est suspendu.`,
  buyer_refunded: (v) =>
    `Zandu : remboursement de ${v.amount} envoyé sur votre compte Mobile Money.`,
  seller_payout_sent: (v) =>
    `Zandu : reversement de ${v.amount} envoyé sur votre compte Mobile Money.`,
  buyer_late_payment: (v) =>
    `Zandu : votre paiement de ${v.amount} est arrivé après l'expiration de la commande. Il vous est remboursé automatiquement.`,
  support_alert: (v) => `[Zandu support] ${v.message}`,
  staff_access: (v) =>
    `Zandu back-office : ${v.message} Si vous n'êtes pas au courant, prévenez immédiatement un administrateur.`,
};

/**
 * Messages qui passent d'abord par une notification sur le téléphone (quand l'application est
 * installée et connectée), avec leur titre. `fallback` : doublée par WhatsApp puis SMS si elle
 * n'est ni ouverte ni suivie d'une visite dans l'application sous PUSH_FALLBACK_MINUTES — pour
 * ce qui demande d'agir (accepter une commande, être là pour la livraison) ou touche à l'argent.
 * Les autres restent de simples nouvelles. Codes (connexion, remise) et accès du personnel : SMS.
 */
export const PUSH: Record<string, { title: string; fallback: boolean }> = {
  seller_new_order: { title: 'Nouvelle commande', fallback: true },
  seller_dispute_opened: { title: 'Litige ouvert', fallback: true },
  seller_order_completed: { title: 'Argent crédité', fallback: false },
  seller_payout_sent: { title: 'Reversement envoyé', fallback: true },
  buyer_payment_confirmed: { title: 'Paiement reçu', fallback: false },
  buyer_order_accepted: { title: 'Commande en préparation', fallback: false },
  buyer_in_delivery: { title: 'Commande en route', fallback: true },
  buyer_awaiting_collection: { title: 'Colis au point relais', fallback: true },
  buyer_delivered: { title: 'Commande remise', fallback: false },
  order_cancelled: { title: 'Commande annulée', fallback: true },
  buyer_refunded: { title: 'Remboursement envoyé', fallback: true },
  buyer_late_payment: { title: 'Paiement remboursé', fallback: true },
};

/**
 * Centre de notifications de l'application : titres des messages montrés, et textes remplacés
 * quand le message d'origine ne doit pas être relu dans l'application. Les codes de connexion et
 * les messages du personnel n'y figurent pas.
 */
export const INBOX_HIDDEN = ['otp_code', 'staff_access', 'support_alert'];
export const INBOX: Record<string, { title: string; body?: string }> = {
  ...Object.fromEntries(Object.entries(PUSH).map(([k, v]) => [k, { title: v.title }])),
  buyer_handover_code: {
    title: 'Code de remise',
    body: "Votre code est arrivé par SMS. Ne le donnez au livreur qu'une fois le colis en main.",
  },
};

/** Texte d'une notification : sans le préfixe « Zandu : », le titre le remplace. */
export const pushBody = (text: string): string => text.replace(/^Zandu : /, '');

export function render(template: string, variables: Vars): string {
  const fn = TEMPLATES[template];
  if (!fn) throw new Error(`Modèle de message inconnu : ${template}`);
  return fn(variables);
}
