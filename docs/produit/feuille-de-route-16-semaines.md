# Feuille de route du MVP — 16 semaines

Base : cahier des charges §8 (4 phases, 3 jalons) et business plan §13. Sprints de 2 semaines.
Ce dépôt a **pris de l'avance sur le cœur risqué** (paiement, séquestre, grand livre) : le planning
ci-dessous en tient compte et réaffecte le temps gagné aux applications et à l'intégration réelle.

## Équipe et répartition

| Rôle                         | Périmètre principal                                                              |
| ---------------------------- | -------------------------------------------------------------------------------- |
| Fondateur (chef de projet)   | Agrégateur, juriste, recrutement des 200 vendeurs, recette                       |
| Développeur backend          | API restante, adaptateurs agrégateur et SMS/WhatsApp, rapprochement, back-office |
| Développeur mobile           | Application Android (Expo) puis site web Next.js (composants partagés)           |
| Designer (temps partiel)     | Maquettes S1-S4, guide photo vendeurs, modèles WhatsApp                          |
| Testeur (à partir du mois 5) | Plan de recette, 100 commandes de test par opérateur, tests sur téléphones réels |

## Planning

```mermaid
gantt
  dateFormat  YYYY-MM-DD
  axisFormat  S%W
  title MVP Zandu — 16 semaines (dates indicatives)
  section Cadrage
  Socle technique (FAIT)            :done,    s0, 2026-10-05, 1w
  Maquettes + design system         :active,  s1, 2026-10-05, 4w
  Sprint 1 : fichiers, KYC, app acheteur (FAIT) :done, s2, 2026-10-12, 1w
  Écrans vendeur et livreur (FAIT)  :done,    s2b, 2026-10-16, 2d
  Back-office + second facteur (FAIT) :done,  s2c, 2026-10-17, 1d
  Site web acheteurs (FAIT)         :done,    s2d, 2026-10-17, 1d
  Jalon maquettes validées          :milestone, m1, 2026-11-02, 0d
  section Catalogue
  Photos produits + fiches + recherche :      s3, 2026-11-02, 2w
  Panier, checkout, suivi, vendeur  :         s4, 2026-11-16, 2w
  Jalon commande de bout en bout    :milestone, m2, 2026-11-30, 0d
  section Paiement
  Contrat agrégateur signé (≤ S6)   :crit,    c1, 2026-10-05, 6w
  Adaptateur agrégateur + bac à sable :crit,  s5, 2026-11-30, 2w
  SMS/WhatsApp, livraison, back-office :      s6, 2026-12-14, 2w
  Jalon paiement test réussi        :milestone, m3, 2026-12-28, 0d
  section Recette
  Audit sécurité, charge, correctifs :        s7, 2026-12-28, 2w
  Bêta fermée 30-50 vendeurs        :         s8, 2027-01-11, 2w
```

## Détail par sprint

### Sprint 0 — Socle (✅ fait, ce dépôt)

Schéma de données complet ; règles métier pures ; API : OTP, catalogue/recherche, checkout
multi-vendeurs, paiement + séquestre (simulateur), livraison avec code de remise, litiges, reversements,
remboursements, back-office minimal, audit ; 102 tests ; CI.

### Sprint 1 — Fichiers, KYC, application acheteur (✅ fait, ce dépôt)

- Backend : stockage objet par URL signées (photos produits, pièces KYC privées, preuves de litige),
  espace vendeur (produits, photos, KYC, aperçu de commission), avis (F11), files du support, CORS.
- `packages/api-client` : client typé généré depuis le contrat ; test de contrat contre l'API réelle.
- Application Android (Expo) : accueil, recherche, fiche produit, panier multi-vendeurs, connexion
  SMS, livraison par repères, paiement Mobile Money avec attente du PIN, suivi, confirmation de
  réception, litige, avis. Parcours de bout en bout automatisé (captures dans `docs/ux/captures`).

### Sprint 1 bis — Écrans vendeur et livreur (✅ fait, ce dépôt)

- Mobile, vendeur : ouvrir sa boutique (un écran), tableau de bord « à traiter d'abord »,
  vérification d'identité (pièce + selfie), produit « photo d'abord » (compression sur le téléphone,
  envoi pendant la saisie, brouillon conservé, « Vous recevrez » en direct), commandes (accepter,
  refuser, colis prêt), mes produits (statuts, archives), mon argent (à recevoir, séquestre, versements).
