# Nouvelle direction visuelle — analyse et plan de passage

**Source** : quatre maquettes « directions UI » reçues le 19 octobre 2026 (acheteur 15 écrans,
vendeur 19, livreur 17, back-office 11). Elles remplacent la charte de
[01-principes-experience.md §3](01-principes-experience.md) (orange sur fond clair). Ce document
dit ce qui change, ce qui demande des décisions, et dans quel ordre on l'applique.

## 1. Fondations relevées sur les maquettes

Les PDF sont des images : les couleurs ci-dessous sont mesurées sur les pixels, les polices sont à
confirmer avec la designer (fichier Figma ou noms des polices).

| Rôle                                              | Valeur                            | Usage dans les maquettes                                                 |
| ------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| Fond                                              | `#0B0E15`                         | tout l'écran, thème sombre unique                                        |
| Fond des barres (bas d'écran, barre d'onglets)    | `#10141D`                         | zone du bouton principal, onglets                                        |
| Surface (cartes)                                  | `#161A25`                         | cartes, champs, puces                                                    |
| Surface relevée / bordure                         | `#1C2230` / `#232832`             | vignettes produit, contours                                              |
| Texte / secondaire / discret                      | `#ECEEF1` / `#9B9FA7` / `#585D65` |                                                                          |
| **Citron** (marque, action principale, confiance) | `#C6F432`                         | boutons, « Vérifié », Garantie Zandu, montants disponibles, onglet actif |
| Cyan (argent bloqué, en route)                    | `#3BDFFD`                         | « Bloqué », « En livraison », points d'information                       |
| Corail (urgent, problème)                         | `#F77858`                         | « À accepter », ventes flash, « Un problème », suspension                |
| Violet (secondaire des graphiques)                | `#8B7BFF`                         | commissions, Airtel Money, rôle Finance                                  |

- **Titres** : linéale très large et grasse (type _Unbounded_ ou _Archivo Expanded_) ; **texte** :
  linéale géométrique (type _DM Sans_). Montants en chiffres larges, « FCFA » en petit.
- Rayons : cartes ≈ 16 px, champs ≈ 12 px, boutons et puces en pilule. Bouton principal citron,
  pleine largeur, posé en bas d'écran (règle du pouce conservée).
- Icônes au trait fin (type Lucide) à la place des émojis actuels.
- Halo citron flou derrière les en-têtes de réussite et les écrans d'accueil.

## 2. Ce qui ne change pas (et que les maquettes respectent)

Paiement bloqué jusqu'à la livraison (« Où est votre argent ? »), code de remise par SMS, connexion
sans mot de passe pour acheteurs/vendeurs/livreurs, MTN MoMo / Airtel Money avec détection du
réseau par le numéro, commandes multi-vendeurs livrées séparément, repère pour le livreur, litige
avec photo et réponse sous 48 h, back-office journalisé.

## 3. Écart avec l'existant, parcours par parcours

Légende : 🎨 restylage seul · 🧩 petite fonction nouvelle (API + écran, sans décision) ·
⚠️ demande une décision du fondateur ou une technologie nouvelle (§4).

### Acheteur (15 écrans)

| Écran                     | Existe ? | Écart                                                                                                                               |
| ------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Accueil                   | oui      | 🎨 · 🧩 choix de la ville · ⚠️ bannières et **ventes flash** (prix barré, compte à rebours, stock restant) · ⚠️ recherche par photo |
| Recherche                 | oui      | 🎨 · 🧩 filtres « Livrable à … », « Vendeur vérifié »                                                                               |
| Fiche produit             | oui      | 🎨 · 🧩 favoris, partage · ⚠️ **variantes** (couleur)                                                                               |
| Panier                    | oui      | 🎨 (déjà groupé par vendeur)                                                                                                        |
| Connexion (code)          | oui      | 🎨 6 cases séparées, compte à rebours de renvoi                                                                                     |
| Livraison                 | oui      | 🎨 · 🧩 puces de repère (« + École »…), adresse enregistrée                                                                         |
| Paiement / attente / reçu | oui      | 🎨 anneau de 10 min, « Où est votre argent ? » en trois étapes                                                                      |
| Suivi de commande         | oui      | 🎨 frise · ⚠️ « Voir le livreur sur la carte »                                                                                      |
| Livreur en route          | non      | ⚠️ **carte et position du livreur en direct**, appel et message au livreur                                                          |
| Colis remis + avis        | oui      | 🎨 · 🧩 étiquettes d'avis (« Conforme à l'annonce », « Livreur ponctuel »), note du livreur                                         |
| Mes commandes             | oui      | 🎨 · 🧩 « En cours / Terminées », « Racheter »                                                                                      |
| Notifications             | non      | 🧩 centre de notifications (la table `notifications` existe) · ⚠️ onglet « Offres » (marketing)                                     |
| Signaler un problème      | oui      | 🎨                                                                                                                                  |

