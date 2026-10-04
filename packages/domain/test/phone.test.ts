import { describe, expect, it } from 'vitest';
import { parseCongoMobile } from '../src/index.js';

describe('parseCongoMobile', () => {
  it.each([
    ['06 612 34 56', '+242066123456'],
    ['066123456', '+242066123456'],
    ['+242 06 612 34 56', '+242066123456'],
    ['00242066123456', '+242066123456'],
    ['242066123456', '+242066123456'],
    ['66123456', '+242066123456'], // saisie sans le 0 initial
    ['+242 66 12 34 56', '+242066123456'],
    ['05.512.34.56', '+242055123456'],
  ])('normalise %s', (input, e164) => {
    expect(parseCongoMobile(input).e164).toBe(e164);
  });

  it("suggère l'opérateur d'après le préfixe", () => {
    expect(parseCongoMobile('06 612 34 56').suggestedOperator).toBe('mtn');
    expect(parseCongoMobile('05 512 34 56').suggestedOperator).toBe('airtel');
    expect(parseCongoMobile('04 412 34 56').suggestedOperator).toBe('airtel');
  });

  it('formate pour l’affichage', () => {
    expect(parseCongoMobile('+242066123456').display).toBe('06 612 34 56');
  });

  it.each(['', '12345', '01 234 56 78', '+33 6 12 34 56 78', '06 612 34 5x', '0661234567'])(
    'rejette %s',
    (input) => {
      expect(() => parseCongoMobile(input)).toThrow();
    },
  );
});
