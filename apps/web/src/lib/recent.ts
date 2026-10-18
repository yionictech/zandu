'use client';

import { useSyncExternalStore } from 'react';

/** Produits consultés récemment, gardés dans le navigateur : revus même sans réseau. */
export interface RecentProduct {
  id: string;
  title: string;
  price: number;
  coverImage: string | null;
  shopName: string;
}

const KEY = 'zandu.recent';
const MAX = 20;
const EMPTY: RecentProduct[] = [];
let cache: RecentProduct[] | null = null;

function read(): RecentProduct[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? '[]') as RecentProduct[];
  } catch {
    cache = [];
  }
  return cache;
}

export function rememberProduct(product: RecentProduct): void {
  const list = [product, ...read().filter((p) => p.id !== product.id)].slice(0, MAX);
  cache = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Stockage indisponible (navigation privée) : rien à retenir.
  }
}

export function useRecentProducts(): RecentProduct[] {
  return useSyncExternalStore(
    () => () => undefined,
    read,
    () => EMPTY,
  );
}
