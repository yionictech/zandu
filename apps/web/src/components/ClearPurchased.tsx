'use client';

import { useEffect } from 'react';
import { cart } from '@/lib/cart';

/** Retire du panier les articles qui viennent d'être commandés (une seule fois). */
export function ClearPurchased({ productIds }: { productIds: string[] }) {
  useEffect(() => {
    if (productIds.length) cart.removeMany(productIds);
  }, [productIds]);
  return null;
}
