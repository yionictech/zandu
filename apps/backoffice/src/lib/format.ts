import { formatXaf, parseCongoMobile } from '@zandu/domain';

export { formatXaf };

const dateTime = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Brazzaville',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Montant signé : « +2 500 FCFA », « −2 500 FCFA » (vrai signe moins). */
export const signedXaf = (amount: number): string =>
  amount > 0 ? `+${formatXaf(amount)}` : amount < 0 ? `−${formatXaf(-amount)}` : formatXaf(0);

const time = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Brazzaville',
  hour: '2-digit',
  minute: '2-digit',
});
export const formatTime = (iso: string): string => time.format(new Date(iso));

/** « 1 paiement », « 3 paiements » ; rien quand il n'y en a pas. */
export const plural = (count: number, word: string, words = `${word}s`): string =>
  count ? `${count} ${count > 1 ? words : word}` : '';

export const formatDateTime = (iso: string | null | undefined): string =>
  iso ? dateTime.format(new Date(iso)) : '—';

export function displayPhone(e164: string | null | undefined): string {
  if (!e164) return '—';
  try {
    return parseCongoMobile(e164).display;
  } catch {
    return e164;
  }
}

/** « dans 5 h » / « en retard de 2 h » par rapport à maintenant. */
export function deadline(iso: string): { label: string; late: boolean } {
  const hours = Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000);
  if (hours < 0) return { label: `en retard de ${-hours} h`, late: true };
  return { label: hours === 0 ? 'moins d’une heure' : `dans ${hours} h`, late: false };
}

export const OPERATORS = { mtn: 'MTN MoMo', airtel: 'Airtel Money' } as const;
