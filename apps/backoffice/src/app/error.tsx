'use client';

/** Erreur inattendue (API injoignable, par exemple) : message clair et nouvel essai. */
export default function ConsoleError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card empty" role="alert" style={{ margin: 24 }}>
      <h2>Le back-office n'a pas pu joindre l'API Zandu.</h2>
      <p>
        Vérifiez la connexion puis réessayez. Si le problème persiste, prévenez l'équipe technique.
      </p>
      <button type="button" className="button" onClick={reset}>
        Réessayer
      </button>
    </div>
  );
}