- Mobile, livreur : missions, appel du vendeur et du client, pavé géant du code de remise, échec motivé.
- Backend : vue commande vendeur **sans le téléphone de l'acheteur**, brouillons de produit (jamais en
  ligne sans photo), fiche produit vendeur, missions livreur détaillées, part vendeur en séquestre.
- Parcours vendeur + livreur de bout en bout automatisé (captures dans `docs/ux/captures`).

### Sprint 1 ter — Back-office du support (✅ fait, ce dépôt)

- `apps/backoffice` (Next.js, rendu serveur, ADR-0012) : tableau de bord des files avec leurs
  objectifs de délai, vérification des boutiques (pièces privées), modération, assignation des
  livreurs, litiges (preuves, décision qui déclenche remboursement et reversement), recherche de
  commande par référence ou téléphone avec tout le circuit de l'argent, alertes, contrôle comptable.
- API : **second facteur TOTP obligatoire** pour le personnel (anti-rejeu, révocation après 5
  erreurs, réinitialisation par un administrateur), files et recherche du support, alertes.
- Parcours du support de bout en bout automatisé (captures dans `docs/ux/captures`).

### Sprint 1 quater — Site web acheteurs (✅ fait, ce dépôt)

- `apps/web` (Next.js, rendu serveur, ADR-0006) : accueil, recherche tolérante aux fautes, fiche
  produit avec **aperçu WhatsApp** (photo, titre, prix) et données structurées, vitrine de boutique à
  partager, panier, connexion SMS, livraison par repères, paiement Mobile Money avec attente du PIN,
  suivi, confirmation de réception, signalement d'un problème ; manifeste PWA, plan du site.
- API : vitrine publique d'une boutique (`GET /v1/shops/{slug}`), sans coordonnées du vendeur.
- Budget 3G mesuré à chaque exécution du parcours de bout en bout (fiche produit : 167 Ko).

### Sprint 1 quinquies — Paquet de mise en ligne (✅ fait, ce dépôt)

- `Dockerfile` : une image par service (API et worker, site web, back-office), la même pour la recette
  et la production (ADR-0013).
- `deploy/recette/` : recette complète sur un seul serveur (PostgreSQL, stockage S3 SeaweedFS, API,
  worker, site, back-office) derrière Caddy, HTTPS automatique ; vérification du stockage avant chaque
  démarrage ; script de vérification après mise en ligne ; sauvegarde quotidienne de la base.
- API : environnement `recette` (règles de la production, paiements simulés, SMS de test protégés par
  clé) ; site : page « SMS de test », bandeau « site de test », non indexé ; application : bouton
  « Lire le code de test ».
- APK de recette construit par GitHub Actions (`apk-recette.yml`), sans compte Expo.
- CI : construction des images et démarrage de toute la recette à chaque pull request.
- Guide pas à pas : [mettre la recette en ligne](../exploitation/mise-en-ligne-recette.md).

### Sprint 1 sexies — Photos légères (✅ fait, ce dépôt)

- Le worker décline chaque photo produit (ADR-0014) : vignette WebP 320 px, grande image WebP
  800 px, JPEG de partage 1200 px pour les aperçus WhatsApp ; orientation appliquée, métadonnées
  supprimées, faux fichiers image écartés. L'original s'affiche en attendant.
- Mesuré avec 12 vraies photos de téléphone, en 3G simulée : accueil **5,2 Mo → 358 Ko**, premières
  photos **54 s → 3,5 s** ; fiche produit **551 Ko → 236 Ko**.
- Tuiles du site enfin carrées quelle que soit la photo (défaut caché par les illustrations carrées
  de démonstration).
