# ADR-0009 — Tâches de fond : échéances en base, balayeurs, outbox

**Statut** : acceptée · **Date** : octobre 2026

## Décision

- Chaque délai métier est une **colonne** (`payments.expires_at`, `orders.seller_accept_deadline`,
  `orders.dispute_window_ends_at`, `payouts.next_attempt_at`…).
- Le **worker** exécute en boucle des **balayeurs idempotents** qui traitent ce qui est échu
  (`apps/api/src/jobs/sweepers.ts`), avec `FOR UPDATE SKIP LOCKED` pour tourner à plusieurs.
- Les notifications passent par une **outbox** écrite dans la même transaction que le changement métier.

## Raisons

Un minuteur en mémoire disparaît au redémarrage ; une échéance en base survit à tout. Les balayeurs se
testent en avançant une horloge simulée (c'est ce que font les tests d'intégration).

## Conséquences

- ➕ Aucune infrastructure supplémentaire (ni Redis, ni file de messages).
- ➖ Latence de quelques secondes (cycle du worker, 5 s par défaut) : sans impact métier.
- Évolution possible vers graphile-worker ou une file managée sans changer les services.
