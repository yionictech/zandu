'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cart, type CartLine } from '@/lib/cart';

/** « Acheter maintenant » (vers la commande) et « Ajouter au panier ». */
export function AddToCart({ line }: { line: Omit<CartLine, 'quantity'> }) {
  const router = useRouter();
  const [added, setAdded] = useState(false);
  if (line.stock <= 0) return <p className="error">Rupture de stock</p>;
  return (
    <div className="stack">
      <div className="actions">
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            cart.add(line);
            setAdded(true);
          }}
        >
          Ajouter au panier
        </button>
        <button
          type="button"
          className="button"
          data-testid="buy-now"
          onClick={() => {
            cart.add(line);
            router.push(`/commande?produits=${line.productId}`);
          }}
        >
          Acheter maintenant
        </button>
      </div>
      {added ? <p className="notice small">Ajouté au panier.</p> : null}
    </div>
  );
}
