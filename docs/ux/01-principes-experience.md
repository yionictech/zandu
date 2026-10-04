# Expérience utilisateur — principes

> Objectif : **découvrir comme sur TikTok, acheter comme sur Amazon, payer aussi simplement qu'un
> transfert Mobile Money** — sur un Android d'entrée de gamme, en 3G, avec des données qui coûtent cher.

## 1. Ce qu'on prend aux leaders, et comment on l'adapte

### Amazon — la confiance par la promesse tenue

| Ce qu'Amazon fait                                      | Version Zandu                                                                                         | Quand |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ----- |
| La **fiche produit** est l'écran le plus travaillé     | Une fiche sobre : photos plein écran, prix, promesse de livraison, garantie, vendeur, avis, un bouton | MVP   |
| **Promesse de livraison** explicite (« livré demain ») | « Livré à Tié-Tié **demain** si vous commandez avant 14 h » — calculée depuis zone + délai vendeur    | MVP   |
| **Garantie A à Z**                                     | « **Garantie Zandu** : remboursé si non reçu ou non conforme » sur la fiche, le panier, le paiement   | MVP   |
| **Achat en 1 clic**                                    | « Acheter maintenant » : adresse et numéro MoMo mémorisés → 2 écrans + le code PIN                    | MVP   |
| **Avis « achat vérifié »** uniquement                  | Seuls les acheteurs livrés notent (1 avis par article reçu, garanti en base)                          | MVP   |
| Suivi de commande en **frise**                         | Frise : Payée → Acceptée → En route → Remise, avec heure de chaque étape                              | MVP   |

### Alibaba / Taobao / AliExpress — le séquestre et la conversation

