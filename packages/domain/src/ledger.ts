import { DomainError } from './errors.js';
import { assertAmount, assertPositiveAmount, prorate, sum } from './money.js';

/**
 * Grand livre en partie double. Chaque mouvement d'argent est une « transaction » dont les
 * lignes somment à zéro (débit > 0, crédit < 0). Les fonctions ci-dessous sont les SEULES
 * façons de produire une écriture : la plateforme ne peut pas « inventer » de l'argent.
 *
 * Plan de comptes :
 *   asset:provider_cash:<agrégateur>   argent réellement détenu chez l'agrégateur agréé
 *   liability:escrow                   séquestre : argent des acheteurs, ventilé par commande
 *   liability:seller_payable:<id>      solde dû au vendeur (disponible au reversement)
 *   liability:courier_payable:<id>     dû au partenaire de livraison
 *   liability:refunds_in_transit       remboursements décidés, pas encore confirmés
 *   liability:payouts_in_transit       reversements envoyés, pas encore confirmés
 *   liability:suspense                 paiements tardifs à rembourser
 *   revenue:commission                 commissions de la plateforme
 *   revenue:delivery_margin            marge sur la livraison
 *   expense:payment_fees               frais Mobile Money / agrégateur
 */
export const PlatformAccounts = {
  escrow: 'liability:escrow',
  refundsInTransit: 'liability:refunds_in_transit',
  payoutsInTransit: 'liability:payouts_in_transit',
  suspense: 'liability:suspense',
  commissionRevenue: 'revenue:commission',
  deliveryRevenue: 'revenue:delivery_margin',
  paymentFees: 'expense:payment_fees',
} as const;

export const providerCashAccount = (provider: string): string => `asset:provider_cash:${provider}`;
export const sellerPayableAccount = (sellerId: string): string =>
  `liability:seller_payable:${sellerId}`;
export const courierPayableAccount = (partnerId: string): string =>
  `liability:courier_payable:${partnerId}`;

export type AccountType = 'asset' | 'liability' | 'revenue' | 'expense';

export function accountType(code: string): AccountType {
  const prefix = code.split(':', 1)[0];
  if (
    prefix === 'asset' ||
    prefix === 'liability' ||
    prefix === 'revenue' ||
    prefix === 'expense'
  ) {
    return prefix;
  }
  throw new DomainError('invalid_account', `Compte inconnu : ${code}`);
}

/** Solde « naturel » : positif pour un actif/une charge débiteurs, un passif/un produit créditeurs. */
export function naturalBalance(code: string, rawSum: number): number {
  const type = accountType(code);
  return type === 'asset' || type === 'expense' ? rawSum : 0 - rawSum; // 0 - x évite -0
}

export type JournalKind =
  | 'payment_captured'
  | 'late_payment_captured'
  | 'escrow_released'
  | 'refund_reserved'
  | 'refund_settled'
  | 'payout_reserved'
  | 'payout_settled'
  | 'payout_reversed'
  | 'provider_fee';

export interface JournalLine {
  account: string;
  amount: number;
  orderId?: string;
}

export interface Journal {
  kind: JournalKind;
  /** Clé métier unique en base : rejouer la même opération ne crée jamais une 2e écriture. */
  idempotencyKey: string;
  refs: { paymentId?: string; orderId?: string; payoutId?: string; refundId?: string };
  lines: JournalLine[];
}

export function assertBalanced(journal: Journal): void {
  if (journal.lines.length < 2) {
    throw new DomainError('unbalanced_journal', 'Une écriture compte au moins deux lignes', {
      kind: journal.kind,
    });
  }
  for (const line of journal.lines) {
    accountType(line.account);
    if (!Number.isSafeInteger(line.amount) || line.amount === 0) {
      throw new DomainError('unbalanced_journal', 'Ligne comptable invalide', { line });
    }
  }
  const total = sum(journal.lines.map((l) => l.amount));
  if (total !== 0) {
    throw new DomainError('unbalanced_journal', `Écriture déséquilibrée (somme ${total})`, {
      kind: journal.kind,
    });
  }
}

