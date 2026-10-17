# ADR-0013 — Mise en ligne : une image par service, une recette sur un seul serveur

**Statut** : acceptée · **Date** : octobre 2026

## Contexte

Tester sur de vrais téléphones et partager de vrais liens WhatsApp exige une recette en ligne. Trois
choses manquent encore : l'hébergeur et sa région (D12), l'agrégateur (D1) et le fournisseur
SMS/WhatsApp. Il faut pouvoir mettre en ligne dès qu'un serveur existe, sans rien réécrire pour la
production. Par ailleurs, MinIO, prévu comme stockage S3 local, n'est plus publié en image Docker.

## Décision

1. **Un `Dockerfile`, trois cibles** : `api` (sert aussi le worker, les migrations et les outils),
   `web` et `backoffice` (Next.js en mode `standalone`). **La même image** sert la recette et la
   production : toute la configuration arrive par l'environnement, au démarrage (y compris l'adresse
   publique du site, lue à l'exécution et non à la compilation). Processus sans privilèges (`node`).
2. **`ZANDU_ENV=recette`** : les règles de la production s'appliquent (stockage S3, origines CORS
   explicites, second facteur du personnel, journaux `info`), avec deux exceptions encadrées :
   - l'**agrégateur simulé** (le bouton « Simuler la validation du PIN » reste disponible ; sa route
     reste ouverte, car elle ne fait bouger que de l'argent fictif et exige l'identifiant aléatoire
     du paiement, connu du seul acheteur) ;
   - les **SMS restent dans une boîte de réception** : lisible seulement avec la clé `RECETTE_KEY`,
     numéro par numéro, via la page `/recette/sms` du site, protégée par mot de passe.
     La recette refuse de démarrer sans clé, sans secret de webhook propre, sans S3 ni CORS. La
     production refuse le simulateur et n'enregistre aucune route `/dev`. `NODE_ENV=production` ne peut
     pas être déclaré « développement » par erreur. Le site et le back-office de recette affichent un
     bandeau « site de test » ; le site n'est pas indexé par les moteurs de recherche.
3. **Recette sur un seul serveur avec Docker Compose** (`deploy/recette/`) : PostgreSQL, stockage S3,
   tâche de mise en route, API, worker, site, back-office, et **Caddy** devant (certificats
   Let's Encrypt obtenus et renouvelés seuls, HSTS, filtrage facultatif du back-office par adresse IP).
   Seuls les ports 80 et 443 sont ouverts.
4. **Avant chaque démarrage**, une tâche unique applique les migrations, charge les données de
   référence et **vérifie le stockage** : le compartiment public se lit sans signature, le
   compartiment privé (pièces d'identité) **ne se lit pas** sans signature. Sinon l'API ne démarre pas.
5. **Stockage** : SeaweedFS en recette (testé avec notre code : envoi signé avec limite de taille et de
   type, lecture publique, lecture privée par URL signée). En production : le stockage objet de
   l'hébergeur, avec les mêmes variables `S3_*`. Les URL signées visent l'adresse publique
   (`S3_PUBLIC_ENDPOINT`) ; l'API parle au stockage par le réseau interne.
6. **APK de recette** construit par GitHub Actions (lancement manuel, `apk-recette.yml`), relié à
   l'API de recette, sans compte Expo.
7. **Vérifications** : `deploy/recette/verifier.mjs` contrôle une recette en ligne (HTTPS, services,
   aperçu WhatsApp, non-indexation, stockage fermé, SMS fermés sans clé) ;
   `deploy/recette/essai-local.sh` monte toute la pile sur un poste ou en CI et lance ces contrôles.

## Conséquences

- ➕ Recette en ligne en une heure environ dès qu'un serveur et un nom de domaine existent ; la même
  image passe ensuite en production.
- ➕ La CI construit les images et démarre toute la pile à chaque pull request : un Dockerfile cassé
  ou une recette qui ne démarre plus se voit avant la fusion.
- ➖ Un seul serveur : pas de haute disponibilité. Acceptable pour une recette, pas pour la production
  (architecture §7.2 : base managée avec PITR, deux instances d'API).
- ➖ Les codes de connexion de recette vivent en mémoire de l'API : **une seule instance d'API** en
  recette (les notifications du worker, elles, sont en base).
- ➖ L'APK de recette est signé avec la clé de débogage du modèle Expo : il s'installe en dehors du
  Play Store, chez les testeurs seulement. La publication sur le Play Store demandera une clé dédiée.

## Options écartées

- **PaaS de conteneurs dès la recette** : dépend du choix D12 ; les mêmes images s'y déploieront.
- **Kubernetes** : disproportionné pour deux développeurs et un serveur.
- **MinIO** : plus d'image Docker publiée. **Garage** : configuration plus lourde (topologie, clés),
  pas de lecture anonyme par l'API S3.
- **Codes SMS affichés dans l'application en recette** : écart de comportement avec la production et
  risque de fuite si la configuration est mal reportée ; la boîte de réception protégée garde le
  parcours réel (le code vient « d'ailleurs »).
