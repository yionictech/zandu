# Guide du développeur

## Démarrer en local

Prérequis : Node.js 22 (`.nvmrc`), pnpm 10, Docker.

```bash
pnpm install
docker compose up -d postgres             # PostgreSQL 16 (+ base de test) ; « stockage » : S3 local facultatif
cp .env.example .env                      # puis ajuster APP_SECRET
export $(grep -v '^#' .env | xargs)       # ou un outil comme direnv
pnpm db:migrate && pnpm db:seed           # schéma + zones, tarifs, catégories, commissions
pnpm db:seed:demo                         # facultatif : 3 boutiques et 12 produits avec photos
pnpm dev:api                              # API sur http://localhost:3000
pnpm dev:worker                           # tâches de fond, dont les photos (autre terminal)
```

En développement, les SMS (dont les **codes de connexion** et **codes de remise**) s'affichent dans la
console et sont consultables sur `GET /dev/messages?recipient=%2B242066123456` — pratique pour se
connecter depuis un téléphone de test. Les photos sont gardées dans `LOCAL_STORAGE_DIR`.

Comptes de démonstration (`pnpm db:seed:demo`) : administrateur `06 900 00 00`, livreur `06 800 00 00`,
vendeurs `06 100 00 01`, `06 100 00 02`, `05 100 00 03`. N'importe quel autre numéro crée un acheteur.
Le paiement passe par le **simulateur** : pour valider un paiement comme si l'acheteur avait tapé son PIN :

```bash
curl -X POST http://localhost:3000/dev/simulator/collections/<paymentId>/approve
# autres issues : insufficient_funds, declined ; un numéro finissant par 99 est refusé d'emblée
```

Donner un rôle support/admin/livreur : `pnpm --filter @zandu/api user:grant-role "06 612 34 56" admin`.

## Site web (acheteurs)

```bash
cp apps/web/.env.example apps/web/.env.local   # ZANDU_API_URL, SITE_URL, ZANDU_SIMULATOR=1
pnpm dev:web                                   # http://localhost:3200
```

`SITE_URL` est l'adresse publique : elle apparaît dans les aperçus WhatsApp (balises Open Graph) et le
plan du site. Pour voir un aperçu réel, le site doit être joignable depuis Internet (recette). Le
jeton de session de l'acheteur reste côté serveur (cookie `httpOnly`), le panier dans le navigateur.

## Back-office (support et administration)

```bash
cp apps/backoffice/.env.example apps/backoffice/.env.local   # ZANDU_API_URL
pnpm dev:backoffice                                          # http://localhost:3100
```

Connexion avec le compte administrateur de démonstration `06 900 00 00` : code SMS (visible dans la
console de l'API), puis **second facteur** : à la première connexion, scanner le QR code avec une
application d'authentification (Google Authenticator, Aegis…), puis saisir son code à chaque connexion.
Le second facteur est exigé par l'API pour toutes les routes `/v1/support` et `/v1/admin`
(`STAFF_MFA_REQUIRED`, toujours actif en production, désactivé par défaut dans les tests).
Téléphone perdu : `POST /v1/admin/users/{id}/mfa/reset` par un administrateur.

Ne pas lancer `next build` avec `NODE_ENV=development` dans l'environnement (Next.js le refuse).

## Application mobile (Android)

```bash
cp apps/mobile/.env.example apps/mobile/.env   # EXPO_PUBLIC_API_URL selon l'appareil
pnpm dev:mobile                                # puis « a » (émulateur Android), ou Expo Go sur un téléphone
```

- Adresse de l'API : `http://10.0.2.2:3000` depuis l'émulateur Android, `http://<IP du poste>:3000`
  depuis un téléphone sur le même Wi-Fi, `http://localhost:3000` pour la version web (`w`).
- `EXPO_PUBLIC_SIMULATOR=1` affiche sur l'écran d'attente un bouton « Simuler la validation du PIN ».
- Tous les textes sont dans `apps/mobile/src/i18n/fr.ts` ; les appels à l'API passent par le client typé
  `@zandu/api-client`. Après une modification du contrat : `pnpm --filter @zandu/api-client generate`.

**Parcours de bout en bout** (version web pilotée par Chromium, captures à chaque étape) :

```bash
# API et worker démarrés avec PUBLIC_API_URL=http://localhost:3998 PORT=3998 et pnpm db:seed:demo
cd apps/mobile
EXPO_PUBLIC_API_URL=http://localhost:3998 EXPO_PUBLIC_SIMULATOR=1 npx expo export --platform web --output-dir dist
node e2e/serve.mjs &                         # sert dist/ sur http://localhost:8081
DATABASE_URL=… SHOTS=./captures node e2e/parcours-acheteur.mjs
DATABASE_URL=… SHOTS=./captures node e2e/parcours-vendeur-livreur.mjs
# back-office démarré sur http://localhost:3100 (pnpm --filter @zandu/backoffice build && … start)
cd ../backoffice && DATABASE_URL=… SHOTS=./captures node e2e/parcours-support.mjs
# site web démarré sur http://localhost:3200 avec ZANDU_SIMULATOR=1
cd ../web && DATABASE_URL=… SHOTS=./captures node e2e/parcours-web.mjs
```

Les scripts configurent eux-mêmes le second facteur du compte administrateur (secret gardé dans un
fichier temporaire) et calculent ses codes.

Le second parcours crée à chaque fois un nouveau vendeur (boutique, pièces, produit avec photo), puis
fait livrer la commande par le livreur de démonstration (06 800 00 00). Sur la version web, l'appareil
photo s'ouvre comme un sélecteur de fichier : le script y dépose une image de `db/seeds/demo/images`.

**Espaces vendeur et livreur dans l'application** : onglet Compte → « Ouvrir ma boutique » (n'importe
quel numéro) ou « Mon espace vendeur » (06 100 00 01, 06 100 00 02, 05 100 00 03) ; « Mes livraisons »
pour le livreur 06 800 00 00. Les livraisons sont assignées par le support :
`POST /v1/support/deliveries/{commande}/assign` avec le compte administrateur 06 900 00 00.

