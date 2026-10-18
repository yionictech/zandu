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

export function render(template: string, variables: Vars): string {
  const fn = TEMPLATES[template];
  if (!fn) throw new Error(`Modèle de message inconnu : ${template}`);
  return fn(variables);
}
