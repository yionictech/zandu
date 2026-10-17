'use client';

import { useSyncExternalStore } from 'react';

/** Panier multi-vendeurs gardé dans le navigateur (même forme que dans l'application). */
export interface CartLine {
  productId: string;
  title: string;
  price: number;
  coverImage: string | null;
  sellerId: string;
  shopName: string;
  quantity: number;
  stock: number;
}

const KEY = 'zandu.cart';
const EMPTY: CartLine[] = [];
let cache: CartLine[] | null = null;
const listeners = new Set<() => void>();

function read(): CartLine[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? '[]') as CartLine[];
  } catch {
    cache = [];
  }
  return cache;
}

function write(lines: CartLine[]): void {
  cache = lines;
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    // Stockage indisponible (navigation privée) : le panier vit le temps de la page.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage); // autre onglet
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useCart(): CartLine[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export const cart = {
  add(line: Omit<CartLine, 'quantity'>, quantity = 1): void {
    const lines = read();
    const existing = lines.find((l) => l.productId === line.productId);
    write(
      existing
        ? lines.map((l) =>
            l.productId === line.productId
              ? { ...l, quantity: Math.min(l.quantity + quantity, line.stock) }
              : l,
          )
        : [...lines, { ...line, quantity: Math.min(quantity, line.stock) }],
    );
  },
  setQuantity(productId: string, quantity: number): void {
    write(
      read()
        .map((l) =>
          l.productId === productId ? { ...l, quantity: Math.min(quantity, l.stock) } : l,
        )
        .filter((l) => l.quantity > 0),
    );
  },
  removeMany(productIds: string[]): void {
    write(read().filter((l) => !productIds.includes(l.productId)));
  },
};
