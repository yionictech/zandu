import { describe, expect, it } from 'vitest';
import { rideQuote } from '../src/index.js';

// Pointe-Noire : rond-point Lumumba → Tié-Tié (environ 2 km à vol d'oiseau).
const LUMUMBA = { lat: -4.7761, lng: 11.8635 };
const TIE_TIE = { lat: -4.7612, lng: 11.8735 };

describe('Prix du moto-taxi', () => {
  it('prise en charge + kilomètres, arrondi à 50, part du conducteur', () => {
    const q = rideQuote(LUMUMBA, TIE_TIE);
    expect(q.distanceMeters).toBeGreaterThan(2_000);
    expect(q.price % 50).toBe(0);
    expect(q.price).toBeGreaterThanOrEqual(500);
    expect(q.courierShare).toBeLessThan(q.price);
    expect(q.courierShare % 50).toBe(0);
    expect(q.etaMinutes).toBeGreaterThan(0);
  });

  it('minimum pour un petit trajet, refus trop court ou trop long', () => {
    const near = { lat: LUMUMBA.lat + 0.003, lng: LUMUMBA.lng };
    expect(rideQuote(LUMUMBA, near).price).toBe(500);
    expect(() => rideQuote(LUMUMBA, LUMUMBA)).toThrow(/trop proches/);
    expect(() => rideQuote(LUMUMBA, { lat: -4.26, lng: 15.28 })).toThrow(/30 km/);
  });
});
