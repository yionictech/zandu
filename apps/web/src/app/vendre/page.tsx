import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vendre sur Zandu',
  description:
    'Ouvrez votre boutique en 2 minutes depuis votre téléphone. Payé sur Mobile Money dès que le client a son colis.',
};

/** Page d'accueil des vendeurs : la vente se fait depuis l'application Android. */
export default function SellPage() {
  return (
    <main style={{ maxWidth: 680 }}>
      <h1>Vendez sur Zandu</h1>
      <section className="card stack">
        <p>
          <strong>Ouvrez votre boutique en 2 minutes</strong> depuis l’application Android : un nom,
          votre quartier, votre numéro Mobile Money. Aucune pièce demandée pour commencer.
        </p>
        <p>
          <strong>Publiez un produit en prenant une photo.</strong> Vous voyez tout de suite ce que
          vous recevrez, commission déduite.
        </p>
        <p>
          <strong>Payé sur MTN MoMo ou Airtel Money</strong> dès que le client a son colis : un
          livreur Zandu passe le chercher, le client paie d’avance, votre argent est garanti.
        </p>
        <p className="muted small">
          L’application Android arrive bientôt sur Google Play. Partagez ensuite le lien de votre
          boutique dans vos groupes WhatsApp.
        </p>
      </section>
    </main>
  );
}