### Vendeur (19 écrans)

| Écran                                      | Existe ?  | Écart                                                                                                                  |
| ------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| Accueil vendeur + ouverture en 3 étapes    | en partie | 🎨 · 🧩 logo, catégories vendues, lieu de retrait, horaires, nom du titulaire Mobile Money, acceptation des conditions |
| Boutique vérifiée + premiers pas           | non       | 🧩                                                                                                                     |
| Tableau de bord                            | oui       | 🎨 · 🧩 ventes du jour, note, alerte de stock bas · ⚠️ bouton **« Retirer »**                                          |
| Nouveau produit                            | oui       | 🎨 · 🧩 **état** (neuf / reconditionné / occasion), brouillon, seuil d'alerte de stock · ⚠️ prix barré                 |
| Mes produits                               | oui       | 🎨 · 🧩 interrupteur « en ligne / masqué », filtres, recherche                                                         |
| Commandes + accepter                       | oui       | 🎨 · 🧩 « Prêt dans 15 min / 30 min / 1 h / 2 h » · ⚠️ **délai d'acceptation** (10 min à l'écran, 24 h aujourd'hui)    |
| Préparer (liste « avant de fermer »)       | non       | 🧩 liste de contrôle côté téléphone                                                                                    |
| Remise au livreur avec **code de retrait** | non       | ⚠️ nouveau code à 4 chiffres livreur → vendeur                                                                         |
| Livrée (commission affichée)               | en partie | 🎨                                                                                                                     |
| Retour (cliente absente, code de retour)   | non       | ⚠️ nouveau parcours « retour au vendeur »                                                                              |
| Litige (réponse du vendeur)                | non       | 🧩 échanger / reprendre et rembourser / contester avec preuves                                                         |
| Avis clients + réponse                     | non       | 🧩                                                                                                                     |
| Mon argent + Retirer                       | en partie | 🎨 · ⚠️ **retrait à la demande** (aujourd'hui : reversement automatique)                                               |
| Ma boutique                                | non       | 🧩 boutique ouverte/fermée (congés), préparation par défaut, horaires, villes livrées                                  |

### Livreur (17 écrans)

Aujourd'hui, l'application livreur se limite aux missions assignées par le support, à la collecte
et au code de remise (décision D15 : les livreurs viennent d'un partenaire). Les maquettes
décrivent un **modèle différent** : inscription libre avec dossier (pièce, permis, carte grise,
photo de la moto), activation par Zandu, bouton **« En ligne »**, **courses proposées** à accepter en
25 secondes, navigation sur carte, code de retrait chez le vendeur, attente chronométrée et cliente
absente, retour au vendeur, incident, **gains par course** retirés vers Mobile Money, historique et
ponctualité. 🎨 pour les écrans existants ; ⚠️ pour tout le reste (§4.1).

### Back-office (11 écrans, ordinateur)

| Écran          | Existe ?  | Écart                                                                                              |
| -------------- | --------- | -------------------------------------------------------------------------------------------------- |
| Connexion      | oui       | ⚠️ e-mail + mot de passe + code SMS à l'écran ; aujourd'hui téléphone + SMS + application TOTP     |
| Vue d'ensemble | en partie | 🎨 · 🧩 « À traiter », graphique 14 jours (les rapports existent)                                  |
| Commandes      | oui       | 🎨 tableau + volet de détail · 🧩 réassigner, annuler et rembourser                                |
| Litiges        | oui       | 🎨 · 🧩 « Relancer le vendeur », « Organiser un retour »                                           |
| Vendeurs       | oui       | 🎨 · 🧩 cases de contrôle (nom = compte MoMo), « Demander un document »                            |
| Livreurs       | en partie | ⚠️ dépend du modèle livreur                                                                        |
| Clients        | non       | 🧩 liste, fiche, envoyer un SMS, bloquer le compte                                                 |
| Catalogue      | oui       | 🎨 · 🧩 alertes calculées (« prix très bas pour la catégorie », « photo unique »)                  |
| Paiements      | en partie | 🎨 · 🧩 encaissements par opérateur, mouvements · ⚠️ « retrait à contrôler » (dépend des retraits) |
| Promotions     | non       | ⚠️ bannières et ventes flash                                                                       |
| Paramètres     | en partie | 🧩 réglages modifiables à l'écran (aujourd'hui variables d'environnement) · ⚠️ rôle **Finance**    |

La page **Rapprochement** (contrôle de caisse quotidien) et **Personnel** existent mais ne figurent
pas dans les maquettes : on les garde, restylées, dans le menu (Paiements → Rapprochement,
Paramètres → Équipe et accès).

## 4. Retours techniques et décisions

### 4.1 Modèle livreur (le plus gros changement)

Les maquettes supposent des livreurs indépendants, inscrits dans l'application et payés à la
course par Zandu. Cela demande : dossier et activation des livreurs, **attribution automatique**
(proposer la course au livreur en ligne le plus proche, relancer au suivant après 25 s), **position
GPS** des livreurs, gains par course dans le grand livre (compte « livreurs à payer ») et leurs
retraits. C'est une décision de modèle économique (D15) avant d'être une décision technique :
payer chaque livreur, c'est aussi des obligations (contrats, assurance).

**Recommandation** : au lancement, garder l'attribution par le support et les livreurs du
partenaire, avec les **écrans restylés** des maquettes (mission, code de retrait, remise, cliente
absente, retour) ; ajouter « En ligne » et les courses proposées en V2, quand le volume le justifie.

### 4.2 Cartes et suivi en direct

« Voir le livreur sur la carte », la navigation du livreur et le temps d'arrivée demandent :

- une **bibliothèque de cartes** : MapLibre (libre) avec des tuiles OpenStreetMap hébergées ou
  payantes (MapTiler, Stadia ; ≈ 0 à 50 €/mois au début), plutôt que Google Maps (plus cher, compte
  de facturation). Ajout à l'application : `@maplibre/maplibre-react-native` (module natif, la
  construction de l'APK le prend en charge) ;
- la **position du livreur** envoyée toutes les 10 à 20 s pendant une course (`expo-location`,
  autorisation de localisation en arrière-plan, consommation de batterie et de données à mesurer
  en 3G) et relayée à l'acheteur (interrogation régulière au début, WebSocket plus tard) ;
- des cartes de Pointe-Noire et Brazzaville suffisamment détaillées : à vérifier sur
  OpenStreetMap, quartier par quartier ; le **repère écrit** (« derrière l'école Saint-Pierre »)
  reste la référence.

**Recommandation** : pas de carte au lancement ; afficher l'étape et l'heure prévue (déjà possible)
et le bouton d'appel. Carte en V2 avec le modèle livreur.

### 4.3 Retrait à la demande de l'argent du vendeur

Aujourd'hui l'argent disponible est reversé automatiquement (avec un plafond pour les nouveaux
vendeurs). Le bouton « Retirer » demande une route de retrait avec **code SMS de confirmation**, un
seuil de contrôle par le back-office (« Retrait à contrôler ») et les frais éventuels de
l'agrégateur (D1). Le grand livre, l'idempotence et le rapprochement savent déjà faire : c'est un
sprint, sans technologie nouvelle. **Décision** : retrait à la demande seul, ou automatique +
à la demande ?

### 4.4 Délai d'acceptation du vendeur

Les maquettes montrent 10 minutes (compte à rebours « Acceptez avant 14:40 », réglage du
back-office). Aujourd'hui : 24 h. 10 minutes impose au vendeur d'être joignable en permanence (les
notifications que l'on vient d'ajouter aident) ; une commande non acceptée est annulée et
remboursée. **Recommandation** : rendre le délai réglable (Paramètres), démarrer à 2 h pendant les
heures d'ouverture de la boutique, et descendre si les vendeurs suivent.

### 4.5 Connexion au back-office

Les maquettes montrent e-mail + mot de passe + code SMS. Aujourd'hui : numéro + code SMS + code
d'une application d'authentification (TOTP), plus sûr : le code SMS est vulnérable au vol de carte
SIM, courant dans la région. **Recommandation** : garder le dispositif actuel avec l'apparence de
la maquette (même mise en page, champs adaptés). Si l'e-mail est souhaité, e-mail + mot de passe +
TOTP, pas SMS.

### 4.6 Promotions, ventes flash, variantes, prix barré

Nouveaux objets en base (bannières programmées, ventes flash avec prix, quantité, période et accord
du vendeur, variantes de produit avec leur stock) et règles de prix au moment de la commande (le
prix flash doit être celui payé, jamais un prix affiché seulement). Pas de technologie nouvelle.
**Recommandation** : après le lancement ; les variantes d'abord (demandées par les vendeurs de
téléphones), les ventes flash ensuite.

### 4.7 Recherche par photo

L'icône d'appareil photo dans la recherche suppose une reconnaissance d'image (service payant ou
modèle à héberger). **Recommandation** : retirer l'icône pour l'instant.

### 4.8 Thème sombre et polices

- Thème sombre unique : il économise la batterie sur les écrans OLED, mais la plupart des
  téléphones d'entrée de gamme ont un écran LCD, et la lisibilité **en plein soleil** est moins
  bonne. À vérifier sur 2-3 téléphones réels dès la recette ; les contrastes mesurés (texte
  `#ECEEF1` sur `#0B0E15`, citron sur fond sombre) sont largement au-dessus du niveau AA.
- Deux polices ajoutent du poids : ≈ 150 Ko dans l'APK (sans importance) ; sur le **site web**,
  2 fichiers WOFF2 réduits aux caractères latins et à 2 graisses, ≈ 60 Ko, chargés sans bloquer
  l'affichage, pour rester dans le budget 3G (ADR-0012). Les PDF ne contiennent pas les polices :
  il faut leurs noms (ou le fichier Figma) et vérifier leur licence (Google Fonts : libre).
- Icônes : `lucide-react-native` + `react-native-svg` dans l'application, `lucide-react` (icônes
  importées une à une) sur le site et le back-office.
