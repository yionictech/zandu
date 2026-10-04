# Zandu

**La place de marché congolaise où l'on achète et vend en confiance, payé par Mobile Money.**

_Zandu_ signifie « marché » en kikongo (_zando_ en lingala). Les vendeurs publient leurs produits, les acheteurs paient avec
MTN MoMo ou Airtel Money, et **l'argent reste bloqué en séquestre jusqu'à la livraison** : le vendeur
est payé quand le client a son colis, l'acheteur est remboursé s'il ne l'a pas.
Lancement prévu à Pointe-Noire, puis Brazzaville et la zone CEMAC.

## État du projet

Socle technique du MVP en place et testé :

- **Schéma de données complet** (PostgreSQL 16) avec garde-fous en base : grand livre en partie double
  en écriture seule, équilibre vérifié à chaque transaction, transitions de commande verrouillées.
- **Règles métier pures** (`packages/domain`) : argent en FCFA entiers, commissions, machines à états
  commande et paiement, écritures comptables, plafonds des nouveaux vendeurs, filtre de messagerie.
- **API** (`apps/api`) : connexion par SMS, catalogue et recherche, panier multi-vendeurs, paiement Mobile
  Money (simulateur d'agrégateur), séquestre, livraison avec code de remise, litiges, remboursements,
  reversements automatiques, back-office minimal, journal d'audit.
- **102 tests automatiques**, dont tous les cas d'erreur de paiement du cahier des charges.

À construire : applications Android et web, back-office graphique, branchement de l'agrégateur réel et du
fournisseur SMS/WhatsApp, envoi des photos et pièces KYC, rapprochement quotidien. Voir la
[feuille de route](docs/produit/feuille-de-route-16-semaines.md).

## Documentation

Tout est dans [`docs/`](docs/README.md) : architecture, décisions (ADR), expérience utilisateur,
feuille de route, décisions à prendre, contrat d'API.

## Démarrage rapide

```bash
pnpm install
docker compose up -d
cp .env.example .env && export $(grep -v '^#' .env | xargs)
pnpm db:migrate && pnpm db:seed
pnpm test            # 102 tests
pnpm dev:api         # http://localhost:3000/health
```

Détails : [guide du développeur](docs/developpement.md).

## Structure

```
apps/api/          API HTTP + worker (Node.js, Fastify)
packages/domain/   Règles métier pures (argent, statuts, grand livre)
db/migrations/     Schéma SQL versionné
db/seeds/          Données de référence (zones, tarifs, catégories, commissions)
docs/              Dossier d'architecture
```
