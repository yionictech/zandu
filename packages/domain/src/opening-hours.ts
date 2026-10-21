import { DomainError } from './errors.js';

/** Horaires d'un jour : « 08:00 » à « 18:00 », le même jour (pas d'ouverture de nuit). */
export interface DayHours {
  open: string;
  close: string;
}

/** Semaine d'une boutique : 7 jours, du lundi (0) au dimanche (6) ; null = fermé ce jour-là. */
export type WeeklyHours = Array<DayHours | null>;

/** Brazzaville et Pointe-Noire : UTC+1 toute l'année (pas d'heure d'été). */
export const CONGO_UTC_OFFSET_MINUTES = 60;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const minutesOf = (time: string): number => {
  const match = TIME.exec(time);
  if (!match) throw new DomainError('invalid_hours', `Heure invalide : ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
};

/** Vérifie une semaine (7 jours, heures « HH:MM », fermeture après l'ouverture). */
export function assertWeeklyHours(week: WeeklyHours): void {
  if (week.length !== 7) throw new DomainError('invalid_hours', 'Une semaine compte 7 jours');
  week.forEach((day, i) => {
    if (day && minutesOf(day.close) <= minutesOf(day.open)) {
      throw new DomainError(
        'invalid_hours',
        `${DAY_NAMES[i]} : la fermeture doit suivre l'ouverture`,
        {
          day: i,
        },
      );
    }
  });
}

/**
 * Échéance qui ne compte que le temps d'ouverture de la boutique : une commande payée à 20 h
 * avec 2 h pour l'accepter, dans une boutique ouverte de 8 h à 18 h, doit l'être avant 10 h le
 * lendemain. Sans aucun jour ouvert, le temps court normalement.
 */
export function addOpenMinutes(
  start: Date,
  minutes: number,
  week: WeeklyHours,
  utcOffsetMinutes = CONGO_UTC_OFFSET_MINUTES,
): Date {
  const offset = utcOffsetMinutes * MINUTE_MS;
  let remaining = minutes * MINUTE_MS;
  if (remaining <= 0 || !week.some(Boolean)) return new Date(start.getTime() + remaining);
  // Calcul en « heure locale » (UTC décalé), puis retour en UTC.
  let local = start.getTime() + offset;
  for (let guard = 0; guard < 4000; guard++) {
    const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
    const weekday = (new Date(dayStart).getUTCDay() + 6) % 7;
    const day = week[weekday];
    if (day) {
      const opens = dayStart + minutesOf(day.open) * MINUTE_MS;
      const closes = dayStart + minutesOf(day.close) * MINUTE_MS;
      if (local < closes) {
        const from = Math.max(local, opens);
        if (closes - from >= remaining) return new Date(from + remaining - offset);
        remaining -= closes - from;
      }
    }
    local = dayStart + DAY_MS;
  }
  throw new DomainError('invalid_hours', 'Échéance introuvable');
}

/** « Lun – Sam · 08:00 – 18:00 » ; plusieurs plages séparées par « ; » ; « Fermé » sinon. */
export function weeklyHoursSummary(week: WeeklyHours): string {
  const groups: Array<{ from: number; to: number; hours: string }> = [];
  week.forEach((day, i) => {
    if (!day) return;
    const hours = `${day.open} – ${day.close}`;
    const last = groups.at(-1);
    if (last && last.to === i - 1 && last.hours === hours) last.to = i;
    else groups.push({ from: i, to: i, hours });
  });
  if (!groups.length) return 'Fermé';
  return groups
    .map(
      (g) =>
        `${g.from === g.to ? DAY_NAMES[g.from] : `${DAY_NAMES[g.from]} – ${DAY_NAMES[g.to]}`} · ${g.hours}`,
    )
    .join(' ; ');
}