- Aucune autre technologie ne change : Expo, Next.js, l'API et la base restent les mêmes. Les
  couleurs sont déjà centralisées (`apps/mobile/src/theme.ts`, variables CSS du site et du
  back-office) : le passage se fait par petites étapes, écran par écran, sans casser les parcours
  automatisés.

## 5. Plan de passage

| Étape | Contenu                                                                                                                                                                                                                   | Décision nécessaire |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1     | **Fondations** : couleurs, polices, rayons, icônes dans un paquet partagé `packages/design` ; composants de base (bouton, champ, carte, puce, badge, frise, code à 6 cases) dans l'application, le site et le back-office | noms des polices    |
| 2     | **Acheteur** restylé écran par écran (application + site), avec les 🧩 : ville, filtres, favoris, puces de repère, adresse enregistrée, étiquettes d'avis, « Racheter », centre de notifications                          | —                   |
| 3     | **Vendeur** : ouverture en 3 étapes, tableau de bord, produits (état, interrupteur), commandes (prêt dans…, liste de contrôle), litige côté vendeur, avis et réponses, Ma boutique                                        | §4.4                |
| 4     | **Back-office** : menu latéral sombre, vue d'ensemble, commandes avec volet, clients, paiements, catalogue en cartes, paramètres modifiables                                                                              | §4.5                |
| 5     | **Livreur** : écrans restylés du modèle actuel (mission, code de retrait, remise, cliente absente, retour, incident)                                                                                                      | §4.1                |
| 6     | Retrait à la demande · délai d'acceptation réglable                                                                                                                                                                       | §4.3, §4.4          |
| V2    | Livreurs indépendants et courses proposées · carte et suivi en direct · ventes flash, bannières, variantes · rôle Finance                                                                                                 | §4.1, §4.2, §4.6    |

Chaque étape garde les parcours de bout en bout verts et ajoute des captures comparées aux
maquettes.
