import { describe, expect, it } from 'vitest';
import {
  ORDER_TRANSITIONS,
  allowedStatusTransitions,
  transitionOrder,
  type ActorRole,
  type OrderEvent,
  type OrderSnapshot,
  type OrderStatus,
} from '../src/index.js';

const now = new Date('2027-05-10T10:00:00Z');
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);

function order(status: OrderStatus, extra: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return {
    status,
    itemsSubtotal: 50_000,
    deliveryFee: 2_000,
    total: 52_000,
    refundedAmount: 0,
    deliveryMode: 'home',
    sellerAcceptDeadline: null,
    disputeWindowEndsAt: null,
    ...extra,
  };
}

const run = (o: OrderSnapshot, event: OrderEvent, actor: ActorRole, at = now) =>
  transitionOrder(o, event, { actor, now: at });

describe('transitionOrder — parcours nominal', () => {
  it('suit le cycle du cahier des charges, du paiement au reversement', () => {
    let o = order('pending_payment');

    const paid = run(o, { type: 'payment_succeeded' }, 'system');
    expect(paid.to).toBe('paid');
    expect(paid.patch.sellerAcceptDeadline).toEqual(hours(24));
    expect(paid.effects).toContainEqual({ type: 'create_delivery' });
    o = { ...o, status: paid.to, sellerAcceptDeadline: paid.patch.sellerAcceptDeadline! };

    o = { ...o, status: run(o, { type: 'seller_accepted' }, 'seller').to };
    expect(o.status).toBe('preparing');
    o = { ...o, status: run(o, { type: 'seller_marked_ready' }, 'seller').to };
    o = { ...o, status: run(o, { type: 'rider_picked_up' }, 'rider').to };
    expect(o.status).toBe('in_delivery');

    const delivered = run(o, { type: 'handover_confirmed' }, 'rider');
    expect(delivered.to).toBe('delivered');
    expect(delivered.patch.disputeWindowEndsAt).toEqual(hours(48));
    o = { ...o, status: 'delivered', disputeWindowEndsAt: delivered.patch.disputeWindowEndsAt! };

    const done = run(o, { type: 'dispute_window_elapsed' }, 'system', hours(48));
    expect(done.to).toBe('completed');
    expect(done.effects).toContainEqual({ type: 'release_escrow' });
  });

  it('libère immédiatement le séquestre quand l’acheteur confirme la réception', () => {
    const r = run(
      order('delivered', { disputeWindowEndsAt: hours(48) }),
      { type: 'buyer_confirmed_receipt' },
      'buyer',
    );
    expect(r.to).toBe('completed');
    expect(r.effects.map((e) => e.type)).toEqual(['release_escrow', 'notify']);
  });

  it('passe par le point relais quand c’est le mode choisi', () => {
    const o = order('in_delivery', { deliveryMode: 'pickup_point' });
    expect(run(o, { type: 'arrived_at_pickup_point' }, 'rider').to).toBe('awaiting_collection');
    expect(() => run(order('in_delivery'), { type: 'arrived_at_pickup_point' }, 'rider')).toThrow(
      /point relais/,
    );
  });
});

describe('transitionOrder — annulations et remboursements', () => {
  it('annule sans remboursement une commande jamais payée et libère le stock', () => {
    const r = run(order('pending_payment'), { type: 'checkout_expired' }, 'system');
    expect(r.to).toBe('cancelled');
    expect(r.effects.map((e) => e.type)).toEqual(['restock', 'notify']);
  });

  it('rembourse intégralement si le vendeur refuse', () => {
    const r = run(order('paid'), { type: 'seller_rejected', reason: 'rupture' }, 'seller');
    expect(r.effects).toContainEqual({
      type: 'refund_buyer',
      amount: 52_000,
      reason: 'seller_rejected: rupture',
    });
    expect(r.patch.refundedAmount).toBe(52_000);
  });

  it('rembourse aussi une rupture de stock découverte en préparant, plus après « prête »', () => {
    const r = run(order('preparing'), { type: 'seller_rejected', reason: 'rupture' }, 'seller');
    expect(r.to).toBe('cancelled');
    expect(r.effects).toContainEqual({
      type: 'refund_buyer',
      amount: 52_000,
      reason: 'seller_rejected: rupture',
    });
    expect(() =>
      run(order('ready_for_pickup'), { type: 'seller_rejected', reason: 'rupture' }, 'seller'),
    ).toThrow(/impossible/);
  });

  it('annule et rembourse si le vendeur ne répond pas dans les délais, pas avant', () => {
    const o = order('paid', { sellerAcceptDeadline: hours(24) });
    expect(() => run(o, { type: 'seller_acceptance_timeout' }, 'system', hours(23))).toThrow(
      /délai/,
    );
    const r = run(o, { type: 'seller_acceptance_timeout' }, 'system', hours(24));
    expect(r.effects).toContainEqual(
      expect.objectContaining({ type: 'refund_buyer', amount: 52_000 }),
    );
  });

  it('permet à l’acheteur d’annuler avant acceptation, pas après', () => {
    expect(run(order('paid'), { type: 'buyer_cancelled' }, 'buyer').to).toBe('cancelled');
    expect(() => run(order('preparing'), { type: 'buyer_cancelled' }, 'buyer')).toThrow(
      /impossible/,
    );
  });

  it('n’annule pas isolément une commande dont le checkout attend son paiement', () => {
    expect(() => run(order('pending_payment'), { type: 'buyer_cancelled' }, 'buyer')).toThrow(
      /impossible/,
    );
    expect(() =>
      run(order('pending_payment'), { type: 'support_cancelled', reason: 'x' }, 'support'),
    ).toThrow(/impossible/);
  });
});

