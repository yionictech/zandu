# ADR-0018 — Notifications sur le téléphone, WhatsApp puis SMS en secours

**Statut** : acceptée · **Date** : octobre 2026

## Contexte

Jusqu'ici, chaque événement d'une commande partait par WhatsApp, doublé par SMS si WhatsApp
échouait. Un SMS coûte de l'argent à chaque envoi, WhatsApp exige des modèles validés par Meta et un
fournisseur, et ni l'un ni l'autre n'ouvre l'écran de la commande. Le vendeur doit pourtant accepter
une nouvelle commande sous 24 h, et l'acheteur être présent quand le livreur arrive.

## Décision

1. **La notification de l'application d'abord**, par le service d'Expo (qui passe par Firebase
   Cloud Messaging) : un jeton par téléphone, rattaché à la **session** qui l'a enregistré. Une
   session fermée (déconnexion, accès retiré, expiration) ne reçoit plus rien, même si le téléphone
   n'a pas pu prévenir le serveur. Un jeton déjà connu qui passe à un autre compte change de
   propriétaire. Le serveur n'a besoin d'aucun identifiant Firebase.
2. **Toucher la notification ouvre l'écran concerné** (la commande côté acheteur ou vendeur,
   « Mon argent », « Mes achats »). Reçue application ouverte, elle actualise les écrans.
3. **Secours** :
   - pas de téléphone connecté, ou aucun envoi accepté (jeton refusé : le téléphone est oublié) →
     WhatsApp tout de suite, lui-même doublé par SMS s'il échoue ;
   - **messages qui demandent d'agir ou touchent à l'argent** (nouvelle commande, litige,
     commande en route, colis au point relais, annulation, remboursement, reversement) : doublés par
     WhatsApp s'ils ne sont **ni touchés, ni reçus application ouverte, ni suivis d'une visite dans
     l'application** sous `PUSH_FALLBACK_MINUTES` (15 par défaut) ;
   - simples nouvelles (paiement reçu, commande en préparation, remise, argent crédité) : jamais
     doublées si la notification est partie.
4. **Toujours par SMS**, sans notification : codes de connexion, code de remise, changements
   d'accès du personnel (ils doivent arriver même sans données mobiles).
5. L'activité des sessions (`last_seen_at`) suit désormais l'horloge de l'application, à la minute
   près : elle sert au secours et à la « Dernière activité » de la page Personnel (elle ne bougeait
   plus après la connexion).
6. **La déconnexion dans l'application ferme la session côté serveur** (elle restait valable
   jusqu'ici) et oublie le téléphone ; faite sans réseau, elle est terminée au retour du réseau.
7. Mise en service par le fondateur : un projet Expo et un projet Firebase gratuits (guide de mise
   en ligne, §10 bis). Sans eux, l'application se construit sans notifications et tout passe par
   WhatsApp/SMS comme avant.

## Conséquences

- ➕ Moins de SMS payés ; le vendeur voit la nouvelle commande et l'ouvre d'un geste.
- ➕ Un message important n'est jamais perdu : WhatsApp puis SMS prennent le relais.
- ➕ Un téléphone prêté ou revendu ne reçoit plus les notifications de l'ancien compte.
- ➖ Une notification vue dans la barre de notifications sans être touchée, l'application jamais
  ouverte ensuite, est doublée par WhatsApp au bout de 15 minutes (doublon assumé pour ce qui
  demande d'agir).
- ➖ Dépendance au service d'Expo et à Firebase pour les notifications (pas pour WhatsApp/SMS).
- ➖ Non essayé sur un vrai téléphone tant que la recette et les comptes Expo/Firebase ne sont pas
  en place : les tests couvrent le serveur et le service d'Expo simulé.
