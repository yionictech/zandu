'use client';

import Link from 'next/link';
import { cart, useCart } from '@/lib/cart';
import { formatXaf } from '@/lib/format';

/** Panier : regroupé par boutique (une commande par vendeur, un seul paiement). */
export function CartView() {
  const lines = useCart();
  if (lines.length === 0) {
    return (
      <div className="card stack">
        <p className="muted">Votre panier est vide.</p>
        <Link href="/" className="button secondary">
          Découvrir les produits
        </Link>
      </div>
    );
  }
  const shops = [...new Set(lines.map((l) => l.shopName))];
  const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  return (
    <div className="stack">
      {shops.map((shop) => (
        <section key={shop} className="card">
          <h2>{shop}</h2>
          {lines
            .filter((l) => l.shopName === shop)
            .map((l) => (
              <div key={l.productId} className="line">
                {l.coverImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.coverImage} alt="" width={64} height={64} />
                ) : (
                  <div className="placeholder" />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link href={`/produit/${l.productId}`}>{l.title}</Link>
                  <div className="tile-price">{formatXaf(l.price * l.quantity)}</div>
                </div>
                <div className="qty">
                  <button
                    type="button"
                    aria-label="Retirer un"
                    onClick={() => cart.setQuantity(l.productId, l.quantity - 1)}
                  >
                    −
                  </button>
                  <span>{l.quantity}</span>
                  <button
                    type="button"
                    aria-label="Ajouter un"
                    disabled={l.quantity >= l.stock}
                    onClick={() => cart.setQuantity(l.productId, l.quantity + 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
        </section>
      ))}
      <section className="card stack">
        <div className="row">
          <strong>Articles</strong>
          <strong data-testid="cart-total">{formatXaf(total)}</strong>
        </div>
        <p className="small muted">Les frais de livraison sont calculés à l’étape suivante.</p>
        <Link href="/commande" className="button" data-testid="cart-checkout">
          Commander
        </Link>
      </section>
    </div>
  );
}
