import { DomainError } from './errors.js';

export type MobileOperator = 'mtn' | 'airtel';
export const MOBILE_OPERATORS: readonly MobileOperator[] = ['mtn', 'airtel'];

export interface CongoMobileNumber {
  /** Format international stocké en base : +242061234567 */
  e164: string;
  /** Format national affiché : 06 123 45 67 */
  display: string;
  /**
   * Opérateur probable déduit du préfixe (06 = MTN ; 04, 05 = Airtel). Ce n'est qu'une
   * suggestion : avec la portabilité des numéros annoncée par l'ARPCE, l'utilisateur
   * confirme toujours son opérateur Mobile Money.
   */
  suggestedOperator: MobileOperator | null;
}

const COUNTRY_CODE = '242';
const PREFIX_OPERATOR: Record<string, MobileOperator> = {
  '06': 'mtn',
  '05': 'airtel',
  '04': 'airtel',
};

/**
 * Normalise un numéro mobile congolais (République du Congo, +242). Au Congo le « 0 »
 * initial fait partie du numéro et se conserve au format international.
 * Accepte « 06 612 34 56 », « 066123456 », « +242 06 612 34 56 », « 00242066123456 »,
 * et la saisie fréquente sans le 0 (« 66123456 »).
 */
export function parseCongoMobile(input: string): CongoMobileNumber {
  let digits = input.replace(/[\s.\-()/]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  if (!/^\d+$/.test(digits)) {
    throw new DomainError('invalid_phone', 'Le numéro ne doit contenir que des chiffres', {
      input,
    });
  }

  let national: string;
  if (digits.length === 12 && digits.startsWith(COUNTRY_CODE)) national = digits.slice(3);
  else if (digits.length === 11 && digits.startsWith(COUNTRY_CODE))
    national = `0${digits.slice(3)}`;
  else if (digits.length === 9) national = digits;
  else if (digits.length === 8) national = `0${digits}`;
  else throw new DomainError('invalid_phone', 'Numéro congolais invalide', { input });

  if (!/^0[4-6]\d{7}$/.test(national)) {
    throw new DomainError('invalid_phone', 'Numéro mobile congolais attendu (04, 05 ou 06)', {
      input,
    });
  }

  return {
    e164: `+${COUNTRY_CODE}${national}`,
    display: `${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5, 7)} ${national.slice(7)}`,
    suggestedOperator: PREFIX_OPERATOR[national.slice(0, 2)] ?? null,
  };
}
