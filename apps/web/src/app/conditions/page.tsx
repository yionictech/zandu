import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Conditions d’utilisation',
  description: 'Les règles d’achat, de vente et de livraison sur Zandu.',
};

/** Conditions générales d'utilisation et de vente de la place de marché. */
export default function TermsPage() {
  return (
    <main className="legal" style={{ maxWidth: 720 }}>
      <h1>Conditions d’utilisation</h1>
      <p className="muted small">Mise à jour le {LEGAL.updated}.</p>

      <h2>1. Zandu</h2>
      <p>
        Zandu est une place de marché éditée par {LEGAL.company}, {LEGAL.address}
        {LEGAL.rccm ? `, RCCM ${LEGAL.rccm}` : ''}. Elle met en relation des acheteurs et des
        vendeurs indépendants à Pointe-Noire et Brazzaville, et organise la livraison. Zandu n’est
        pas le vendeur des produits.
      </p>

      <h2>2. Compte</h2>
      <p>
        Le compte s’ouvre avec un numéro de téléphone confirmé par code SMS. Il faut avoir 18 ans.
        Vous êtes responsable de votre téléphone et des codes reçus : ne les donnez à personne, pas
        même au support.
      </p>

      <h2>3. Acheter</h2>
      <ul>
        <li>
          Le prix affiché comprend le produit ; les frais de livraison sont indiqués avant le
          paiement.
        </li>
        <li>
          Vous payez par MTN MoMo ou Airtel Money. <strong>L’argent est gardé</strong> par
          l’intermédiaire de paiement agréé et n’est versé au vendeur qu’après la remise du colis.
        </li>
        <li>
          À la livraison, vous donnez votre code de remise au livreur seulement après avoir vu le
          colis.
        </li>
        <li>
          Un problème (colis absent, abîmé, non conforme, contrefaçon) : signalez-le dans le délai
          indiqué sur la commande. Le support examine et peut rembourser sur votre Mobile Money.
        </li>
        <li>Commande non préparée ou non livrée à temps : remboursement intégral.</li>
      </ul>

      <h2>4. Vendre</h2>
      <ul>
        <li>
          Le vendeur décrit honnêtement ses produits (photos réelles, état, prix), garde son stock à
          jour et prépare les commandes dans le délai annoncé.
        </li>
        <li>
          Zandu prélève une commission sur chaque vente, affichée avant la publication. Le reste est
          reversé sur le Mobile Money du vendeur après la livraison et le délai de réclamation.
        </li>
        <li>
          Une vérification d’identité peut être demandée avant les reversements ou au-delà d’un
          certain montant.
        </li>
      </ul>

      <h2>5. Interdit</h2>
      <p>
        Produits illégaux, contrefaits, dangereux, volés, médicaments, armes, animaux vivants ;
        fausses annonces ; contourner le paiement Zandu ; harceler un acheteur, un vendeur ou un
        livreur. Zandu peut retirer une annonce, retenir un reversement le temps d’une enquête ou
        fermer un compte.
      </p>

      <h2>6. Responsabilité</h2>
      <p>
        Le vendeur répond de ses produits. Zandu répond de la garde de l’argent et de l’organisation
        de la livraison, dans la limite du montant de la commande. Le service peut être interrompu
        pour maintenance.
      </p>

      <h2>7. Données personnelles</h2>
      <p>
        Voir la <Link href="/confidentialite">politique de confidentialité</Link>. Vous pouvez{' '}
        <Link href="/supprimer-mon-compte">supprimer votre compte</Link> à tout moment.
      </p>

      <h2>8. Droit applicable</h2>
      <p>
        Droit de la République du Congo et actes uniformes OHADA. En cas de litige, contactez
        d’abord le support ({LEGAL.email}) ; à défaut, les tribunaux de Pointe-Noire sont
        compétents.
      </p>
    </main>
  );
}
