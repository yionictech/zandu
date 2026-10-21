import { DomainError } from './errors.js';
import { assertPositiveAmount } from './money.js';
import { addOpenMinutes, type WeeklyHours } from './opening-hours.js';

/**
 * Cycle de vie d'une commande (une commande = un vendeur). Toute modification de statut
 * passe par `transitionOrder`, qui vérifie l'acteur, les délais, et renvoie les effets à
 * exécuter (remboursement, libération du séquestre, remise en stock, notifications).
 * La base de données refuse elle aussi toute transition absente de cette table
 * (trigger orders_status_guard) : deux verrous indépendants.
 */
export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'preparing',
  'ready_for_pickup',
  'in_delivery',
  'awaiting_collection',
  'delivered',
  'completed',
  'disputed',
  'refunded',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'completed',
  'refunded',
  'cancelled',
];

export type ActorRole = 'buyer' | 'seller' | 'rider' | 'support' | 'admin' | 'system';

export type DisputeResolution =
  | { kind: 'release_to_seller' }
  | { kind: 'refund_full' }
  | { kind: 'refund_partial'; amount: number };

export type OrderEvent =
  | { type: 'payment_succeeded' }
  | { type: 'checkout_expired' }
  | { type: 'buyer_cancelled' }
  | { type: 'seller_accepted' }
  | { type: 'seller_rejected'; reason: string }
  | { type: 'seller_acceptance_timeout' }
  | { type: 'seller_marked_ready' }
  | { type: 'support_cancelled'; reason: string }
  | { type: 'rider_picked_up' }
  | { type: 'arrived_at_pickup_point' }
  | { type: 'handover_confirmed' }
  | { type: 'delivery_failed'; reason: string }
  | { type: 'buyer_confirmed_receipt' }
  | { type: 'dispute_window_elapsed' }
  | { type: 'dispute_opened' }
  | { type: 'dispute_resolved'; resolution: DisputeResolution };
export type OrderEventType = OrderEvent['type'];

export interface OrderSnapshot {
  status: OrderStatus;
  itemsSubtotal: number;
  deliveryFee: number;
  total: number;
  refundedAmount: number;
  deliveryMode: 'home' | 'pickup_point';
  sellerAcceptDeadline: Date | null;
  disputeWindowEndsAt: Date | null;
}

export interface OrderPolicy {
  /** Délai laissé au vendeur pour accepter une commande payée, sinon annulation et remboursement. */
  sellerAcceptanceHours: number;
  /** Délai après la remise pendant lequel l'acheteur peut ouvrir un litige (F12 : 48 h). */
  disputeWindowHours: number;
}

export const DEFAULT_ORDER_POLICY: OrderPolicy = {
  sellerAcceptanceHours: 24,
  disputeWindowHours: 48,
};

export type OrderEffect =
  | { type: 'restock' }
  | { type: 'create_delivery' }
  | { type: 'refund_buyer'; amount: number; reason: string }
  | { type: 'release_escrow' }
  | { type: 'notify'; topic: string };

export interface OrderPatch {
  status: OrderStatus;
  paidAt?: Date;
  deliveredAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  sellerAcceptDeadline?: Date | null;
  disputeWindowEndsAt?: Date | null;
  refundedAmount?: number;
}

export interface TransitionResult {
  from: OrderStatus;
  to: OrderStatus;
  patch: OrderPatch;
  effects: OrderEffect[];
}

export interface TransitionContext {
  actor: ActorRole;
  now: Date;
  policy?: OrderPolicy;
  /**
   * Horaires de la boutique, quand le délai d'acceptation ne doit compter que le temps
   * d'ouverture (réglage du back-office) ; absent = le délai court jour et nuit.
   */
  sellerHours?: WeeklyHours | null;
}

interface TransitionDef {
  from: readonly OrderStatus[];
  /** Statuts d'arrivée possibles (le premier est celui par défaut). */
  to: readonly OrderStatus[];
  actors: readonly ActorRole[];
}

