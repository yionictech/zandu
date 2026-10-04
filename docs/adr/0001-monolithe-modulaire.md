# ADR-0001 — Monolithe modulaire plutôt que microservices

**Statut** : acceptée · **Date** : octobre 2026

## Contexte

Deux développeurs, 16 semaines, 100 commandes/heure au lancement. Les géants (Amazon, Alibaba, Shopify)
ont tous commencé par un monolithe et ne l'ont découpé qu'avec des centaines d'ingénieurs. Les
microservices imposent : transactions distribuées (dangereuses pour l'argent), déploiements multiples,
observabilité distribuée, réseau entre services.

## Décision

Un seul backend (`apps/api`), découpé en modules aux frontières strictes (voir architecture §2), déployé
en deux processus : API HTTP et worker. Le paiement, le séquestre et le grand livre sont mis à jour dans
**une seule transaction PostgreSQL** (exigence du cahier §4).

## Conséquences

- ➕ Cohérence forte de l'argent sans protocole distribué ; un seul déploiement ; débogage simple.
- ➕ Découpage futur possible : `payments` + `ledger` sont le premier candidat (frontière déjà nette).
- ➖ Discipline nécessaire pour respecter les frontières de modules (revue de code, règles §2.2).
