# Guide du développeur

## Démarrer en local

Prérequis : Node.js 22 (`.nvmrc`), pnpm 10, Docker.

```bash
pnpm install
docker compose up -d                      # PostgreSQL 16 (+ base de test) et stockage S3 local
cp .env.example .env                      # puis ajuster APP_SECRET
export $(grep -v '^#' .env | xargs)       # ou un outil comme direnv
pnpm db:migrate && pnpm db:seed           # schéma + zones, tarifs, catégories, commissions
pnpm dev:api                              # API sur http://localhost:3000
pnpm dev:worker                           # tâches de fond (autre terminal)
```

En développement, les SMS (dont les **codes de connexion**) s'affichent dans la console de l'API.
Le paiement passe par le **simulateur** : pour valider un paiement comme si l'acheteur avait tapé son PIN :

```bash
curl -X POST http://localhost:3000/dev/simulator/collections/<paymentId>/approve
# autres issues : insufficient_funds, declined ; un numéro finissant par 99 est refusé d'emblée
```

Donner un rôle support/admin/livreur : `pnpm --filter @zandu/api user:grant-role "06 612 34 56" admin`.

## Commandes utiles

| Commande                | Effet                                                          |
| ----------------------- | -------------------------------------------------------------- |
| `pnpm test`             | Tous les tests (domaine + intégration ; PostgreSQL requis)     |
| `pnpm test:unit`        | Règles métier seules (sans base, < 1 s)                        |
| `pnpm test:integration` | API contre PostgreSQL (`TEST_DATABASE_URL`, base `zandu_test`) |
| `pnpm typecheck`        | Vérification des types (TypeScript 7)                          |
| `pnpm format`           | Formatage Prettier                                             |
| `pnpm lint:openapi`     | Validation du contrat `docs/api/openapi.yaml`                  |
| `pnpm build`            | Compilation de production (`dist/`)                            |

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
