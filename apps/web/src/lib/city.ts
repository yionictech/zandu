import { cookies } from 'next/headers';

/** Villes desservies : l'accueil ne montre que ce qui est livrable dans la ville choisie. */
export const CITIES = ['Pointe-Noire', 'Brazzaville'] as const;
export type City = (typeof CITIES)[number];

export const CITY_COOKIE = 'zandu.ville';

/** Ville choisie (cookie posé par /ville), Pointe-Noire par défaut. */
export async function currentCity(): Promise<City> {
  const value = (await cookies()).get(CITY_COOKIE)?.value;
  return CITIES.find((c) => c === value) ?? 'Pointe-Noire';
}
