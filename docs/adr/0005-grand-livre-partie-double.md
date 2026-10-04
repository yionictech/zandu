# ADR-0005 — Grand livre en partie double, en écriture seule

**Statut** : acceptée · **Date** : octobre 2026

## Décision

Tout mouvement d'argent est une transaction comptable équilibrée (somme des lignes = 0) produite par
`packages/domain/ledger.ts` et enregistrée par `postJournal`. Les tables `ledger_*` refusent UPDATE,
DELETE et TRUNCATE ; l'équilibre est vérifié par un trigger différé au COMMIT. Chaque transaction porte
une clé métier unique (idempotence).

## Raisons

Un solde stocké dans une colonne (« solde vendeur = 45 000 ») finit toujours faux après un bug ou une
reprise. Un journal équilibré se recalcule, s'audite et se rapproche du relevé de l'agrégateur.
C'est la pratique des banques et des grandes plateformes de paiement.

## Conséquences

- ➕ Soldes toujours démontrables ; rapprochement quotidien possible ; exports comptables directs.
- ➖ Une erreur se corrige par une écriture inverse, jamais en modifiant le passé (c'est voulu).
