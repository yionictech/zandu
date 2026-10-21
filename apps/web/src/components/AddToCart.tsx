'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cart, type CartLine } from '@/lib/cart';

/** Chariot dessiné à la main : pas de bibliothèque d'icônes dans le JavaScript de la fiche. */
function CartIcon() {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </svg>
  );
}

/** Barre d'achat en bas de la fiche (maquette) : panier rond et « Acheter maintenant ». */
export function AddToCart({ line }: { line: Omit<CartLine, 'quantity'> }) {
  const router = useRouter();
  const [added, setAdded] = useState(false);
  if (line.stock <= 0) return <p className="error">Rupture de stock</p>;
  return (
    <>
      {added ? <p className="notice small">Ajouté au panier.</p> : null}
      <div className="buy-bar">
        <button
          type="button"
          className="button secondary cart-button"
          aria-label="Ajouter au panier"
          data-testid="add-to-cart"
          onClick={() => {
            cart.add(line);
            setAdded(true);
          }}
        >
          <CartIcon />
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
    </>
  );
}
