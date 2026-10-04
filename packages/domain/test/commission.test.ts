import { describe, expect, it } from 'vitest';
import { lineCommission, resolveCommissionRate, type CommissionRule } from '../src/index.js';

const t0 = new Date('2027-01-01T00:00:00Z');
const at = new Date('2027-03-01T00:00:00Z');

const rules: CommissionRule[] = [
  { scope: 'default', rateBps: 1_000, validFrom: t0 },
  { scope: 'category', categoryId: 'electronique', rateBps: 800, validFrom: t0 },
  { scope: 'category', categoryId: 'mode', rateBps: 1_200, validFrom: t0 },
  // Offre de lancement : 0 % pendant 3 mois pour un vendeur pionnier.
  {
    scope: 'seller',
    sellerId: 'pionnier',
    rateBps: 0,
    validFrom: t0,
    validTo: new Date('2027-04-01T00:00:00Z'),
  },
];

describe('resolveCommissionRate', () => {
  it('prend le taux de la catégorie la plus précise, puis des ancêtres', () => {
    expect(
      resolveCommissionRate(
        rules,
        { sellerId: 's', categoryPath: ['smartphones', 'electronique'] },
        at,
      ),
    ).toBe(800);
    expect(resolveCommissionRate(rules, { sellerId: 's', categoryPath: ['mode'] }, at)).toBe(1_200);
  });

  it('retombe sur le taux par défaut', () => {
    expect(resolveCommissionRate(rules, { sellerId: 's', categoryPath: ['maison'] }, at)).toBe(
      1_000,
    );
  });

  it('applique la règle vendeur en priorité, pendant sa période de validité seulement', () => {
    const target = { sellerId: 'pionnier', categoryPath: ['mode'] };
    expect(resolveCommissionRate(rules, target, at)).toBe(0);
    expect(resolveCommissionRate(rules, target, new Date('2027-04-01T00:00:00Z'))).toBe(1_200);
  });

  it('retient la règle la plus récente quand deux se chevauchent', () => {
    const updated = [
      ...rules,
      { scope: 'default' as const, rateBps: 900, validFrom: new Date('2027-02-01T00:00:00Z') },
    ];
    expect(resolveCommissionRate(updated, { sellerId: 's', categoryPath: [] }, at)).toBe(900);
  });

  it('échoue explicitement si aucun taux par défaut n’est configuré', () => {
    expect(() => resolveCommissionRate([], { sellerId: 's', categoryPath: [] }, at)).toThrow(
      /défaut/,
    );
  });

  it('calcule la commission d’une ligne', () => {
    expect(lineCommission(50_000, 1_000)).toBe(5_000);
  });
});
