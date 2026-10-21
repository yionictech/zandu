import { describe, expect, it } from 'vitest';
import {
  addOpenMinutes,
  assertWeeklyHours,
  transitionOrder,
  weeklyHoursSummary,
  type WeeklyHours,
} from '../src/index.js';

/** Lundi – samedi 08:00 – 18:00, fermé le dimanche. */
const SHOP: WeeklyHours = [
  ...Array.from({ length: 6 }, () => ({ open: '08:00', close: '18:00' })),
  null,
];
// Heure de Brazzaville = UTC+1 : « 2027-05-10T10:00+01:00 » est un lundi à 10 h.
const at = (local: string) => new Date(`${local}+01:00`);

describe('Heures d’ouverture', () => {
  it('pendant l’ouverture, le délai court normalement', () => {
    expect(addOpenMinutes(at('2027-05-10T10:00'), 120, SHOP)).toEqual(at('2027-05-10T12:00'));
  });

  it('payée le soir : le délai démarre à l’ouverture du lendemain', () => {
    expect(addOpenMinutes(at('2027-05-10T20:00'), 120, SHOP)).toEqual(at('2027-05-11T10:00'));
  });

  it('à cheval sur la fermeture : le reste est reporté au lendemain', () => {
    expect(addOpenMinutes(at('2027-05-10T17:00'), 120, SHOP)).toEqual(at('2027-05-11T09:00'));
  });

  it('le dimanche fermé est sauté', () => {
    // Samedi 17:30 + 2 h → 30 min le samedi, puis lundi 08:00 + 1 h 30.
    expect(addOpenMinutes(at('2027-05-15T17:30'), 120, SHOP)).toEqual(at('2027-05-17T09:30'));
  });

  it('avant l’ouverture, le délai démarre à l’ouverture', () => {
    expect(addOpenMinutes(at('2027-05-10T06:00'), 30, SHOP)).toEqual(at('2027-05-10T08:30'));
  });

  it('24 h d’ouverture font plusieurs jours', () => {
    // 10 h par jour : lundi 08:00 + 24 h → mercredi 12:00.
    expect(addOpenMinutes(at('2027-05-10T08:00'), 24 * 60, SHOP)).toEqual(at('2027-05-12T12:00'));
  });

  it('sans jour ouvert, le temps court normalement', () => {
    expect(addOpenMinutes(at('2027-05-10T20:00'), 60, Array(7).fill(null))).toEqual(
      at('2027-05-10T21:00'),
    );
  });

  it('vérifie la semaine et la résume', () => {
    expect(() => assertWeeklyHours(SHOP)).not.toThrow();
    expect(() => assertWeeklyHours(SHOP.slice(0, 6))).toThrow('7 jours');
    expect(() => assertWeeklyHours([{ open: '18:00', close: '08:00' }, ...SHOP.slice(1)])).toThrow(
      'fermeture',
    );
    expect(() => assertWeeklyHours([{ open: '8h', close: '18:00' }, ...SHOP.slice(1)])).toThrow(
      'Heure invalide',
    );
    expect(weeklyHoursSummary(SHOP)).toBe('Lun – Sam · 08:00 – 18:00');
    expect(weeklyHoursSummary([...SHOP.slice(0, 5), { open: '09:00', close: '13:00' }, null])).toBe(
      'Lun – Ven · 08:00 – 18:00 ; Sam · 09:00 – 13:00',
    );
    expect(weeklyHoursSummary(Array(7).fill(null))).toBe('Fermé');
  });

  it('le paiement fixe l’échéance d’acceptation selon les horaires', () => {
    const order = {
      status: 'pending_payment' as const,
      itemsSubtotal: 10_000,
      deliveryFee: 1_000,
      total: 11_000,
      refundedAmount: 0,
      deliveryMode: 'home' as const,
      sellerAcceptDeadline: null,
      disputeWindowEndsAt: null,
    };
    const policy = { sellerAcceptanceHours: 2, disputeWindowHours: 48 };
    const paidLate = transitionOrder(
      order,
      { type: 'payment_succeeded' },
      { actor: 'system', now: at('2027-05-10T20:00'), policy, sellerHours: SHOP },
    );
    expect(paidLate.patch.sellerAcceptDeadline).toEqual(at('2027-05-11T10:00'));
    const plain = transitionOrder(
      order,
      { type: 'payment_succeeded' },
      { actor: 'system', now: at('2027-05-10T20:00'), policy },
    );
    expect(plain.patch.sellerAcceptDeadline).toEqual(at('2027-05-10T22:00'));
  });
});