- CI : exécution à chaque envoi (le dépôt n'a pas de branche `main`) ; première exécution verte,
  recette en conteneurs comprise.

### Sprint 1 septies — Rapports et commissions (✅ fait, ce dépôt)

- Back-office, administrateurs seulement : **rapport du mois** (volume d'affaires, panier moyen,
  commissions acquises et à venir, ventes par jour, par catégorie, meilleures boutiques, argent des
  vendeurs) et **export CSV** des commandes pour le comptable (format des tableurs français,
  formules neutralisées, export journalisé).
- **Taux de commission modifiables** sans développeur (D8) : par défaut, par catégorie, par
  boutique ; date d'effet ; offres temporaires qui laissent reprendre le taux habituel ; motif
  obligatoire et journal d'audit. Les commandes passées gardent leur taux.
- Écritures comptables datées par l'horloge de l'application : chaque commission tombe dans le bon
  mois, et les rapports se testent sur plusieurs jours simulés.

### Prochaine étape — Recette en ligne, téléphones réels, agrégateur

- Fondateur : louer le serveur de recette et pointer quatre adresses DNS (D12, guide §1-2), puis
  **choix de l'agrégateur** (D1), rendez-vous juriste (D2), mode d'attribution des livraisons (D15).
- Développeur : mise en ligne (une heure avec le guide), APK aux testeurs.
- Testeur : parcours sur 2-3 téléphones Android d'entrée de gamme (photo, envoi en 3G), liens
  WhatsApp réels.
- Designer : reprendre les écrans existants de `apps/mobile` avec la charte définitive.
- Backend : adaptateur de l'agrégateur dès l'accès au bac à sable ; SMS/WhatsApp réels.

### Sprint 2 (S3-S4) — Comptes, KYC, boutique

- Mobile : ouverture de boutique, KYC progressif, profil.
- Backend : messagerie (F13 : endpoints + filtre déjà prêt), notifications push.
- **Jalon : maquettes validées.**

### Sprint 3 (S5-S6) — Catalogue

- Mobile : ajout produit « photo d'abord » avec compression, fil d'accueil, recherche, fiche produit.
- Backend : pipeline d'images (variantes WebP 200/400/800/1600), statistiques vendeur.
- Web : démarrage Next.js (fiche produit en rendu serveur + aperçu WhatsApp).
- **Contrat agrégateur signé avant la fin de S6** (condition d'accès au bac à sable).

### Sprint 4 (S7-S8) — Commande

- Mobile : panier, récapitulatif, écran d'attente de paiement (sur le simulateur), suivi, litige ;
  espace vendeur (commandes à traiter, mon argent) ; espace livreur.
- **Jalon : commande de bout en bout** dans l'application (simulateur).

### Sprint 5 (S9-S10) — Paiement réel

- Backend : adaptateur de l'agrégateur retenu (interface `PaymentProvider`), tests en bac à sable sur
  MTN et Airtel ; adaptateur SMS/WhatsApp ; modèles WhatsApp soumis à Meta.
- Web : catalogue, recherche, commande (PWA).

### Sprint 6 (S11-S12) — Livraison, back-office, rapprochement

- Back-office (kit d'admin) : litiges, KYC, modération, assignation des livreurs, alertes, commissions.
- Backend : rapprochement quotidien, tableau de bord des indicateurs, alertes de supervision.
- **Jalon : paiement test réussi** sur les deux opérateurs.

### Sprint 7 (S13-S14) — Recette technique

- Audit de sécurité externe ; test de charge (10× la cible) ; correctifs.
- 100 commandes de test payées par opérateur, dont tous les cas d'erreur du cahier §5.

### Sprint 8 (S15-S16) — Bêta fermée

- 30 à 50 vendeurs pilotes à Pointe-Noire ; suivi quotidien des indicateurs ; correctifs.
- Recette devant le fondateur : les 17 exigences P1.

## Critères de recette (cahier §8) et preuve associée

| Critère                                                           | Preuve                                                                              |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 100 commandes de test payées par opérateur, dont les cas d'erreur | Script de recette sur le bac à sable + tests automatisés `payment-failures.test.ts` |
| Aucun écart grand livre / relevé après 7 jours                    | Rapport de rapprochement quotidien (à construire S11-S12)                           |
| Aucune faille critique ou élevée                                  | Rapport d'audit externe                                                             |
| Parcours sur Android d'entrée de gamme en 3G                      | Test sur téléphone réel (≤ 1 Go RAM) avec limitation réseau                         |
| Les 17 exigences P1 démontrées                                    | Matrice de traçabilité (architecture §2.3) jouée devant le fondateur                |

## Ce qui vient après le MVP (V2, mois 9-18)

Fil « Pour toi » personnalisé · vidéos produits · Zandu Live · programme ambassadeurs · variantes et
promotions · suivi GPS · iOS · abonnements vendeurs premium · annonces sponsorisées · Brazzaville puis
CEMAC (même devise XAF) · paiement Mobile Money à la livraison (plan B).
