import { describe, expect, it } from 'vitest';
import {
  allocatePoints,
  capturePayment,
  earnedPoints,
  LOYALTY,
  maxRedeemable,
  PlatformAccounts,
  providerCashAccount,
  redeemablePoints,
  releaseEscrow,
  restoreLoyalty,
  splitRefund,
  sum,
} from '../src/index.js';

describe('Points fidélité', () => {
  it('1 point par 100 FCFA payés et gardés', () => {
    expect(earnedPoints(25_990)).toBe(259);
    expect(earnedPoints(0)).toBe(0);
    expect(LOYALTY.referralBonus).toBe(1000);
  });

  it('utilisation : 500 au moins, la moitié des articles au plus, jamais plus que le solde', () => {
    expect(maxRedeemable(5_000, 4_000)).toBe(2_000);
    expect(redeemablePoints(0, 5_000, 4_000)).toBe(0);
    expect(redeemablePoints(1_500, 5_000, 4_000)).toBe(1_500);
    expect(() => redeemablePoints(300, 5_000, 4_000)).toThrow(/Au moins 500/);
    expect(() => redeemablePoints(2_500, 5_000, 4_000)).toThrow(/Au plus 2000/);
    expect(() => redeemablePoints(1_000, 800, 40_000)).toThrow(/pas assez/);
  });

  it('répartit les points entre les commandes, au centime près', () => {
    const shares = allocatePoints(1_000, [30_000, 10_000, 5_000]);
    expect(sum(shares)).toBe(1_000);
    expect(shares[0]).toBeGreaterThan(shares[1]!);
  });

  it('rembourse l’argent payé d’abord, recrédite les points ensuite', () => {
    // Commande de 12 000 payée 10 000 + 2 000 points.
    expect(
      splitRefund({ total: 12_000, pointsUsed: 2_000, refundedBefore: 0, amount: 12_000 }),
    ).toEqual({ cash: 10_000, points: 2_000 });
    expect(
      splitRefund({ total: 12_000, pointsUsed: 2_000, refundedBefore: 0, amount: 4_000 }),
    ).toEqual({ cash: 4_000, points: 0 });
    expect(
      splitRefund({ total: 12_000, pointsUsed: 2_000, refundedBefore: 9_000, amount: 3_000 }),
    ).toEqual({ cash: 1_000, points: 2_000 });
  });

  it('grand livre : Zandu paie les points, le vendeur reçoit tout ; annulation : charge annulée', () => {
    const capture = capturePayment({
      paymentId: 'p',
      provider: 'simulator',
      orders: [{ orderId: 'o', total: 12_000 }],
      loyaltyPoints: 2_000,
    });
    expect(capture.lines).toContainEqual({
      account: providerCashAccount('simulator'),
      amount: 10_000,
    });
    expect(capture.lines).toContainEqual({
      account: PlatformAccounts.loyaltyRewards,
      amount: 2_000,
    });
    expect(capture.lines).toContainEqual({
      account: PlatformAccounts.escrow,
      amount: -12_000,
      orderId: 'o',
    });
    const release = releaseEscrow({
      orderId: 'o',
      sellerId: 's',
      courierPartnerId: 'c',
      itemsSubtotal: 10_000,
      deliveryFee: 2_000,
      courierShare: 1_500,
      commissionTotal: 1_000,
      refundedAmount: 0,
    });
    expect(release.sellerNet).toBe(9_000);
    const restore = restoreLoyalty({ key: 'r1', orderId: 'o', points: 2_000 });
    expect(restore.lines).toEqual([
      { account: PlatformAccounts.escrow, amount: 2_000, orderId: 'o' },
      { account: PlatformAccounts.loyaltyRewards, amount: -2_000 },
    ]);
    expect(() =>
      capturePayment({
        paymentId: 'p2',
        provider: 'simulator',
        orders: [{ orderId: 'o2', total: 1_000 }],
        loyaltyPoints: 1_000,
      }),
    ).toThrow();
  });
});
