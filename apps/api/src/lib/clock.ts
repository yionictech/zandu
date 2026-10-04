/** Horloge injectable : toutes les règles de délai lisent l'heure ici, jamais via now() SQL. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export const addMinutes = (date: Date, minutes: number): Date =>
  new Date(date.getTime() + minutes * 60_000);
export const addSeconds = (date: Date, seconds: number): Date =>
  new Date(date.getTime() + seconds * 1_000);
export const addHours = (date: Date, hours: number): Date =>
  new Date(date.getTime() + hours * 3_600_000);
