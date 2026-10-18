'use client';

import { useEffect } from 'react';
import { rememberProduct, type RecentProduct } from '@/lib/recent';

/** Retient la fiche consultée, pour la page « hors connexion ». */
export function RememberProduct({ product }: { product: RecentProduct }) {
  useEffect(() => rememberProduct(product), [product]);
  return null;
}
