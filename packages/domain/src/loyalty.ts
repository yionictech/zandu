import { DomainError } from './errors.js';
import { prorate, sum } from './money.js';

/**
 * Points fidélité Zandu. 1 point = 1 FCFA de réduction, payée par Zandu (le vendeur et le
 * livreur reçoivent leur part entière). Gagnés à la fin d'une commande sur l'argent réellement
 * payé et gardé (1 point par 100 FCFA) ; parrainage : 1 000 points au parrain et au filleul
 * quand la première commande du filleul (5 000 FCFA au moins) est terminée.
 */
export const LOYALTY = {
  /** FCFA payés pour gagner un point. */
  fcfaPerPoint: 100,
  referralBonus: 1000,
  /** Montant minimum de la première commande du filleul pour débloquer le parrainage. */
  referralMinOrder: 5000,
  /** Points utilisables en une fois : au moins… */
  minRedeem: 500,
  /** … et au plus cette part (en %) du montant des articles. */
  maxSharePercent: 50,
} as const;

/** Points gagnés pour une commande terminée : argent payé et gardé, hors points utilisés. */
export function earnedPoints(cashKept: number): number {
  return cashKept > 0 ? Math.floor(cashKept / LOYALTY.fcfaPerPoint) : 0;
}

/** Plafond de points utilisables pour un panier (articles hors livraison). */
export function maxRedeemable(balance: number, itemsTotal: number): number {
  return Math.max(0, Math.min(balance, Math.floor((itemsTotal * LOYALTY.maxSharePercent) / 100)));
}

/** Vérifie une demande d'utilisation de points ; renvoie le nombre de points retenus. */
export function redeemablePoints(requested: number, balance: number, itemsTotal: number): number {
  if (!Number.isSafeInteger(requested) || requested <= 0) return 0;
  if (requested < LOYALTY.minRedeem)
    throw new DomainError('points_too_few', `Au moins ${LOYALTY.minRedeem} points à la fois`);
  if (requested > balance)
    throw new DomainError('points_insufficient', 'Vous n’avez pas assez de points');
  const cap = maxRedeemable(balance, itemsTotal);
  if (requested > cap)
    throw new DomainError(
      'points_too_many',
      `Au plus ${cap} points pour ce panier (la moitié des articles)`,
      { max: cap },
    );
  return requested;
}

/** Répartit les points d'un panier entre ses commandes, au prorata des articles. */
export function allocatePoints(points: number, itemsSubtotals: number[]): number[] {
  const total = sum(itemsSubtotals);
  let left = points;
  return itemsSubtotals.map((items, i) => {
    const share = i === itemsSubtotals.length - 1 ? left : prorate(points, items, total);
    left -= share;
    return share;
  });
}

/**
 * Remboursement d'une commande payée en partie avec des points : l'argent payé repart d'abord
 * (Mobile Money), les points ensuite (recrédités). `refundedBefore` : déjà remboursé avant.
 */
export function splitRefund(input: {
  total: number;
  pointsUsed: number;
  refundedBefore: number;
  amount: number;
}): { cash: number; points: number } {
  const cashPaid = input.total - input.pointsUsed;
  const cashBefore = Math.min(input.refundedBefore, cashPaid);
  const cashAfter = Math.min(input.refundedBefore + input.amount, cashPaid);
  const cash = cashAfter - cashBefore;
  return { cash, points: input.amount - cash };
}
