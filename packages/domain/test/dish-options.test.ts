import { describe, expect, it } from 'vitest';
import {
  isOpenAt,
  normalizeDishOptions,
  resolveDishOptions,
  titleWithOptions,
  type WeeklyHours,
} from '../src/index.js';

const groups = normalizeDishOptions([
  {
    name: ' Taille ',
    choices: [
      { label: 'Normal', extra: 0 },
      { label: 'Grand', extra: 1000 },
    ],
  },
  {
    name: 'Accompagnement',
    choices: [
      { label: 'Alloco', extra: 0 },
      { label: 'Manioc', extra: 0 },
      { label: 'Frites', extra: 500 },
    ],
  },
]);

describe('Options des plats', () => {
  it('additionne les suppléments et garde les choix', () => {
    expect(groups[0]!.name).toBe('Taille');
    const r = resolveDishOptions(groups, ['Grand', 'Frites']);
    expect(r.extra).toBe(1500);
    expect(r.options).toEqual([
      { group: 'Taille', choice: 'Grand', extra: 1000 },
      { group: 'Accompagnement', choice: 'Frites', extra: 500 },
    ]);
    expect(titleWithOptions('Poulet DG', r.options)).toBe('Poulet DG (Grand, Frites)');
    expect(resolveDishOptions(null, undefined)).toEqual({ extra: 0, options: [] });
  });

  it('exige un choix par groupe, parmi les propositions', () => {
    expect(() => resolveDishOptions(groups, ['Grand'])).toThrow(/Choisissez/);
    expect(() => resolveDishOptions(groups, ['Géant', 'Alloco'])).toThrow(/n'est pas proposé/);
    expect(() => resolveDishOptions(null, ['Grand'])).toThrow();
  });

  it('refuse des options mal formées', () => {
    expect(() =>
      normalizeDishOptions([{ name: 'Sauce', choices: [{ label: 'Pili', extra: 0 }] }]),
    ).toThrow();
    expect(() =>
      normalizeDishOptions([
        {
          name: 'Sauce',
          choices: [
            { label: 'Pili', extra: 0 },
            { label: 'pili', extra: 0 },
          ],
        },
      ]),
    ).toThrow(/double/);
    expect(() =>
      normalizeDishOptions([
        {
          name: 'Sauce',
          choices: [
            { label: 'A', extra: -1 },
            { label: 'B', extra: 0 },
          ],
        },
      ]),
    ).toThrow(/supplément/);
    const four = Array.from({ length: 4 }, (_, i) => ({
      name: `Choix ${i}`,
      choices: [
        { label: 'A', extra: 0 },
        { label: 'B', extra: 0 },
      ],
    }));
    expect(() => normalizeDishOptions(four)).toThrow(/3 choix/);
  });
});

describe('Ouvert maintenant', () => {
  // Lundi à samedi 10 h – 22 h, fermé le dimanche (heure du Congo, UTC+1).
  const week: WeeklyHours = [
    ...Array.from({ length: 6 }, () => ({ open: '10:00', close: '22:00' })),
    null,
  ];
  it('suit les horaires en heure du Congo', () => {
    expect(isOpenAt(week, new Date('2026-11-09T09:30:00Z'))).toBe(true); // lundi 10 h 30
    expect(isOpenAt(week, new Date('2026-11-09T08:30:00Z'))).toBe(false); // lundi 9 h 30
    expect(isOpenAt(week, new Date('2026-11-09T21:00:00Z'))).toBe(false); // lundi 22 h
    expect(isOpenAt(week, new Date('2026-11-08T12:00:00Z'))).toBe(false); // dimanche
    expect(isOpenAt(null, new Date())).toBe(true);
  });
});
