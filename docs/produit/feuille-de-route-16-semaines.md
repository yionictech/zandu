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

### Prochaine étape (S1-S2) — Maquettes, écrans vendeur et livreur

- Designer : parcours acheteur, vendeur, livreur ; design system (voir `docs/ux`).
- Designer : reprendre les écrans existants de `apps/mobile` avec la charte définitive.
- Mobile : écrans vendeur (ouvrir sa boutique, ajouter un produit « photo d'abord », commandes à
  traiter, mon argent, KYC) et livreur (missions, saisie du code de remise).
- Fondateur : **choix de l'agrégateur** (voir décisions), rendez-vous juriste.

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
