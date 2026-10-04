# ADR-0003 — PostgreSQL unique : données, grand livre, file, recherche

**Statut** : acceptée · **Date** : octobre 2026

## Décision

PostgreSQL 16 est la seule base : données métier, grand livre, file de messages sortants (outbox),
recherche plein texte (`fr_unaccent` + trigrammes `pg_trgm`). Pas de Redis, d'Elasticsearch ni de
courtier de messages au MVP.

## Raisons

- Valider un paiement et son écriture comptable dans **une** transaction (cahier §4).
- Les contraintes et triggers protègent l'argent même contre un bug applicatif (écriture seule,
  équilibre au COMMIT, transitions autorisées).
- `FOR UPDATE SKIP LOCKED` fait une file de travail fiable pour plusieurs workers.
- Une seule chose à sauvegarder, restaurer, surveiller.

## Conséquences

- ➕ Opérations simples, coût bas.
- ➖ Recherche moins riche qu'un moteur dédié : acceptable jusqu'à ~50 000 produits (voir infra §7.6).