## Commandes utiles

| Commande                                   | Effet                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `pnpm test`                                | Tous les tests (domaine + intégration ; PostgreSQL requis)             |
| `pnpm test:unit`                           | Règles métier seules (sans base, < 1 s)                                |
| `pnpm test:integration`                    | API contre PostgreSQL (`TEST_DATABASE_URL`, base `zandu_test`)         |
| `pnpm typecheck`                           | Vérification des types (TypeScript 7)                                  |
| `pnpm format`                              | Formatage Prettier                                                     |
| `pnpm lint:openapi`                        | Validation du contrat `docs/api/openapi.yaml`                          |
| `pnpm build`                               | Compilation de production (`dist/`)                                    |
| `pnpm --filter @zandu/api storage:check`   | Crée les compartiments S3 et vérifie leurs droits (public / privé)     |
| `pnpm --filter @zandu/api media:reprocess` | Remet en file les photos à redécliner (après un changement de réglage) |

**Photos** : le worker décline chaque photo produit (vignette, fiche, partage ; ADR-0014, réglages
dans `apps/api/src/modules/media/variants.ts`). En développement, l'API et le worker doivent voir le
même `LOCAL_STORAGE_DIR` ; sinon le worker ne trouve pas les originaux et l'original reste affiché.

## Conteneurs et recette

Les images de production se construisent depuis la racine (ADR-0013) :

```bash
docker build --target api -t zandu-api .          # API ; aussi worker, migrations, outils
docker build --target web -t zandu-web .
docker build --target backoffice -t zandu-backoffice .
```

Toute la recette (HTTPS, stockage S3, données de démonstration, contrôles) tourne sur un poste avec
`./deploy/recette/essai-local.sh` (prérequis en tête du script). Mise en ligne réelle :
[guide](exploitation/mise-en-ligne-recette.md).

Les parcours de bout en bout (site web, support) passent aussi contre la recette en conteneurs :
`API_URL`, `SITE_URL`, `BO_URL` vers ses adresses, `RECETTE_KEY` pour lire les SMS de test,
`DATABASE_URL` vers sa base (port de PostgreSQL publié en local par un fichier Compose
complémentaire), et pour les certificats locaux `NODE_EXTRA_CA_CERTS=deploy/recette/.essai-local/caddy-racine.crt`
avec `E2E_ACCEPT_LOCAL_CERTS=1`.

## Règles de l'équipe

1. **Argent** : tout calcul ou décision dans `packages/domain`, avec tests. Jamais de `float`.
   Toute écriture comptable via une fonction de `ledger.ts` puis `postJournal`.
2. **Statut de commande** : uniquement via `applyOrderEvent`. Nouvelle transition = domaine
   (`order-machine.ts`) **et** nouvelle migration qui l'ajoute à `order_status_transitions` (un test
   vérifie que les deux concordent).
3. **Base de données** : jamais modifier une migration déjà appliquée ; en ajouter une
   (`db/migrations/000N_description.sql`). Requêtes toujours paramétrées (`$1`) ; caster explicitement
   un paramètre enum utilisé dans une comparaison (`$2::order_status`).
4. **Temps** : lire l'heure via `ctx.clock.now()` (testable), jamais `now()` SQL dans une règle métier.
5. **Appels externes** (agrégateur, SMS) : jamais à l'intérieur d'une transaction.
6. **Accès** : chaque route qui prend un identifiant vérifie que l'utilisateur y a droit (sinon 404).
7. **Textes** : en français, hors du code métier (modèles de notification, catalogues de traduction).
8. **Commits** : petits, au présent, en français (« Ajoute l'envoi des pièces KYC »). Une branche par
   fonctionnalité, revue obligatoire, CI verte avant fusion.

## Ajouter un agrégateur de paiement

1. Créer `apps/api/src/modules/payments/<nom>.ts` qui implémente `PaymentProvider`
   (collecte, reversement, remboursement, `lookup`, `parseWebhook` avec vérification de signature).
2. Traduire les statuts et motifs d'échec de l'agrégateur vers `pending | succeeded | failed` et
   les codes de `failureMessage` (`insufficient_funds`, `declined`, `invalid_account`, `limit_exceeded`).
3. L'enregistrer dans `bootstrap.ts` ; `PAYMENT_PROVIDER=<nom>` ; secrets en variables d'environnement.
4. Rejouer en bac à sable le script de recette (100 commandes, cas d'erreur du cahier §5).

## Définition de « terminé »

Code relu · tests (unitaires pour une règle, intégration pour une route) · CI verte · contrat OpenAPI
à jour · textes en français · aucune donnée sensible dans les journaux · documentation mise à jour si
une décision change (nouvel ADR).
