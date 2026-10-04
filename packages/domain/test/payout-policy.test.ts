import { describe, expect, it } from 'vitest';
import { payableAmount, type PayoutEligibilityInput } from '../src/index.js';

const now = new Date('2027-06-15T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

const base: PayoutEligibilityInput = {
  verificationStatus: 'verified',
  verifiedAt: daysAgo(90),
  payoutNumberChangedAt: null,
  availableBalance: 400_000,
  paidOutInWindow: 0,
  capOverride: null,
  now,
};

describe('payableAmount', () => {
  it('reverse tout le solde à un vendeur établi', () => {
    expect(payableAmount(base)).toEqual({ amount: 400_000, blockedReason: null });
  });

  it('bloque un vendeur non vérifié (il vend, mais n’encaisse pas)', () => {
    expect(
      payableAmount({ ...base, verificationStatus: 'unverified', verifiedAt: null }).blockedReason,
    ).toBe('not_verified');
  });

  it('plafonne un nouveau vendeur pendant 30 jours', () => {
    const fresh = { ...base, verifiedAt: daysAgo(3) };
    expect(payableAmount(fresh)).toEqual({ amount: 150_000, blockedReason: null });
    expect(payableAmount({ ...fresh, paidOutInWindow: 100_000 }).amount).toBe(50_000);
    expect(payableAmount({ ...fresh, paidOutInWindow: 150_000 }).blockedReason).toBe('cap_reached');
    expect(payableAmount({ ...base, verifiedAt: daysAgo(31) }).amount).toBe(400_000);
  });

  it('gèle les reversements 48 h après un changement de numéro', () => {
    const changed = { ...base, payoutNumberChangedAt: new Date(now.getTime() - 3_600_000) };
    expect(payableAmount(changed).blockedReason).toBe('payout_number_cooldown');
  });

  it('respecte un plafond spécifique et un solde nul', () => {
    expect(payableAmount({ ...base, capOverride: 50_000 }).amount).toBe(50_000);
    expect(payableAmount({ ...base, availableBalance: 0 }).blockedReason).toBe('no_balance');
  });
});
