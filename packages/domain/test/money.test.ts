import { describe, expect, it } from 'vitest';
import { applyRate, formatXaf, prorate, sum } from '../src/index.js';

describe('money', () => {
  it('applique un taux en points de base avec arrondi au franc le plus proche', () => {
    expect(applyRate(50_000, 1_000)).toBe(5_000); // 10 %
    expect(applyRate(25_005, 850)).toBe(2_125); // 2 125,425 -> 2 125
    expect(applyRate(15, 1_000)).toBe(2); // 1,5 -> 2 (demi vers le haut)
    expect(applyRate(14, 1_000)).toBe(1); // 1,4 -> 1
    expect(applyRate(12_345, 0)).toBe(0);
  });

  it('refuse les montants non entiers, négatifs ou les taux hors bornes', () => {
    expect(() => applyRate(10.5, 1_000)).toThrow(/entier/);
    expect(() => applyRate(-1, 1_000)).toThrow();
    expect(() => applyRate(100, 10_001)).toThrow(/taux/);
    expect(() => applyRate(100, 12.5)).toThrow(/taux/);
  });

  it('calcule une part proportionnelle arrondie à l’inférieur', () => {
    expect(prorate(5_000, 30_000, 50_000)).toBe(3_000);
    expect(prorate(1_001, 1, 3)).toBe(333);
    expect(() => prorate(100, 4, 3)).toThrow();
  });

  it('additionne sans perte de précision', () => {
    expect(sum([1, 2, 3])).toBe(6);
    expect(() => sum([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  });

  it('formate en français', () => {
    expect(formatXaf(25_000).replace(/\s/g, ' ')).toBe('25 000 FCFA');
    expect(formatXaf(1_250_000).replace(/\s/g, ' ')).toBe('1 250 000 FCFA');
  });
});
