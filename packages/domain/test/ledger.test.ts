import { describe, expect, it } from 'vitest';
import {
  PlatformAccounts,
  assertBalanced,
  capturePayment,
  captureLatePayment,
  courierPayableAccount,
  naturalBalance,
  providerCashAccount,
  releaseEscrow,
  reservePayout,
  reserveRefund,
  reversePayout,
  sellerPayableAccount,
  settlePayout,
  settleRefund,
  type Journal,
} from '../src/index.js';

/** Mini grand livre en mémoire pour vérifier les soldes après une suite d'écritures. */
class Book {
  private readonly raw = new Map<string, number>();
  private readonly escrowByOrder = new Map<string, number>();
  private readonly keys = new Set<string>();

  post(j: Journal): void {
    assertBalanced(j);
    if (this.keys.has(j.idempotencyKey)) throw new Error(`doublon ${j.idempotencyKey}`);
    this.keys.add(j.idempotencyKey);
    for (const l of j.lines) {
      this.raw.set(l.account, (this.raw.get(l.account) ?? 0) + l.amount);
      if (l.account === PlatformAccounts.escrow && l.orderId) {
        this.escrowByOrder.set(l.orderId, (this.escrowByOrder.get(l.orderId) ?? 0) - l.amount);
      }
    }
  }

  balance(account: string): number {
    return naturalBalance(account, this.raw.get(account) ?? 0);
  }

  escrowOf(orderId: string): number {
    return this.escrowByOrder.get(orderId) ?? 0;
  }

  trialBalance(): number {
    return [...this.raw.values()].reduce((a, b) => a + b, 0);
  }
}

const PROVIDER = 'pawapay';
const cash = providerCashAccount(PROVIDER);

describe('grand livre — parcours complet d’une vente', () => {
  it('exemple du business plan : 50 000 FCFA, 10 % de commission, livraison 2 000 dont 1 700 au livreur', () => {
    const book = new Book();
    book.post(
      capturePayment({
        paymentId: 'p1',
        provider: PROVIDER,
        orders: [{ orderId: 'o1', total: 52_000 }],
      }),
    );
    expect(book.balance(cash)).toBe(52_000);
    expect(book.escrowOf('o1')).toBe(52_000);

    const release = releaseEscrow({
      orderId: 'o1',
      sellerId: 's1',
      courierPartnerId: 'c1',
      itemsSubtotal: 50_000,
      deliveryFee: 2_000,
      courierShare: 1_700,
      commissionTotal: 5_000,
      refundedAmount: 0,
    });
    book.post(release.journal);
    expect(release).toMatchObject({ sellerNet: 45_000, commission: 5_000 });
    expect(book.escrowOf('o1')).toBe(0);
    expect(book.balance(sellerPayableAccount('s1'))).toBe(45_000);
    expect(book.balance(courierPayableAccount('c1'))).toBe(1_700);
    expect(book.balance(PlatformAccounts.commissionRevenue)).toBe(5_000);
    expect(book.balance(PlatformAccounts.deliveryRevenue)).toBe(300);

    book.post(reservePayout({ payoutId: 'po1', sellerId: 's1', amount: 45_000 }));
    expect(book.balance(sellerPayableAccount('s1'))).toBe(0);
    book.post(settlePayout({ payoutId: 'po1', provider: PROVIDER, amount: 45_000 }));
    expect(book.balance(PlatformAccounts.payoutsInTransit)).toBe(0);
    expect(book.balance(cash)).toBe(7_000); // commission + livraison restent chez l'agrégateur
    expect(book.trialBalance()).toBe(0);
  });

  it('un paiement pour deux vendeurs est ventilé en séquestre commande par commande', () => {
    const book = new Book();
    book.post(
      capturePayment({
        paymentId: 'p2',
        provider: PROVIDER,
        orders: [
          { orderId: 'a', total: 10_000 },
          { orderId: 'b', total: 7_500 },
        ],
      }),
    );
    expect(book.escrowOf('a')).toBe(10_000);
    expect(book.escrowOf('b')).toBe(7_500);
    expect(book.balance(PlatformAccounts.escrow)).toBe(17_500);
  });

  it('remboursement partiel : commission réduite au prorata, livreur payé', () => {
    const book = new Book();
    book.post(
      capturePayment({
        paymentId: 'p3',
        provider: PROVIDER,
        orders: [{ orderId: 'o3', total: 52_000 }],
      }),
    );
    book.post(
      reserveRefund({ refundId: 'r3', amount: 20_000, source: { kind: 'escrow', orderId: 'o3' } }),
    );
    const release = releaseEscrow({
      orderId: 'o3',
      sellerId: 's3',
      courierPartnerId: 'c1',
      itemsSubtotal: 50_000,
      deliveryFee: 2_000,
      courierShare: 1_700,
      commissionTotal: 5_000,
      refundedAmount: 20_000,
    });
    book.post(release.journal);
    expect(release).toMatchObject({ commission: 3_000, sellerNet: 27_000 });
    expect(book.escrowOf('o3')).toBe(0);
    book.post(settleRefund({ refundId: 'r3', provider: PROVIDER, amount: 20_000 }));
    expect(book.balance(PlatformAccounts.refundsInTransit)).toBe(0);
    expect(book.balance(cash)).toBe(32_000);
  });

  it('paiement tardif : passe par le compte d’attente puis est remboursé', () => {
    const book = new Book();
    book.post(captureLatePayment({ paymentId: 'p4', provider: PROVIDER, amount: 15_000 }));
    expect(book.balance(PlatformAccounts.suspense)).toBe(15_000);
    book.post(
      reserveRefund({
        refundId: 'r4',
        amount: 15_000,
        source: { kind: 'suspense', paymentId: 'p4' },
      }),
    );
    book.post(settleRefund({ refundId: 'r4', provider: PROVIDER, amount: 15_000 }));
    expect(book.balance(PlatformAccounts.suspense)).toBe(0);
    expect(book.balance(cash)).toBe(0);
  });

  it('échec définitif d’un reversement : le solde revient au vendeur', () => {
    const book = new Book();
    book.post(reservePayout({ payoutId: 'po5', sellerId: 's5', amount: 9_000 }));
    book.post(reversePayout({ payoutId: 'po5', sellerId: 's5', amount: 9_000 }));
    expect(book.balance(PlatformAccounts.payoutsInTransit)).toBe(0);
    expect(book.balance(sellerPayableAccount('s5'))).toBe(0);
  });

  it('une même opération ne peut produire qu’une seule clé (capture normale ou tardive)', () => {
    const a = capturePayment({
      paymentId: 'p6',
      provider: PROVIDER,
      orders: [{ orderId: 'o', total: 1 }],
    });
    const b = captureLatePayment({ paymentId: 'p6', provider: PROVIDER, amount: 1 });
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
  });
});

