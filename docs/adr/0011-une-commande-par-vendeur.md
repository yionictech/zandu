# ADR-0011 — Une commande par vendeur, un paiement par panier

**Statut** : acceptée · **Date** : octobre 2026

## Contexte

Un acheteur doit pouvoir remplir un panier chez plusieurs vendeurs et payer une seule fois (une seule
validation PIN). Mais chaque vendeur prépare, livre, est payé et peut être en litige indépendamment.

## Décision

`checkouts` porte le paiement ; il se découpe en **une commande par vendeur** (`orders`), chacune avec
sa livraison, son séquestre (ventilé au grand livre par `order_id`), son litige et son reversement.
C'est le modèle d'AliExpress et de la plupart des places de marché.

## Conséquences

- ➕ Un incident chez un vendeur n'affecte pas les autres commandes du panier.
- ➕ Remboursement partiel naturel (une commande annulée sur deux).
- ➖ Tant que le panier attend son paiement, ses commandes forment un bloc : on ne peut pas en annuler
  une seule (sinon le paiement couvrirait une commande annulée). Règle codée dans la machine à états.