function journal(
  kind: JournalKind,
  idempotencyKey: string,
  refs: Journal['refs'],
  lines: JournalLine[],
): Journal {
  const j: Journal = { kind, idempotencyKey, refs, lines: lines.filter((l) => l.amount !== 0) };
  assertBalanced(j);
  return j;
}

/** Paiement confirmé : l'argent entre chez l'agrégateur et est bloqué en séquestre, commande par commande. */
export function capturePayment(input: {
  paymentId: string;
  provider: string;
  orders: ReadonlyArray<{ orderId: string; total: number }>;
}): Journal {
  input.orders.forEach((o) => assertPositiveAmount(o.total, 'total commande'));
  const amount = sum(input.orders.map((o) => o.total));
  return journal('payment_captured', `capture:${input.paymentId}`, { paymentId: input.paymentId }, [
    { account: providerCashAccount(input.provider), amount },
    ...input.orders.map((o) => ({
      account: PlatformAccounts.escrow,
      amount: -o.total,
      orderId: o.orderId,
    })),
  ]);
}

/**
 * Paiement confirmé après expiration : la commande est déjà annulée. L'argent va en compte
 * d'attente avant remboursement. Même clé que capturePayment : un paiement n'est capturé qu'une fois.
 */
export function captureLatePayment(input: {
  paymentId: string;
  provider: string;
  amount: number;
}): Journal {
  assertPositiveAmount(input.amount);
  return journal(
    'late_payment_captured',
    `capture:${input.paymentId}`,
    { paymentId: input.paymentId },
    [
      { account: providerCashAccount(input.provider), amount: input.amount },
      { account: PlatformAccounts.suspense, amount: -input.amount },
    ],
  );
}

export interface EscrowReleaseInput {
  orderId: string;
  sellerId: string;
  courierPartnerId: string | null;
  itemsSubtotal: number;
  deliveryFee: number;
  courierShare: number;
  commissionTotal: number;
  /** Montant déjà remboursé (remboursement partiel décidé par le support). */
  refundedAmount: number;
}

export interface EscrowRelease {
  journal: Journal;
  sellerNet: number;
  commission: number;
}

/**
 * Libération du séquestre à la fin de la commande : le vendeur est crédité du montant des
 * articles moins la commission ; le livreur de sa part ; la plateforme de sa commission et de
 * sa marge livraison. Après un remboursement partiel, la commission est réduite au prorata.
 */
export function releaseEscrow(input: EscrowReleaseInput): EscrowRelease {
  const { itemsSubtotal, deliveryFee, courierShare, commissionTotal, refundedAmount } = input;
  assertPositiveAmount(itemsSubtotal, 'sous-total articles');
  assertAmount(deliveryFee, 'frais de livraison');
  assertAmount(courierShare, 'part livreur');
  assertAmount(commissionTotal, 'commission');
  assertAmount(refundedAmount, 'montant remboursé');
  if (
    courierShare > deliveryFee ||
    commissionTotal > itemsSubtotal ||
    refundedAmount > itemsSubtotal
  ) {
    throw new DomainError('invalid_release', 'Montants de commande incohérents', { ...input });
  }
  if (courierShare > 0 && input.courierPartnerId === null) {
    throw new DomainError('invalid_release', 'Aucun partenaire de livraison à rémunérer', {
      orderId: input.orderId,
    });
  }

  const keptItems = itemsSubtotal - refundedAmount;
  const commission =
    refundedAmount === 0 ? commissionTotal : prorate(commissionTotal, keptItems, itemsSubtotal);
  const sellerNet = keptItems - commission;
  const escrowed = keptItems + deliveryFee;

  const lines: JournalLine[] = [
    { account: PlatformAccounts.escrow, amount: escrowed, orderId: input.orderId },
    { account: sellerPayableAccount(input.sellerId), amount: -sellerNet, orderId: input.orderId },
    { account: PlatformAccounts.commissionRevenue, amount: -commission, orderId: input.orderId },
    {
      account: PlatformAccounts.deliveryRevenue,
      amount: -(deliveryFee - courierShare),
      orderId: input.orderId,
    },
  ];
  if (courierShare > 0) {
    lines.push({
      account: courierPayableAccount(input.courierPartnerId!),
      amount: -courierShare,
      orderId: input.orderId,
    });
  }

  return {
    journal: journal(
      'escrow_released',
      `release:${input.orderId}`,
      { orderId: input.orderId },
      lines,
    ),
    sellerNet,
    commission,
  };
}