describe('grand livre — invariants', () => {
  it('refuse une écriture déséquilibrée ou à une seule ligne', () => {
    expect(() =>
      assertBalanced({
        kind: 'provider_fee',
        idempotencyKey: 'x',
        refs: {},
        lines: [{ account: cash, amount: 1 }],
      }),
    ).toThrow();
    expect(() =>
      assertBalanced({
        kind: 'provider_fee',
        idempotencyKey: 'x',
        refs: {},
        lines: [
          { account: cash, amount: 2 },
          { account: PlatformAccounts.paymentFees, amount: -1 },
        ],
      }),
    ).toThrow(/déséquilibrée/);
  });

  it('exige un partenaire de livraison quand une part livreur est due', () => {
    expect(() =>
      releaseEscrow({
        orderId: 'o',
        sellerId: 's',
        courierPartnerId: null,
        itemsSubtotal: 1_000,
        deliveryFee: 500,
        courierShare: 400,
        commissionTotal: 100,
        refundedAmount: 0,
      }),
    ).toThrow(/partenaire/);
  });

  it('conserve l’argent sur 2 000 commandes aléatoires (aucun franc créé ni perdu)', () => {
    let seed = 42;
    const rand = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % max;
    };
    const book = new Book();
    let expectedCash = 0;
    for (let i = 0; i < 2_000; i++) {
      const itemsSubtotal = 500 + rand(2_000_000);
      const deliveryFee = rand(5_000);
      const courierShare = deliveryFee === 0 ? 0 : rand(deliveryFee + 1);
      const commissionTotal = Math.floor((itemsSubtotal * rand(1_501)) / 10_000);
      const refundedAmount = rand(4) === 0 ? rand(itemsSubtotal) : 0;
      const orderId = `o${i}`;
      book.post(
        capturePayment({
          paymentId: `p${i}`,
          provider: PROVIDER,
          orders: [{ orderId, total: itemsSubtotal + deliveryFee }],
        }),
      );
      if (refundedAmount > 0) {
        book.post(
          reserveRefund({
            refundId: `r${i}`,
            amount: refundedAmount,
            source: { kind: 'escrow', orderId },
          }),
        );
        book.post(settleRefund({ refundId: `r${i}`, provider: PROVIDER, amount: refundedAmount }));
      }
      const release = releaseEscrow({
        orderId,
        sellerId: `s${i % 7}`,
        courierPartnerId: 'c1',
        itemsSubtotal,
        deliveryFee,
        courierShare,
        commissionTotal,
        refundedAmount,
      });
      book.post(release.journal);
      const { sellerNet, commission } = release;
      expect(sellerNet + commission).toBe(itemsSubtotal - refundedAmount);
      expect(book.escrowOf(orderId)).toBe(0);
      expectedCash += itemsSubtotal + deliveryFee - refundedAmount;
    }
    expect(book.balance(PlatformAccounts.escrow)).toBe(0);
    expect(book.balance(cash)).toBe(expectedCash);
    expect(book.trialBalance()).toBe(0);
  });
});