| Ce qu'ils font                                                                  | Version Zandu                                                                                                          | Quand    |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------- |
| **Alipay est né en 2004 comme séquestre** pour rassurer les acheteurs de Taobao | Notre séquestre est la même idée : le raconter partout (« votre argent est bloqué jusqu'à la livraison »)              | MVP      |
| **Discussion avant l'achat** (Wangwang) : on demande, on négocie                | Bouton « Discuter » sur la fiche, réponses rapides (« Disponible ? », « Livrez-vous à Loandjili ? ») ; numéros masqués | MVP (P2) |
| **Badges vendeurs** (fournisseur vérifié, réactivité)                           | « Vérifié », « Répond en moins d'1 h », « Expédie en 24 h », note moyenne                                              | MVP      |
| Un paiement, **une commande par boutique** (AliExpress)                         | Panier multi-vendeurs, une validation PIN, un suivi par vendeur (ADR-0011)                                             | MVP      |
| Ventes flash, coupons, fêtes commerciales (11.11)                               | Événements locaux : rentrée scolaire, fêtes de fin d'année, « Black Friday » local                                     | V2       |

### TikTok / TikTok Shop / Shopee — la découverte qui accroche

| Ce qu'ils font                                             | Version Zandu (en respectant le coût des données)                                                          | Quand           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------- |
| **Fil « Pour toi »** plein écran, défilement infini        | Fil de produits en grandes cartes ; personnalisation simple (catégories vues, ville, prix) puis apprise    | MVP simple → V2 |
| **Vidéo courte** avec bouton d'achat                       | Vidéos vendeurs ≤ 15 s en 360-480p, **lecture seulement en Wi-Fi ou sur appui** (mode économie de données) | V2              |
| **Live shopping**                                          | « Zandu Live » : les vendeurs font déjà des lives Facebook ; ici l'achat est protégé par le séquestre      | V2              |
| **Affiliés / créateurs** qui touchent une commission       | « Ambassadeurs Zandu » : tout le monde partage un lien et gagne un pourcentage (programme de parrainage)   | V2              |
| **Gamification** (Shopee : pièces, jeux, compte à rebours) | Ventes flash avec compte à rebours, points fidélité (business plan étape 3)                                | V2              |

### Meesho, Jumia, Flipkart Lite, Wave — l'Afrique et les marchés émergents

| Référence                         | Leçon                                                                    | Version Zandu                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Meesho** (Inde)                 | Le commerce passe par **WhatsApp** : partager doit être instantané       | Bouton « Partager sur WhatsApp » partout ; le lien affiche photo + prix + « Paiement protégé »       |
| **Jumia**                         | Le client africain veut payer **à la livraison** ; points de retrait     | Le séquestre rend le prépaiement acceptable ; **points relais** ; paiement MoMo à la porte en plan B |
| **Flipkart Lite, AliExpress PWA** | Une version légère convertit mieux sur réseau lent                       | Site en rendu serveur + PWA, budget de poids par écran, mode économie de données                     |
| **Wave** (Sénégal, Côte d'Ivoire) | Le Mobile Money gagne par **la simplicité et la transparence des frais** | Écran de paiement à la Wave : un montant énorme, les frais visibles, une confirmation immédiate      |

## 2. Dix principes Zandu

1. **La confiance se voit à chaque écran.** Garantie Zandu, badge vérifié, avis vérifiés, code de remise.
   Un acheteur qui a peur de l'arnaque ne lit pas : il cherche ces signes.
2. **2 minutes pour acheter, 5 minutes pour vendre.** Ce sont les objectifs du cahier ; on les mesure
   (événements analytiques) et chaque écran ajouté doit se justifier.
3. **Conçu pour un 360 × 640, 1 Go de RAM, en 3G.** On teste d'abord sur ce téléphone-là, au soleil, à une main.
4. **Le Mobile Money n'est pas un moyen de paiement parmi d'autres : c'est LE paiement.**
   Opérateur deviné depuis le numéro (et toujours modifiable : la portabilité arrive), numéro pré-rempli.
5. **WhatsApp est notre canal.** Partage, notifications de suivi, support. Les codes (connexion, remise)
   partent en SMS : ils doivent arriver même sans données mobiles.
6. **Parler comme le client.** Français simple, lingala et kituba ensuite ; « 25 000 FCFA » ; des repères
   (« derrière l'école Saint-Pierre ») plutôt qu'une adresse postale qui n'existe pas.
7. **Chaque erreur dit quoi faire ensuite.** Jamais « Erreur 500 » ; toujours une action (réessayer,
   changer d'opérateur, contacter le support) — les messages sont déjà définis côté API.
8. **Rien ne se perd.** Brouillon de produit sans réseau, panier conservé, commandes lisibles hors ligne,
   requêtes rejouables sans doublon.
9. **Économe en données, sans le dire.** Images à la bonne taille, vidéos sur demande, préchargements
   coupés en 3G. L'utilisateur ne doit pas avoir peur d'ouvrir l'application.
10. **Accessible et inclusif.** Contrastes forts (lecture au soleil), cibles tactiles ≥ 48 dp, icônes
    toujours accompagnées d'un mot, textes courts pour les lecteurs peu à l'aise.

## 3. Fondations visuelles (pour le designer)

| Élément     | Règle                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Couleurs    | Une couleur de marque + un **vert « confiance »** réservé à la garantie/au séquestre + ambre (attente) + rouge (problème). Contraste AA minimum. |
| Typographie | Police système (Roboto sur Android) : zéro octet à télécharger. Montants en gras, grande taille.                                                 |
| Grille      | Espacements multiples de 8 dp ; 2 colonnes de cartes produit sur 360 dp.                                                                         |
| Composants  | Bouton principal unique par écran, pleine largeur, en bas (zone du pouce).                                                                       |
| Images      | Carré 1:1 pour les vignettes ; fond clair conseillé au vendeur (guide photo intégré).                                                            |
| Mouvement   | Animations courtes (≤ 200 ms) et désactivées sur les appareils lents.                                                                            |
| Mode sombre | V2 (utile sur écrans OLED, rares en entrée de gamme).                                                                                            |

## 4. Mesurer pour décider

Événements à instrumenter dès la première version (outil analytique respectueux de la vie privée) :

`app_open` · `search` (requête, nb résultats) · `product_view` · `chat_started` · `add_to_cart` ·
`checkout_started` · `payment_initiated` (opérateur) · `payment_result` (succès / motif d'échec) ·
`order_delivered` · `dispute_opened` (motif) · `share_whatsapp` · `seller_product_published`
(durée depuis l'ouverture du formulaire) · `seller_order_accepted` (délai).

Entonnoirs suivis chaque semaine : **découverte → fiche → panier → paiement → livré**, et
**inscription vendeur → 1er produit → 1re vente → 1er reversement**.
