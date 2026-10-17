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

export const formatDateTime = (iso: string | null | undefined): string =>
  iso ? dateTime.format(new Date(iso)) : '—';

export function displayPhone(e164: string): string {
  try {
    return parseCongoMobile(e164).display;
  } catch {
    return e164;
  }
}

export function suggestOperator(phone: string): 'mtn' | 'airtel' | null {
  try {
    return parseCongoMobile(phone).suggestedOperator;
  } catch {
    return null;
  }
}

/** « ventilateur-sur-pied-16-pouces » pour des adresses lisibles. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
