import { DomainError } from './errors.js';

/**
 * Argent : le franc CFA (XAF) n'a pas de subdivision. Tous les montants sont des entiers
 * de francs, jamais des flottants (cahier des charges §5). Les taux sont en points de base
 * (1 pb = 0,01 % ; 1 000 pb = 10 %) pour rester en arithmétique entière.
 */
export const CURRENCY = 'XAF';
export const BPS_DENOMINATOR = 10_000;

export function assertAmount(value: number, label = 'montant'): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainError('invalid_amount', `${label} doit être un entier FCFA positif ou nul`, {
      value,
    });
  }
}

export function assertPositiveAmount(value: number, label = 'montant'): void {
  assertAmount(value, label);
  if (value === 0) {
    throw new DomainError('invalid_amount', `${label} doit être strictement positif`, { value });
  }
}

export function assertRateBps(rateBps: number): void {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > BPS_DENOMINATOR) {
    throw new DomainError('invalid_rate', 'Le taux doit être un entier entre 0 et 10 000 pb', {
      rateBps,
    });
  }
}

/** Applique un taux, arrondi au franc le plus proche (0,5 arrondi vers le haut). */
export function applyRate(amount: number, rateBps: number): number {
  assertAmount(amount);
  assertRateBps(rateBps);
  const scaled = amount * rateBps;
  if (!Number.isSafeInteger(scaled)) {
    throw new DomainError('amount_overflow', 'Montant trop élevé pour un calcul exact', { amount });
  }
  return Math.floor((scaled + BPS_DENOMINATOR / 2) / BPS_DENOMINATOR);
}

/** Part proportionnelle `amount × part / whole`, arrondie à l'inférieur. */
export function prorate(amount: number, part: number, whole: number): number {
  assertAmount(amount);
  assertAmount(part, 'part');
  assertPositiveAmount(whole, 'total');
  if (part > whole) {
    throw new DomainError('invalid_amount', 'La part ne peut pas dépasser le total', {
      part,
      whole,
    });
  }
  const scaled = amount * part;
  if (!Number.isSafeInteger(scaled)) {
    throw new DomainError('amount_overflow', 'Montant trop élevé pour un calcul exact', { amount });
  }
  return Math.floor(scaled / whole);
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    total += v;
    if (!Number.isSafeInteger(total)) {
      throw new DomainError('amount_overflow', 'Somme trop élevée pour un calcul exact');
    }
  }
  return total;
}

const groupFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** « 25 000 FCFA » — séparateur de milliers français (espace fine insécable). */
export function formatXaf(amount: number): string {
  return `${groupFormatter.format(amount)} FCFA`;
}
