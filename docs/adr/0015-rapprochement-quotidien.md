# ADR-0015 — Rapprochement quotidien avec l'agrégateur

**Statut** : acceptée · **Date** : octobre 2026

## Contexte

L'argent des acheteurs est détenu par l'agrégateur agréé ; Zandu tient le registre de « à qui il
appartient » (ADR-0004, ADR-0005). Rien ne garantissait encore que ce registre et l'argent réel
concordent : un webhook perdu au-delà des 30 minutes d'interrogation, un reversement que l'agrégateur
n'a jamais exécuté, des frais qu'il ne déclare qu'à son relevé, un mouvement sur le compte que
personne n'a demandé. Le cahier (§5) et la feuille de route (critère de recette S11-S12) exigent
**un rapprochement quotidien, sans écart pendant 7 jours** avant de traiter de l'argent réel.

## Décision

1. **Le port de l'agrégateur gagne une opération** : `fetchStatement(from, to)` rend les mouvements
   _exécutés_ sur la période (type, notre référence, référence de l'agrégateur, montant signé, frais)
   et, s'il le communique, le solde du compte à la fin de la période. C'est la question n° 6 posée
   aux agrégateurs (architecture §3.6) ; le simulateur est l'implémentation de référence.

2. **Une clé relie chaque mouvement aux deux côtés** : `collection:<paiement>`,
   `payout:<reversement>`, `refund:<remboursement>`, `fee:<opération>`, ou
   `other:<réf. agrégateur>` pour un mouvement sans référence Zandu. Côté Zandu, la source est le
   compte `asset:provider_cash:<agrégateur>` du grand livre, pas les tables d'opérations : c'est le
   registre de l'argent qu'on rapproche.

3. **Chaque nuit après 2 h (heure du Congo), le worker contrôle la veille**, agrégateur par
   agrégateur ; il rattrape jusqu'à 7 journées manquées (une par passage) et redemande un relevé
   indisponible toutes les 30 minutes (une seule alerte par panne). Un administrateur peut aussi
   contrôler la journée en cours, ou recontrôler une journée : l'opération est **idempotente**
   (relevé conservé, écarts identifiés par ce qu'ils concernent, écritures à clé unique).

4. **Ce que le contrôle fait de lui-même** — uniquement ce que la plateforme fait déjà sur la foi
   de l'agrégateur :
   - un paiement resté en attente chez Zandu (webhook perdu) que le relevé montre réussi suit le
     même chemin qu'une consultation : capture, ou **succès tardif remboursé** ;
   - un reversement ou remboursement « en cours » que le relevé montre exécuté est confirmé ;
   - les **frais connus par le seul relevé** sont comptabilisés, à la date de l'opération (ils
     tombent dans le bon mois du rapport d'activité).

5. **Ce qu'il signale** (table `reconciliation_discrepancies`, alerte WhatsApp au support, compteur
   rouge dans le menu des administrateurs) :

   | Écart              | Signification                                                                       |
   | ------------------ | ----------------------------------------------------------------------------------- |
   | `missing_internal` | Mouvement de l'agrégateur sans opération Zandu (frais de compte, apport, erreur)    |
   | `missing_provider` | Mouvement comptabilisé chez Zandu, absent du relevé (ex. reversement non exécuté)   |
   | `status_mismatch`  | Exécuté chez l'agrégateur, échoué chez Zandu (ex. reversement « échoué » mais payé) |
   | `amount_mismatch`  | Même opération, montants différents                                                 |
   | `fee_mismatch`     | Frais du relevé différents de ceux annoncés                                         |
   | `balance_mismatch` | Solde de l'agrégateur que ni ses lignes ni le grand livre n'expliquent              |

6. **Minuit n'est pas une frontière d'erreur** : une opération exécutée à 23 h 59 chez l'agrégateur
   et comptabilisée à 0 h 01 chez Zandu est la même (l'appariement ne regarde pas les dates). Un
   mouvement comptabilisé dans les **30 dernières minutes** de la période et absent du relevé est
   « attendu au relevé suivant », pas un écart ; le contrôle du lendemain le revérifie.

7. **État de rapprochement**, comme le ferait un comptable : solde du grand livre ± ce que chacun
   n'a pas encore vu ± écarts de montant = solde attendu chez l'agrégateur, comparé au solde annoncé.
   Ce qui reste est l'« écart inexpliqué » (doit valoir 0). Avant le premier contrôle, les deux côtés
   sont réputés d'accord (l'historique n'est pas relu) ; aucun contrôle ne peut viser une journée
   antérieure.

8. **Un écart se clôt par un administrateur, avec une explication**, et au besoin une
   **écriture de régularisation** du montant de l'écart sur le compte agrégateur, contre l'un de
   trois comptes : frais de l'agrégateur, **apports de Zandu** (nouveau compte
   `liability:platform_funding`, entrée seulement) ou **compte d'attente** le temps de l'enquête.
   Un écart de solde exige une écriture : sans elle, il reviendrait chaque jour. Les écarts qui se
   règlent d'eux-mêmes (ligne parue au relevé suivant, webhook arrivé) sont clos automatiquement,
   avec la mention « Résolu automatiquement ». Tout est journalisé (audit) ; réservé aux
   administrateurs.

9. **Le simulateur tient ses propres comptes en base** (schéma `simulator`, jamais utilisé en
   production) : l'API et le worker, deux processus, partagent ainsi ses opérations (y compris les
   consultations), et son relevé est indépendant de nos tables. Il sait prélever des frais visibles
   au relevé seulement, et une route de recette (`POST /dev/simulator/account-movements`, clé de
   recette exigée) simule un mouvement inconnu pour essayer l'alarme.

## Conséquences

- ➕ Un franc qui manque, apparaît ou part deux fois est vu le lendemain matin, avec la commande
  concernée et l'action à mener ; le critère de recette « 7 jours sans écart » est affiché.
- ➕ Le contrôle rattrape seul ce que l'interrogation de 30 minutes a manqué (succès tardifs).
- ➕ Les frais réels de l'agrégateur entrent au grand livre même s'il ne les annonce pas.
- ➖ L'adaptateur de l'agrégateur réel doit savoir produire un relevé ; sans solde communiqué,
  l'état de rapprochement n'est pas calculé (les lignes restent contrôlées).
- ➖ Le contrôle relit tout le compte agrégateur depuis le premier contrôle : quelques secondes par
  nuit à l'échelle prévue ; à reprendre par solde reporté au-delà de quelques millions de lignes.
- ➖ Un écart de statut sur un reversement déjà rendu au vendeur (risque de double paiement) se
  traite à la main : le contrôle le signale en priorité mais ne reprend pas l'argent au vendeur.
