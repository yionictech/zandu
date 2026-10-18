/** Mois comptables, à l'heure du Congo (UTC+1, sans heure d'été). */
const TIME_ZONE = 'Africa/Brazzaville';

/** Aujourd'hui au Congo, AAAA-MM-JJ. */
export const today = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format();

export interface Month {
  /** AAAA-MM */
  key: string;
  label: string;
  from: string;
  /** Dernier jour du mois, ou aujourd'hui pour le mois en cours. */
  to: string;
}

const monthLabel = new Intl.DateTimeFormat('fr-FR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function month(key: string): Month {
  const [year, m] = key.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const end = `${key}-${String(last).padStart(2, '0')}`;
  const now = today();
  return {
    key,
    label: monthLabel.format(new Date(Date.UTC(year, m - 1, 1))),
    from: `${key}-01`,
    to: end < now ? end : now,
  };
}

/** Les `count` derniers mois, le plus récent d'abord. */
export function recentMonths(count = 12): Month[] {
  const [year, m] = today().split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, m - 1 - i, 1));
    return month(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  });
}

/** Mois demandé dans l'adresse (?mois=AAAA-MM) s'il fait partie des mois proposés. */
export function pickMonth(key: string | undefined): Month {
  const months = recentMonths();
  return months.find((m) => m.key === key) ?? months[0]!;
}

/**
 * Date saisie (AAAA-MM-JJ) → début de cette journée au Congo, en ISO.
 * Aujourd'hui ou une date passée → maintenant (une règle ne commence jamais dans le passé).
 */
export function startOfCongoDay(date: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= today()) return undefined;
  return `${date}T00:00:00+01:00`;
}

/** « Jusqu'au JJ inclus » → lendemain 00:00 au Congo, en ISO. */
export function endOfCongoDay(date: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.toISOString().slice(0, 10)}T00:00:00+01:00`;
}

const dayLabel = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

const shortDayLabel = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/** 2026-10-14 → « 14 octobre ». */
export const formatShortDay = (date: string): string =>
  shortDayLabel.format(new Date(`${date}T00:00:00Z`));

/** 2026-10-14 → « mardi 14 octobre ». */
export const formatDay = (date: string): string => dayLabel.format(new Date(`${date}T00:00:00Z`));

/** 1 000 points de base → « 10 % » ; 850 → « 8,5 % ». */
export const formatRate = (bps: number): string =>
  `${(bps / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}\u00a0%`;

/** Le contrôle couvre-t-il toute la journée (jusqu'à minuit), ou seulement jusqu'à une heure ? */
export const fullDay = (date: string, coveredUntil: string): boolean =>
  new Date(coveredUntil).getTime() >= new Date(`${date}T00:00:00+01:00`).getTime() + 86_400_000;
