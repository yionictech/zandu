import { formatXaf, parseCongoMobile } from '@zandu/domain';

export { formatXaf };

const dateTime = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Brazzaville',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

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
