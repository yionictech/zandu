import { DomainError } from './errors.js';
import { applyRate, assertRateBps } from './money.js';

export type CommissionScope = 'default' | 'category' | 'seller';

export interface CommissionRule {
  scope: CommissionScope;
  rateBps: number;
  categoryId?: string | null;
  sellerId?: string | null;
  validFrom: Date;
  validTo?: Date | null;
}

export interface CommissionTarget {
  sellerId: string;
  /** Catégorie du produit puis ses ancêtres, de la plus précise à la racine. */
  categoryPath: readonly string[];
}

function isActive(rule: CommissionRule, at: Date): boolean {
  return rule.validFrom <= at && (rule.validTo == null || at < rule.validTo);
}

/** Parmi plusieurs règles du même niveau, la plus récemment entrée en vigueur l'emporte. */
function latest(rules: CommissionRule[]): CommissionRule | undefined {
  return rules.reduce<CommissionRule | undefined>(
    (best, r) => (best === undefined || r.validFrom > best.validFrom ? r : best),
    undefined,
  );
}

/**
 * Résout le taux applicable à un article. Priorité : règle vendeur (ex. offre de lancement
 * à 0 % pour les 200 premiers vendeurs) > catégorie la plus précise > taux par défaut.
 */
export function resolveCommissionRate(
  rules: readonly CommissionRule[],
  target: CommissionTarget,
  at: Date,
): number {
  const active = rules.filter((r) => isActive(r, at));

  const sellerRule = latest(
    active.filter((r) => r.scope === 'seller' && r.sellerId === target.sellerId),
  );
  if (sellerRule) return sellerRule.rateBps;

  for (const categoryId of target.categoryPath) {
    const rule = latest(
      active.filter((r) => r.scope === 'category' && r.categoryId === categoryId),
    );
    if (rule) return rule.rateBps;
  }

  const fallback = latest(active.filter((r) => r.scope === 'default'));
  if (!fallback) {
    throw new DomainError('commission_not_configured', 'Aucun taux de commission par défaut actif');
  }
  return fallback.rateBps;
}

/** Commission d'une ligne de commande, figée au moment de l'achat. */
export function lineCommission(lineTotal: number, rateBps: number): number {
  assertRateBps(rateBps);
  return applyRate(lineTotal, rateBps);
}
