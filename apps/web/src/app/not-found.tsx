import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ maxWidth: 560 }}>
      <h1>Page introuvable</h1>
      <p className="muted">Ce produit n’est plus en vente, ou le lien est incomplet.</p>
      <Link href="/" className="button block">
        Voir les produits
      </Link>
    </main>
  );
}