describe('transitionOrder — litiges', () => {
  const delivered = order('delivered', { disputeWindowEndsAt: hours(48) });

  it('ouvre un litige dans les 48 h, pas après', () => {
    expect(run(delivered, { type: 'dispute_opened' }, 'buyer', hours(47)).to).toBe('disputed');
    expect(() => run(delivered, { type: 'dispute_opened' }, 'buyer', hours(48))).toThrow(/dépassé/);
  });

  it('gèle le reversement : la fenêtre ne peut plus se refermer sur un litige', () => {
    expect(() =>
      run(order('disputed'), { type: 'dispute_window_elapsed' }, 'system', hours(100)),
    ).toThrow();
  });

  it('colis non livré : litige puis remboursement intégral décidé par le support', () => {
    const failed = run(
      order('in_delivery'),
      { type: 'delivery_failed', reason: 'absent' },
      'rider',
    );
    expect(failed.to).toBe('disputed');
    const r = run(
      order('disputed'),
      { type: 'dispute_resolved', resolution: { kind: 'refund_full' } },
      'support',
    );
    expect(r.to).toBe('refunded');
    expect(r.effects).toContainEqual({
      type: 'refund_buyer',
      amount: 52_000,
      reason: 'dispute_refund_full',
    });
  });

  it('remboursement partiel : rembourse puis libère le reste', () => {
    const r = run(
      order('disputed'),
      { type: 'dispute_resolved', resolution: { kind: 'refund_partial', amount: 10_000 } },
      'support',
    );
    expect(r.to).toBe('completed');
    expect(r.patch.refundedAmount).toBe(10_000);
    expect(r.effects.map((e) => e.type)).toEqual(['refund_buyer', 'release_escrow', 'notify']);
  });

  it('refuse un remboursement partiel couvrant tous les articles', () => {
    const resolution = { kind: 'refund_partial' as const, amount: 50_000 };
    expect(() =>
      run(order('disputed'), { type: 'dispute_resolved', resolution }, 'support'),
    ).toThrow(/refund_full/);
  });

  it('réserve la décision au support', () => {
    const event: OrderEvent = {
      type: 'dispute_resolved',
      resolution: { kind: 'release_to_seller' },
    };
    expect(() => run(order('disputed'), event, 'seller')).toThrow(/ne peut pas/);
    expect(run(order('disputed'), event, 'admin').to).toBe('completed');
  });
});

describe('transitionOrder — garde-fous', () => {
  it('refuse un acteur non autorisé', () => {
    expect(() => run(order('paid'), { type: 'seller_accepted' }, 'buyer')).toThrow(/ne peut pas/);
    expect(() => run(order('pending_payment'), { type: 'payment_succeeded' }, 'buyer')).toThrow();
  });

  it('refuse toute transition depuis un statut terminal', () => {
    for (const status of ['completed', 'refunded', 'cancelled'] as const) {
      for (const type of Object.keys(ORDER_TRANSITIONS)) {
        const def = ORDER_TRANSITIONS[type as keyof typeof ORDER_TRANSITIONS];
        expect(def.from).not.toContain(status);
      }
    }
  });

  it('émet toujours une notification', () => {
    const r = run(order('paid'), { type: 'seller_accepted' }, 'seller');
    expect(r.effects.at(-1)).toEqual({ type: 'notify', topic: 'order.preparing' });
  });

  it('expose la liste des transitions autorisées (miroir de la table SQL)', () => {
    const pairs = allowedStatusTransitions().map(([a, b]) => `${a}>${b}`);
    expect(pairs).toHaveLength(17);
    expect(pairs).toContain('disputed>refunded');
    expect(pairs).not.toContain('completed>disputed');
  });
});
