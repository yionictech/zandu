'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { cart, type CartLine } from '@/lib/cart';

/** Ajoute les articles au panier du navigateur puis ouvre le panier. */
export function BuyAgain({ lines }: { lines: CartLine[] }) {
  const router = useRouter();
  useEffect(() => {
    if (!lines.length) return;
    for (const { quantity, ...line } of lines) cart.add(line, quantity);
    router.replace('/panier');
  }, [lines, router]);
  return (
    <p className="card muted">
      {lines.length ? 'Ajout au panier…' : 'Ces produits ne sont plus en vente.'}
    </p>
  );
}
