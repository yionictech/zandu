# ADR-0004 — Agrégateur derrière un port ; séquestre = règle de statuts

**Statut** : acceptée · **Date** : octobre 2026

## Contexte

Détenir soi-même les fonds des acheteurs relève de la réglementation des services de paiement de la
CEMAC (règlement 04/18). Le business plan recommande de passer par un partenaire agréé au départ.

## Décision

1. L'argent est détenu par un **agrégateur agréé** (candidats annoncés au Congo : pawaPay, CinetPay ;
   alternative : accords directs MTN et Airtel).
2. Le **séquestre est une règle de statuts** : Zandu ne donne l'ordre de reverser qu'après remise du colis
   et fin de la fenêtre de litige ; le grand livre dit à qui appartient chaque franc.
3. Tout agrégateur est accédé par l'interface `PaymentProvider` (collecte, reversement, remboursement,
   consultation, webhooks). Un **simulateur** implémente la même interface pour le développement et la recette.

## Conséquences

- ➕ Pas d'agrément à obtenir pour lancer ; changement d'agrégateur sans toucher au séquestre.
- ➕ Les équipes mobile/web travaillent avant la signature du contrat (simulateur).
- ➖ Dépendance aux frais, délais et plafonds de l'agrégateur : à négocier (voir décisions à prendre).
