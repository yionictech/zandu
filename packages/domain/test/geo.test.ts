import { describe, expect, it } from 'vitest';
import {
  arrivalMinutes,
  distanceMeters,
  formatDistance,
  isInCongo,
  latLngAtOffset,
  offsetFromCenter,
} from '../src/index.js';

const marche = { lat: -4.7761, lng: 11.8635 }; // Grand marché, Pointe-Noire
const tieTie = { lat: -4.7612, lng: 11.8735 };

describe('Distances et temps d’arrivée', () => {
  it('mesure à vol d’oiseau', () => {
    expect(distanceMeters(marche, tieTie)).toBeGreaterThan(1900);
    expect(distanceMeters(marche, tieTie)).toBeLessThan(2100);
    expect(distanceMeters(marche, marche)).toBe(0);
  });

  it('compte le détour et la vitesse d’une moto en ville', () => {
    // ~1,99 km × 1,4 = 2,8 km à 18 km/h = 9,3 min → 10 min.
    expect(arrivalMinutes(marche, tieTie)).toBe(10);
    expect(arrivalMinutes(marche, marche)).toBe(1);
  });

  it('refuse un repère hors du Congo', () => {
    expect(isInCongo(marche)).toBe(true);
    expect(isInCongo({ lat: 48.85, lng: 2.35 })).toBe(false);
  });

  it('écrit la distance comme on la dit', () => {
    expect(formatDistance(847)).toBe('850 m');
    expect(formatDistance(2390)).toBe('2,4 km');
  });
});

describe('Repère sur la carte', () => {
  it('un toucher à côté du centre donne le point touché, et inversement', () => {
    const p = latLngAtOffset(marche, 16, 40, -30);
    const back = offsetFromCenter(marche, p, 16);
    expect(back.dx).toBeCloseTo(40, 0);
    expect(back.dy).toBeCloseTo(-30, 0);
    // Au zoom 16, 1 px ≈ 2,4 m : 50 px ≈ 120 m.
    expect(distanceMeters(marche, p)).toBeGreaterThan(100);
    expect(distanceMeters(marche, p)).toBeLessThan(140);
  });
});
