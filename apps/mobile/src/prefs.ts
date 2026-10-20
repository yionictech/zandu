import type { ProductCard } from '@zandu/api-client';
import { useSyncExternalStore } from 'react';
import { loadJson, saveJson } from './storage';

/**
 * Préférences gardées sur le téléphone, sans compte : la ville choisie à l'accueil et les
 * produits mis en favori (maquettes acheteur). Rien n'est envoyé au serveur.
 */
function persisted<T>(key: string, initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  const ready = loadJson<T>(key, initial).then((saved) => {
    value = saved;
    listeners.forEach((l) => l());
  });
  return {
    ready,
    get: () => value,
    set(next: T) {
      value = next;
      void saveJson(key, next);
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const CITIES = ['Pointe-Noire', 'Brazzaville'] as const;
export type City = (typeof CITIES)[number];

const city = persisted<City>('zandu.city', 'Pointe-Noire');

/** Ville de l'acheteur : l'accueil montre les produits livrables dans cette ville. */
export function useCity(): [City, (next: City) => void] {
  const value = useSyncExternalStore(city.subscribe, city.get);
  return [value, city.set];
}

/** Produit en favori : la carte telle qu'affichée, pour la revoir même sans réseau. */
export type Favorite = Pick<ProductCard, 'id' | 'title' | 'price' | 'coverImage'> & {
  shopName: string;
};

const favorites = persisted<Favorite[]>('zandu.favorites', []);
const MAX_FAVORITES = 100;

export function useFavorites() {
  const list = useSyncExternalStore(favorites.subscribe, favorites.get);
  return {
    list,
    has: (id: string) => list.some((f) => f.id === id),
    toggle(item: Favorite) {
      const current = favorites.get();
      favorites.set(
        current.some((f) => f.id === item.id)
          ? current.filter((f) => f.id !== item.id)
          : [item, ...current].slice(0, MAX_FAVORITES),
      );
    },
  };
}
