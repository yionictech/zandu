# Expérience utilisateur — parcours et écrans

Les maquettes détaillées sont le travail du designer (semaines 1 à 4). Ce document fixe **ce que
chaque écran doit faire**, les états à prévoir et les textes clés, pour que maquettes et API concordent.

## 1. Parcours acheteur : commander en moins de 2 minutes

Réalisé dans l'application (`apps/mobile`) et sur le site (`apps/web`,
[captures](captures/site-web.jpg)) : un lien produit partagé sur WhatsApp s'affiche avec photo, titre et
prix, et s'achète sans installer l'application.

```
Fil / recherche ─► Fiche produit ─► « Acheter maintenant » ─► Récapitulatif ─► Validation PIN ─► Confirmé
   (découvrir)       (décider)          (1 appui)               (vérifier)      (sur le téléphone)   (rassurer)
```

| Étape        | Écran                    | Ce qui fait gagner du temps                                                                                 |
| ------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Découvrir    | Accueil « Pour toi »     | Catégories en pastilles, « Près de chez vous », reprise du dernier produit vu                               |
| Chercher     | Recherche                | Tolère accents et fautes (« telephone samsumg » trouve), filtres prix / ville / catégorie (API prête)       |
| Décider      | Fiche produit            | Promesse de livraison, garantie, avis, bouton « Discuter » pour la question qui bloque                      |
| Commander    | Récapitulatif (une page) | Connexion par SMS **seulement ici** ; adresse et numéro MoMo mémorisés ; domicile ou point relais avec prix |
| Payer        | Attente de validation    | Opérateur deviné, montant énorme, compte à rebours, aide si la demande n'arrive pas                         |
| Être rassuré | Confirmation             | Code de remise, frise de suivi, « Partager sur WhatsApp »                                                   |

### Fiche produit

```
┌────────────────────────────────┐
│ ←                    ♡   ⤴     │  ⤴ = partager sur WhatsApp
│ ┌────────────────────────────┐ │
│ │        PHOTO 1 / 4         │ │  balayage horizontal, 1re photo 800 px
│ └────────────────────────────┘ │
│ Ventilateur sur pied 16"       │
│ 50 000 FCFA                    │  gros, gras
│ ★ 4,6 (23 avis vérifiés)       │
│ 🚚 Livré à Tié-Tié demain      │  promesse calculée (zone + délai vendeur)
│    1 500 FCFA · ou 700 en relais│
│ 🛡 Garantie Zandu               │  vert confiance : « argent bloqué jusqu'à
│    Remboursé si non reçu        │   la livraison » (lien : comment ça marche)
│ ─────────────────────────────  │
│ Boutique Mama Grâce ✔ Vérifiée │
│ Répond en < 1 h · 128 ventes   │
│ [ Discuter avec le vendeur ]   │
│ Description…  Avis…            │
│ ┌────────────────────────────┐ │
│ │     ACHETER MAINTENANT     │ │  bouton principal, zone du pouce
│ └────────────────────────────┘ │
│        Ajouter au panier       │  action secondaire
└────────────────────────────────┘
```

### Attente de validation du paiement (l'écran le plus important du projet)

```
┌────────────────────────────────┐
│     Validez sur votre          │
│        téléphone               │
│                                │
│        51 500 FCFA             │  montant énorme
│   MTN MoMo · 06 612 34 56      │
│                                │
│   Tapez votre code PIN dans    │
│   la fenêtre qui s'est ouverte │
│                                │
│           09:42                │  compte à rebours (10 min, fourni par l'API)
│                                │
│ 🛡 Votre argent reste bloqué    │
│   jusqu'à la livraison.        │
│ ─────────────────────────────  │
│ Pas de fenêtre ?               │  aide : composer le code USSD de
│ › Voir comment valider         │  l'opérateur (texte paramétrable)
│ › Payer avec un autre numéro   │
│ › Changer d'opérateur          │
└────────────────────────────────┘
```

- L'application interroge `GET /v1/payments/{id}` toutes les 3 s (requête de quelques centaines d'octets).
- **Succès** → confirmation avec code de remise. **Échec** → message de l'API (`failure.message`) et
  deux boutons : « Réessayer » et « Autre opérateur ». **Expiration** → « Le délai est passé, votre panier
  est conservé » + « Payer à nouveau ».