const STAFF: readonly ActorRole[] = ['support', 'admin'];

export const ORDER_TRANSITIONS: Readonly<Record<OrderEventType, TransitionDef>> = {
  payment_succeeded: { from: ['pending_payment'], to: ['paid'], actors: ['system'] },
  checkout_expired: { from: ['pending_payment'], to: ['cancelled'], actors: ['system'] },
  // Tant que le checkout attend son paiement, ses commandes forment un bloc : seule
  // l'expiration du checkout les annule (sinon le paiement couvrirait une commande annulée).
  buyer_cancelled: { from: ['paid'], to: ['cancelled'], actors: ['buyer'] },
  seller_accepted: { from: ['paid'], to: ['preparing'], actors: ['seller'] },
  // Refus avant d'accepter, ou rupture de stock découverte en préparant : l'acheteur est remboursé.
  seller_rejected: { from: ['paid', 'preparing'], to: ['cancelled'], actors: ['seller'] },
  seller_acceptance_timeout: { from: ['paid'], to: ['cancelled'], actors: ['system'] },
  seller_marked_ready: { from: ['preparing'], to: ['ready_for_pickup'], actors: ['seller'] },
  support_cancelled: {
    from: ['paid', 'preparing', 'ready_for_pickup'],
    to: ['cancelled'],
    actors: STAFF,
  },
  rider_picked_up: { from: ['ready_for_pickup'], to: ['in_delivery'], actors: ['rider'] },
  arrived_at_pickup_point: {
    from: ['in_delivery'],
    to: ['awaiting_collection'],
    actors: ['rider'],
  },
  handover_confirmed: {
    from: ['in_delivery', 'awaiting_collection'],
    to: ['delivered'],
    actors: ['rider'],
  },
  delivery_failed: {
    from: ['in_delivery', 'awaiting_collection'],
    to: ['disputed'],
    actors: ['rider', ...STAFF],
  },
  buyer_confirmed_receipt: { from: ['delivered'], to: ['completed'], actors: ['buyer'] },
  dispute_window_elapsed: { from: ['delivered'], to: ['completed'], actors: ['system'] },
  dispute_opened: { from: ['delivered'], to: ['disputed'], actors: ['buyer'] },
  dispute_resolved: { from: ['disputed'], to: ['completed', 'refunded'], actors: STAFF },
};

