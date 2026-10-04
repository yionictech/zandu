import { assertAmount } from './money.js';

/**
 * Politique de reversement aux vendeurs. Principe « vendre avant d'être vérifié, encaisser
 * après » : le séquestre protège l'acheteur, la vérification et les plafonds protègent la
 * plateforme contre les faux vendeurs (risque n°1 du business plan).
 */
export interface PayoutPolicy {
  /** Durée pendant laquelle un vendeur fraîchement vérifié est plafonné (cahier §5 : 30 jours). */
  newSellerDays: number;
  /** Plafond de reversement d'un nouveau vendeur sur la fenêtre glissante. */
  newSellerCapAmount: number;
  capWindowHours: number;
  /** Après un changement de numéro de reversement, gel des reversements (anti-piratage). */
  payoutNumberCooldownHours: number;
}

export const DEFAULT_PAYOUT_POLICY: PayoutPolicy = {
  newSellerDays: 30,
  newSellerCapAmount: 150_000,
  capWindowHours: 24,
  payoutNumberCooldownHours: 48,
};

export type PayoutBlockReason =
  'not_verified' | 'payout_number_cooldown' | 'cap_reached' | 'no_balance';

export interface PayoutEligibilityInput {
  verificationStatus: string;
  verifiedAt: Date | null;
  payoutNumberChangedAt: Date | null;
  availableBalance: number;
  /** Montant déjà reversé (ou en cours) sur la fenêtre glissante. */
  paidOutInWindow: number;
  capOverride: number | null;
  now: Date;
}

export interface PayoutEligibility {
  amount: number;
  blockedReason: PayoutBlockReason | null;
}

const HOUR = 3_600_000;

export function payableAmount(
  input: PayoutEligibilityInput,
  policy: PayoutPolicy = DEFAULT_PAYOUT_POLICY,
): PayoutEligibility {
  assertAmount(input.availableBalance, 'solde disponible');
  assertAmount(input.paidOutInWindow, 'montant reversé');
  const blocked = (reason: PayoutBlockReason): PayoutEligibility => ({
    amount: 0,
    blockedReason: reason,
  });

  if (input.verificationStatus !== 'verified' || input.verifiedAt === null)
    return blocked('not_verified');
  if (
    input.payoutNumberChangedAt !== null &&
    input.now.getTime() - input.payoutNumberChangedAt.getTime() <
      policy.payoutNumberCooldownHours * HOUR
  ) {
    return blocked('payout_number_cooldown');
  }
  if (input.availableBalance === 0) return blocked('no_balance');

  const isNewSeller =
    input.now.getTime() - input.verifiedAt.getTime() < policy.newSellerDays * 24 * HOUR;
  const cap = input.capOverride ?? (isNewSeller ? policy.newSellerCapAmount : null);
  if (cap === null) return { amount: input.availableBalance, blockedReason: null };

  const room = Math.max(0, cap - input.paidOutInWindow);
  if (room === 0) return blocked('cap_reached');
  return { amount: Math.min(input.availableBalance, room), blockedReason: null };
}
