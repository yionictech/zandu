# 6. Exigences non fonctionnelles : performance, hors ligne, supervision

## 6.1 Réponse aux exigences du cahier §7

| Exigence                                                       | Réponse d'architecture                                                                                                          | Comment on le vérifie                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Catalogue < 3 s en 3G                                          | Web en rendu serveur (HTML utile dès le premier octet), vignettes WebP 320 px ≈ 18 Ko (ADR-0014), CDN, JS initial ≤ 170 Ko gzip | Lighthouse « Slow 4G / mobile bas de gamme » en CI   |
| API < 500 ms pour 95 % des requêtes                            | SQL indexé (index listés dans la migration), une transaction courte par requête, aucun appel externe tenant un verrou           | Mesure p95 par route (métriques) ; test de charge k6 |
| 5 000 utilisateurs/jour, 100 commandes/h, sans refonte         | ≈ 0,03 commande/s : une instance suffit ; 2 instances API + 1 worker pour la disponibilité                                      | Test de charge à 10× la cible avant lancement        |
| Disponibilité 99,5 %/mois (≈ 3 h 40 d'arrêt toléré)            | 2 instances API, base managée avec bascule, déploiements sans coupure, sauvegardes                                              | Sonde externe sur `/health` toutes les minutes       |
| Sauvegardes quotidiennes, restauration testée chaque trimestre | Sauvegarde continue (PITR, 7 à 30 jours) + export quotidien hors hébergeur                                                      | Exercice de restauration trimestriel chronométré     |
| Android 8+, entrée de gamme, < 30 Mo                           | React Native + Hermes, AAB avec découpage par architecture : cible **< 15 Mo** installée                                        | Taille mesurée en CI à chaque build                  |
| Connexion faible : photos compressées, hors ligne              | Compression côté téléphone avant envoi ; commandes et brouillons en cache local ; file d'envoi différé                          | Tests manuels en mode avion / 2G simulée             |
| Français, textes séparés du code (lingala, kituba)             | Catalogues de traduction (`fr`, `ln`, `mkw`), aucun texte en dur ; modèles de messages dans `templates.ts`                      | Revue de code + test de couverture des clés          |

## 6.2 Budgets de performance (contrat avec l'équipe front)

| Écran                       | Poids total max (3G) | Interactif en | Notes                                       |
| --------------------------- | -------------------- | ------------- | ------------------------------------------- |
| Accueil / catalogue (web)   | 400 Ko               | < 3 s         | 12 vignettes, le reste en défilement        |
| Fiche produit (web)         | 300 Ko               | < 2,5 s       | 1re photo 800 px, suivantes à la demande    |
| Démarrage de l'application  | —                    | < 2,5 s       | Sur un téléphone 1-2 Go de RAM (Android Go) |
| Écran d'attente du paiement | < 5 Ko par requête   | immédiat      | Interrogation légère toutes les 3 s         |

**Mesuré** (parcours `apps/web/e2e/parcours-web.mjs`, cache vide, 3G simulée à 750 kbit/s et 300 ms
d'aller-retour) : fiche produit **167 Ko** au total dont 142 Ko de JavaScript ; premier affichage
(titre, prix) **0,8 s**, photo **1,2 s**, page interactive **2,4 s**. Le script échoue si le poids
dépasse le budget. Le gros du poids est le socle Next.js/React : chaque composant client ajouté doit
rester petit.

**Mesuré avec de vraies photos de téléphone** (12 produits, photos compressées comme par l'application,
422 Ko en moyenne ; recette en conteneurs, même 3G simulée, ADR-0014) :

| Page          | Avant les déclinaisons                 | Avec les déclinaisons                       |
| ------------- | -------------------------------------- | ------------------------------------------- |
| Accueil       | 5 232 Ko ; 4 premières photos à 54,1 s | **358 Ko** ; 4 premières photos à **3,5 s** |
| Fiche produit | 551 Ko ; photo à 6,6 s                 | **236 Ko** ; photo à **3,2 s**              |

Les deux pages tiennent leur budget de poids. Les photos de démonstration du dépôt sont de petites
illustrations : elles ne suffisent pas à juger le poids réel d'une page.

**Mode économie de données** (activé par défaut sous 3G) : vignettes 200 px, pas de lecture
automatique de vidéo, préchargement désactivé.

## 6.3 Hors ligne et réseau instable

- **Lecture** : les commandes, le solde vendeur et les derniers produits consultés sont gardés en cache
  local (SQLite/MMKV côté application, service worker côté PWA) et affichés avec la date de mise à jour.
- **Écriture différée** : un brouillon de produit (photos + champs) se crée hors ligne et part
  automatiquement au retour du réseau.
- **Jamais hors ligne** : le paiement et la remise du colis (ils exigent la confirmation du serveur).
- **Requêtes rejouables** : grâce à `Idempotency-Key`, l'application peut renvoyer une requête restée
  sans réponse sans risque de doublon.

## 6.4 Supervision

**Journaux** : JSON structuré (pino), identifiant de requête, jamais de jeton, de code OTP ni de code de
remise (masquage configuré). **Erreurs** : Sentry (ou équivalent) sur API, worker, application, web.

**Alertes (vers le support et l'équipe technique)**

| Signal                                          | Seuil d'alerte          | Pourquoi                                       |
| ----------------------------------------------- | ----------------------- | ---------------------------------------------- |
| Taux de paiements réussis (sur 1 h glissante)   | < 90 % (objectif 95 %)  | Panne opérateur ou agrégateur                  |
| Webhooks rejetés pour signature                 | > 0                     | Tentative de fraude ou clé mal configurée      |
| Balance générale du grand livre                 | ≠ 0                     | Impossible en théorie : incident majeur        |
| Écart de rapprochement quotidien                | > 0                     | Argent non expliqué                            |
| Reversement ou remboursement en échec définitif | > 0                     | Un humain doit agir (déjà envoyé par l'outbox) |
| Paiements tardifs remboursés                    | > 5 / jour              | Délai de 10 min trop court ou opérateur lent   |
| Taux de litiges (hebdomadaire)                  | > 3 %                   | Objectif du business plan                      |
| File outbox non traitée                         | > 5 min de retard       | Worker arrêté                                  |
| Latence API p95                                 | > 500 ms pendant 10 min | Exigence du cahier                             |

**Tableau de bord métier** (indicateurs du business plan) : vendeurs actifs, acheteurs actifs,
commandes/jour, panier moyen, taux de paiement réussi, délai moyen de livraison, taux de litiges,
temps de publication d'un produit, temps de commande.
