import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Politique de confidentialité',
  description: 'Les données que Zandu collecte, pourquoi, combien de temps, et vos droits.',
};

/** Politique de confidentialité (Google Play, App Store, loi congolaise 29-2019). */
export default function PrivacyPage() {
  return (
    <main className="legal" style={{ maxWidth: 720 }}>
      <h1>Politique de confidentialité</h1>
      <p className="muted small">Mise à jour le {LEGAL.updated}.</p>

      <h2>Qui est responsable</h2>
      <p>
        {LEGAL.company}, {LEGAL.address}
        {LEGAL.rccm ? `, RCCM ${LEGAL.rccm}` : ''}. Contact : {LEGAL.email}
        {LEGAL.phone ? `, ${LEGAL.phone}` : ''}.
      </p>

      <h2>Ce que nous collectons, et pourquoi</h2>
      <ul>
        <li>
          <strong>Numéro de téléphone</strong> : votre identité sur Zandu (connexion par code SMS)
          et le paiement Mobile Money.
        </li>
        <li>
          <strong>Nom et adresse de livraison</strong> (repère, et position GPS si vous la donnez) :
          livrer vos commandes. Le vendeur et le livreur voient ce qui leur est utile.
        </li>
        <li>
          <strong>Commandes et paiements</strong> : montants, dates, statuts, numéro Mobile Money
          utilisé. Nécessaire au service et imposé par la loi (comptabilité).
        </li>
        <li>
          <strong>Vendeurs</strong> : nom de la boutique, numéro de reversement, et pour la
          vérification : pièce d’identité, photo, RCCM et NIU pour une entreprise.
        </li>
        <li>
          <strong>Livreurs</strong> : position pendant une livraison seulement, pour que le client
          suive son colis.
        </li>
        <li>
          <strong>Photos, avis et messages</strong> que vous publiez ou envoyez au support.
        </li>
        <li>
          <strong>Technique</strong> : appareil et jeton de notification, adresse IP, journaux de
          sécurité (prévenir la fraude).
        </li>
      </ul>
      <p>
        Pas de publicité ciblée, pas de revente de données, pas de traceur publicitaire dans
        l’application ou sur le site.
      </p>

      <h2>Avec qui nous les partageons</h2>
      <ul>
        <li>
          l’agrégateur Mobile Money et les opérateurs MTN et Airtel (paiements, reversements) ;
        </li>
        <li>le fournisseur de SMS et WhatsApp (codes et avis de commande) ;</li>
        <li>l’hébergeur des serveurs (Union européenne) ;</li>
        <li>les services de notification de Google et Apple (alertes sur le téléphone) ;</li>
        <li>Google Maps, pour afficher les cartes dans l’application ;</li>
        <li>les autorités, sur demande légale.</li>
      </ul>

      <h2>Combien de temps</h2>
      <ul>
        <li>compte : tant qu’il est ouvert ; effacé à la suppression ;</li>
        <li>commandes et paiements : 10 ans, sans votre nom après suppression du compte ;</li>
        <li>codes SMS : quelques minutes ; journaux techniques : 12 mois au plus.</li>
      </ul>

      <h2>Vos droits</h2>
      <p>
        Accès, rectification, opposition et suppression. Vous pouvez{' '}
        <Link href="/supprimer-mon-compte">supprimer votre compte</Link> vous-même, dans
        l’application (Compte) ou sur le site. Pour toute autre demande : {LEGAL.email}. Réponse
        sous 30 jours. Vous pouvez aussi saisir l’autorité congolaise de protection des données.
      </p>

      <h2>Sécurité</h2>
      <p>
        Connexions chiffrées (HTTPS), codes à usage unique, accès du personnel protégé par un second
        facteur et journalisé, sauvegardes chiffrées.
      </p>

      <h2>Enfants</h2>
      <p>Zandu s’adresse aux personnes majeures (18 ans et plus).</p>
    </main>
  );
}