- Si l'utilisateur quitte l'écran, une notification le ramène dès que le statut change.

### Suivi de commande

```
 ● Payée               lun. 10:02   « Votre argent est bloqué en sécurité »
 ● Acceptée            lun. 10:40
 ● Prête               lun. 15:10
 ● En route            mar. 09:15   Livreur : Arnaud · [Appeler]
 ○ Remise              —            Votre code : 4 8 2 9 1 6  [Renvoyer par SMS]
```

Après la remise : bandeau « **Tout est conforme ?** [Oui, tout va bien] [Signaler un problème] »
avec le délai restant (« jusqu'à jeudi 15:10 »). « Oui » libère immédiatement le paiement au vendeur.

### Signaler un problème (litige)

Motifs en pastilles (non reçu, différent de l'annonce, abîmé, contrefaçon, articles manquants, autre) →
photos depuis l'appareil photo → description → « Réponse du support sous 72 h » → suivi du litige.

## 2. Parcours vendeur : publier en moins de 5 minutes

Réalisé dans `apps/mobile/app/vendeur` ([captures](captures/parcours-vendeur-livreur.jpg)).

```
Ouvrir ma boutique (1 écran) ─► Ajouter un produit (photo d'abord) ─► Publié / en vérification
```

### Ouvrir ma boutique — un seul écran

Nom de la boutique · ville · quartier d'enlèvement · numéro Mobile Money de reversement (opérateur
deviné) → « Créer ma boutique ». **Aucune pièce demandée à ce stade.** Bandeau persistant ensuite :
« Vérifiez votre identité pour recevoir vos paiements (2 min) » → photo de la pièce, selfie, et pour
une entreprise RCCM + NIU.

### Ajouter un produit — la photo d'abord

```
┌────────────────────────────────┐
│ ← Nouveau produit              │
│ ┌──────┐┌──────┐┌──────┐       │
│ │  📷  ││ img  ││  +   │       │  appareil photo ouvert d'emblée,
│ └──────┘└──────┘└──────┘       │  jusqu'à 6 photos, compressées
│ Conseil : fond clair, de jour  │  sur le téléphone avant envoi
│                                │
│ Nom      [Ventilateur 16"    ] │
│ Prix     [ 50 000 ] FCFA       │  pavé numérique, séparateur auto
│ Stock    [ − 5 + ]             │
│ Catégorie [Maison ▾]  (suggérée)│
│ Description (facultatif)       │
│ Vous recevrez : 45 000 FCFA    │  transparence : prix − commission
│ ┌────────────────────────────┐ │
│ │          PUBLIER           │ │
│ └────────────────────────────┘ │
└────────────────────────────────┘
```

Brouillon enregistré à chaque champ ; envoi différé si le réseau manque. Dans l'application : chaque
photo est compressée sur le téléphone (1 600 px, JPEG 80 %) puis envoyée pendant que le vendeur tape ;
« Publier » crée un brouillon côté serveur, y rattache les photos, puis le publie : un produit n'est
jamais en ligne sans photo. La catégorie est placée avant le prix pour que « Vous recevrez » s'affiche
juste sous le prix saisi. Vendeur vérifié : en ligne
immédiatement. Non vérifié : « En vérification, en ligne sous 2 h » (modération).
V2 : titre, catégorie et description proposés automatiquement à partir de la photo.

### Commandes et argent

- **À traiter** en tête, avec compte à rebours (« Acceptez avant 10:02 demain, sinon la commande est
  annulée »). Deux boutons : Accepter / Refuser (motif).
- **Mon argent** : À recevoir · En séquestre (« arrive après livraison ») · Versements (historique) —
  directement issu de `GET /v1/seller/balance`. « En séquestre » est la part du vendeur (articles −
  commission), pas le total payé par l'acheteur.
- Le vendeur ne voit **ni le téléphone ni le repère de l'acheteur** : le livreur s'en charge. Cela évite
  les ventes conclues hors de la plateforme, donc hors séquestre (et limite les données personnelles
  partagées, loi 29-2019).

## 3. Parcours livreur

Réalisé dans `apps/mobile/app/livreur`. Le téléphone du client est affiché en clair au livreur
partenaire (sous contrat) en attendant un numéro masqué (V2).

Liste de missions (boutique, quartier d'enlèvement, destination avec repère, téléphone masqué) →
« J'ai récupéré le colis » → à destination, **pavé numérique géant** pour saisir le code de remise
donné par l'acheteur → « Remis ✔ ». En cas d'échec : « Livraison impossible » + motif.
Après 5 codes erronés : verrouillage et appel au support (anti-fraude).

## 4. Back-office (support et administration)

Réalisé dans `apps/backoffice` ([captures](captures/back-office.jpg)). Connexion par code SMS puis
code de l'application d'authentification (QR code à la première connexion).

Files de travail triées par urgence, chacune avec son délai cible :
**Litiges** (SLA 72 h) · **Vérifications vendeurs** · **Modération produits** · **Livraisons à
assigner** · **Alertes** (reversements/remboursements en échec, paiements tardifs). Recherche universelle
par référence de commande (`ZD-…`) ou numéro de téléphone. Écran « Contrôle comptable » : balance
générale (doit afficher 0) et soldes des comptes.

Réservés aux administrateurs ([captures](captures/rapports.jpg)) : **Rapports** — volume d'affaires,
panier moyen, commissions acquises et à venir, ventes par jour, par catégorie et par boutique, argent
des vendeurs, export CSV du mois pour le comptable ; **Commissions** — taux par défaut, par catégorie
et par boutique (offres temporaires comprises), avec date d'effet et motif journalisé ;
**Rapprochement** ([captures](captures/rapprochement.jpg)) — jours de suite sans écart (objectif 7),
écarts à traiter avec la commande concernée, contrôle de la journée en cours ; pour chaque journée,
l'état de rapprochement (du grand livre au solde de l'agrégateur, écart inexpliqué en vert ou en
rouge) et chaque écart avec ce qu'il faut faire, l'écriture proposée et l'explication obligatoire.

## 5. Textes de référence

### Statuts de commande

| Statut technique      | Acheteur voit                                   | Vendeur voit                        |
| --------------------- | ----------------------------------------------- | ----------------------------------- |
| `pending_payment`     | En attente de paiement                          | —                                   |
| `paid`                | Payée — en attente du vendeur                   | **Nouvelle commande à accepter**    |
| `preparing`           | Le vendeur prépare votre commande               | À préparer                          |
| `ready_for_pickup`    | Prête, bientôt en route                         | En attente du livreur               |
| `in_delivery`         | En route                                        | En livraison                        |
| `awaiting_collection` | Vous attend au point relais                     | Au point relais                     |
| `delivered`           | Remise — tout est conforme ?                    | Livrée — paiement sous 48 h         |
| `completed`           | Terminée                                        | Payée ✔                             |
| `disputed`            | Problème signalé — le support examine           | Litige en cours — paiement suspendu |
| `refunded`            | Remboursée                                      | Remboursée à l'acheteur             |
| `cancelled`           | Annulée (+ « remboursement en cours » si payée) | Annulée                             |

### Échecs de paiement (renvoyés par l'API dans `failure.message`)

| Code                 | Message                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `insufficient_funds` | Solde Mobile Money insuffisant. Rechargez votre compte ou payez avec un autre numéro ou opérateur. |
| `declined`           | Paiement refusé sur le téléphone. Vous pouvez réessayer.                                           |
| `invalid_account`    | Ce numéro n'a pas de compte Mobile Money actif chez cet opérateur.                                 |
| `limit_exceeded`     | Plafond de transaction dépassé chez votre opérateur. Essayez un autre compte.                      |
| `expired`            | La demande a expiré sans validation du code PIN. Vous pouvez réessayer.                            |

### Notifications

Modèles dans `apps/api/src/modules/notifications/templates.ts` (paiement reçu, nouveau code de remise,
commande en route, remise, litige, remboursement, reversement…). Les modèles WhatsApp doivent être
soumis à Meta pour approbation avant le lancement (prévoir 1 à 2 semaines).