/** Paires (de, vers) autorisées — doivent correspondre à la table SQL order_status_transitions. */
export function allowedStatusTransitions(): Array<[OrderStatus, OrderStatus]> {
  const pairs = new Map<string, [OrderStatus, OrderStatus]>();
  for (const def of Object.values(ORDER_TRANSITIONS)) {
    for (const from of def.from) {
      for (const to of def.to) pairs.set(`${from}>${to}`, [from, to]);
    }
  }
  return [...pairs.values()];
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

export function transitionOrder(
  order: OrderSnapshot,
  event: OrderEvent,
  ctx: TransitionContext,
): TransitionResult {
  const def = ORDER_TRANSITIONS[event.type];
  const policy = ctx.policy ?? DEFAULT_ORDER_POLICY;

  if (!def.actors.includes(ctx.actor)) {
    throw new DomainError(
      'forbidden_actor',
      `« ${event.type} » ne peut pas être déclenché par ${ctx.actor}`,
      {
        event: event.type,
        actor: ctx.actor,
      },
    );
  }
  if (!def.from.includes(order.status)) {
    throw new DomainError(
      'invalid_transition',
      `« ${event.type} » impossible depuis le statut ${order.status}`,
      {
        event: event.type,
        status: order.status,
      },
    );
  }

  const now = ctx.now;
  const remaining = order.total - order.refundedAmount;
  const effects: OrderEffect[] = [];
  let to: OrderStatus = def.to[0]!;
  const patch: Partial<OrderPatch> = {};

  const cancel = (reason: string, paid = true): void => {
    patch.cancelledAt = now;
    patch.cancelReason = reason;
    patch.sellerAcceptDeadline = null;
    effects.push({ type: 'restock' });
    if (paid && remaining > 0) {
      effects.push({ type: 'refund_buyer', amount: remaining, reason });
      patch.refundedAmount = order.total;
    }
  };

  switch (event.type) {
    case 'payment_succeeded':
      patch.paidAt = now;
      patch.sellerAcceptDeadline = ctx.sellerHours
        ? addOpenMinutes(now, policy.sellerAcceptanceHours * 60, ctx.sellerHours)
        : addHours(now, policy.sellerAcceptanceHours);
      effects.push({ type: 'create_delivery' });
      break;

    case 'checkout_expired':
      cancel('payment_not_completed', false);
      break;

    case 'buyer_cancelled':
      cancel('buyer_cancelled');
      break;

    case 'seller_accepted':
      patch.sellerAcceptDeadline = null;
      break;

    case 'seller_rejected':
      cancel(`seller_rejected: ${event.reason}`);
      break;

    case 'seller_acceptance_timeout':
      if (order.sellerAcceptDeadline === null || now < order.sellerAcceptDeadline) {
        throw new DomainError(
          'deadline_not_reached',
          "Le délai d'acceptation du vendeur court encore",
        );
      }
      cancel('seller_acceptance_timeout');
      break;

    case 'support_cancelled':
      cancel(`support: ${event.reason}`);
      break;

    case 'arrived_at_pickup_point':
      if (order.deliveryMode !== 'pickup_point') {
        throw new DomainError(
          'invalid_transition',
          "Cette commande n'est pas livrée en point relais",
        );
      }
      break;

    case 'handover_confirmed':
      patch.deliveredAt = now;
      patch.disputeWindowEndsAt = addHours(now, policy.disputeWindowHours);
      break;

    case 'buyer_confirmed_receipt':
      patch.completedAt = now;
      effects.push({ type: 'release_escrow' });
      break;

    case 'dispute_window_elapsed':
      if (order.disputeWindowEndsAt === null || now < order.disputeWindowEndsAt) {
        throw new DomainError('deadline_not_reached', 'La fenêtre de litige est encore ouverte');
      }
      patch.completedAt = now;
      effects.push({ type: 'release_escrow' });
      break;

    case 'dispute_opened':
      if (order.disputeWindowEndsAt === null || now >= order.disputeWindowEndsAt) {
        throw new DomainError(
          'dispute_window_closed',
          'Le délai pour signaler un problème est dépassé',
        );
      }
      break;

    case 'dispute_resolved': {
      const r = event.resolution;
      if (r.kind === 'release_to_seller') {
        patch.completedAt = now;
        effects.push({ type: 'release_escrow' });
      } else if (r.kind === 'refund_full') {
        to = 'refunded';
        if (remaining > 0)
          effects.push({ type: 'refund_buyer', amount: remaining, reason: 'dispute_refund_full' });
        patch.refundedAmount = order.total;
      } else {
        assertPositiveAmount(r.amount, 'montant remboursé');
        // Un remboursement partiel est pris sur la part articles : le livreur reste payé.
        // S'il couvre tous les articles, c'est un remboursement total.
        if (order.refundedAmount + r.amount >= order.itemsSubtotal) {
          throw new DomainError(
            'invalid_refund_amount',
            'Remboursement partiel égal ou supérieur aux articles : utilisez refund_full',
            {
              amount: r.amount,
              itemsSubtotal: order.itemsSubtotal,
            },
          );
        }
        patch.completedAt = now;
        patch.refundedAmount = order.refundedAmount + r.amount;
        effects.push({ type: 'refund_buyer', amount: r.amount, reason: 'dispute_refund_partial' });
        effects.push({ type: 'release_escrow' });
      }
      break;
    }

    case 'seller_marked_ready':
    case 'rider_picked_up':
    case 'delivery_failed':
      break;
  }

  effects.push({ type: 'notify', topic: `order.${to}` });
  return { from: order.status, to, patch: { ...patch, status: to }, effects };
}
