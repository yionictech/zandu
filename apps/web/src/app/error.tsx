'use client';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main style={{ maxWidth: 560 }}>
      <h1>Connexion difficile</h1>
      <p className="muted">Vérifiez vos données mobiles, puis réessayez.</p>
      <button type="button" className="button block" onClick={reset}>
        Réessayer
      </button>
    </main>
  );
}