/** Remboursement décidé : l'argent quitte le séquestre (ou le compte d'attente) vers « en cours ». */
export function reserveRefund(input: {
  refundId: string;
  amount: number;
  source: { kind: 'escrow'; orderId: string } | { kind: 'suspense'; paymentId: string };
}): Journal {
  assertPositiveAmount(input.amount);
  const { source } = input;
  const debit: JournalLine =
    source.kind === 'escrow'
      ? { account: PlatformAccounts.escrow, amount: input.amount, orderId: source.orderId }
      : { account: PlatformAccounts.suspense, amount: input.amount };
  const refs =
    source.kind === 'escrow'
      ? { refundId: input.refundId, orderId: source.orderId }
      : { refundId: input.refundId, paymentId: source.paymentId };
  return journal('refund_reserved', `refund_reserve:${input.refundId}`, refs, [
    debit,
    { account: PlatformAccounts.refundsInTransit, amount: -input.amount },
  ]);
}

/** L'agrégateur confirme le remboursement : l'argent quitte réellement la plateforme. */
export function settleRefund(input: {
  refundId: string;
  provider: string;
  amount: number;
}): Journal {
  assertPositiveAmount(input.amount);
  return journal(
    'refund_settled',
    `refund_settle:${input.refundId}`,
    { refundId: input.refundId },
    [
      { account: PlatformAccounts.refundsInTransit, amount: input.amount },
      { account: providerCashAccount(input.provider), amount: -input.amount },
    ],
  );
}

/** Reversement demandé : le solde vendeur est réservé pour éviter de le dépenser deux fois. */
export function reservePayout(input: {
  payoutId: string;
  sellerId: string;
  amount: number;
}): Journal {
  assertPositiveAmount(input.amount);
  return journal(
    'payout_reserved',
    `payout_reserve:${input.payoutId}`,
    { payoutId: input.payoutId },
    [
      { account: sellerPayableAccount(input.sellerId), amount: input.amount },
      { account: PlatformAccounts.payoutsInTransit, amount: -input.amount },
    ],
  );
}

export function settlePayout(input: {
  payoutId: string;
  provider: string;
  amount: number;
}): Journal {
  assertPositiveAmount(input.amount);
  return journal(
    'payout_settled',
    `payout_settle:${input.payoutId}`,
    { payoutId: input.payoutId },
    [
      { account: PlatformAccounts.payoutsInTransit, amount: input.amount },
      { account: providerCashAccount(input.provider), amount: -input.amount },
    ],
  );
}

/** Échec définitif du reversement : le montant revient sur le solde du vendeur. */
export function reversePayout(input: {
  payoutId: string;
  sellerId: string;
  amount: number;
}): Journal {
  assertPositiveAmount(input.amount);
  return journal(
    'payout_reversed',
    `payout_reverse:${input.payoutId}`,
    { payoutId: input.payoutId },
    [
      { account: PlatformAccounts.payoutsInTransit, amount: input.amount },
      { account: sellerPayableAccount(input.sellerId), amount: -input.amount },
    ],
  );
}

/** Frais prélevés par l'agrégateur, connus par webhook ou par le relevé quotidien. */
export function recordProviderFee(input: {
  provider: string;
  reference: string;
  amount: number;
}): Journal {
  assertPositiveAmount(input.amount);
  return journal('provider_fee', `fee:${input.provider}:${input.reference}`, {}, [
    { account: PlatformAccounts.paymentFees, amount: input.amount },
    { account: providerCashAccount(input.provider), amount: -input.amount },
  ]);
}
