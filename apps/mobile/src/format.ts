import { formatXaf, parseCongoMobile } from '@zandu/domain';

export { formatXaf };

const dateTime = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Brazzaville',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Brazzaville',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));
export const formatDate = (iso: string): string => dateOnly.format(new Date(iso));

/** « 06 612 34 56 » pour un numéro +242 ; le numéro tel quel sinon. */
export function displayPhone(e164: string): string {
  try {
    return parseCongoMobile(e164).display;
  } catch {
    return e164;
  }
}

/** Opérateur probable d'après le préfixe (06 MTN ; 04/05 Airtel) — toujours modifiable. */
export function suggestOperator(phone: string): 'mtn' | 'airtel' | null {
  try {
    return parseCongoMobile(phone).suggestedOperator;
  } catch {
    return null;
  }
}

export function isValidCongoPhone(phone: string): boolean {
  try {
    parseCongoMobile(phone);
    return true;
  } catch {
    return false;
  }
}

/** Compte à rebours « 09:42 ». */
export function countdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Saisie d'un prix : « 50000 » s'affiche « 50 000 » pendant la frappe. */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Taux en points de base → « 8 % », « 12,5 % ». */
export function formatRate(bps: number): string {
  return `${(bps / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
}
