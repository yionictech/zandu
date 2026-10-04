import { describe, expect, it } from 'vitest';
import { applyPaymentSignal } from '../src/index.js';

describe('applyPaymentSignal', () => {
  it('suit le parcours nominal', () => {
    expect(applyPaymentSignal('created', 'pending')).toEqual({
      status: 'pending',
      changed: true,
      lateSuccess: false,
    });
    expect(applyPaymentSignal('pending', 'succeeded')).toEqual({
      status: 'succeeded',
      changed: true,
      lateSuccess: false,
    });
  });

  it('est idempotent face aux webhooks rejoués', () => {
    expect(applyPaymentSignal('succeeded', 'succeeded').changed).toBe(false);
    expect(applyPaymentSignal('failed', 'failed').changed).toBe(false);
  });

  it('ignore les informations périmées sans reculer', () => {
    expect(applyPaymentSignal('succeeded', 'pending')).toMatchObject({
      status: 'succeeded',
      changed: false,
    });
    expect(applyPaymentSignal('expired', 'pending')).toMatchObject({
      status: 'expired',
      changed: false,
    });
    expect(applyPaymentSignal('expired', 'failed')).toMatchObject({
      status: 'expired',
      changed: false,
    });
  });

  it('expire une demande restée sans réponse', () => {
    expect(applyPaymentSignal('pending', 'expired')).toMatchObject({
      status: 'expired',
      changed: true,
    });
  });

  it('détecte un succès tardif (après expiration ou échec) pour rembourser', () => {
    expect(applyPaymentSignal('expired', 'succeeded')).toEqual({
      status: 'succeeded',
      changed: true,
      lateSuccess: true,
    });
    expect(applyPaymentSignal('failed', 'succeeded').lateSuccess).toBe(true);
  });

  it('signale un conflit si un succès est contredit', () => {
    expect(() => applyPaymentSignal('succeeded', 'failed')).toThrow(/échec/);
  });
});
