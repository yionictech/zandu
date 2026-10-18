# ADR-0017 — Application Android utilisable quand le réseau coupe

**Statut** : acceptée · **Date** : octobre 2026

## Contexte

Le site acheteurs reste lisible sans réseau depuis l'ADR-0016 ; l'application Android, non. Pire :
ouverte sans réseau, elle effaçait la session (la vérification du jeton échouait) et le vendeur
devait se reconnecter par SMS une fois le réseau revenu. Un vendeur qui photographie ses produits
au marché, sans données mobiles, ne pouvait rien préparer. Beaucoup de téléphones restent aussi
« connectés » à l'antenne avec un forfait épuisé : l'état de la connexion du téléphone ne dit pas si
l'API répond.

## Décision

1. **Le réseau, c'est l'API qui répond.** Chaque requête renseigne l'état du réseau ; un échec faute
   de réseau passe l'application hors connexion, et elle interroge `/health` toutes les 8 secondes
   (et au retour au premier plan) jusqu'à ce que l'API réponde. Aucune dépendance ajoutée.
2. **Session gardée sans réseau** : seul un refus de l'API (401) ferme la session. Le profil (nom,
   rôles) est gardé pour ouvrir l'application hors connexion ; la session est revérifiée au retour
   du réseau.
3. **Copie des données déjà affichées** (cache React Query enregistré sur le téléphone, une seconde
   après chaque chargement ou dès que l'application passe en arrière-plan) : catégories, accueil,
   fiches produit (40 au plus), zones ; pour le compte connecté, achats, missions du livreur et
   espace vendeur. Jamais le panier validé ni le paiement ; pas les recherches. Les données du
   compte sont effacées à la déconnexion ; une copie de plus de 7 jours n'est pas reprise. Les
   photos déjà vues restent dans le cache disque d'`expo-image`.
4. **Un bandeau** prévient : « Hors connexion : vous voyez la dernière version enregistrée. Le
   paiement attendra le retour du réseau. » Un écran jamais enregistré le dit au lieu de tourner
   sans fin.
5. **Les actions ne sont jamais mises en attente** (payer, confirmer, accepter une commande, saisir
   un code de remise) : sans réseau, elles échouent tout de suite avec un message.
6. **Seule exception, choisie par le vendeur : la fiche produit.** Sans réseau, « Publier » devient
   « Envoyer au retour du réseau » : la fiche et ses photos sont gardées sur le téléphone et partent
   toutes seules dès que l'API répond. Chaque étape (création, envoi et rattachement de chaque
   photo, publication) est enregistrée ; une coupure au milieu reprend là où l'envoi s'était
   arrêté. La création porte une `Idempotency-Key` (désormais acceptée par
   `POST /v1/seller/products`) et le rattachement d'une photo déjà rattachée est sans effet : un
   renvoi ne crée jamais de doublon. Une fiche refusée par l'API reste dans « Mes produits » avec
   la raison, à corriger ou supprimer. Elle n'est envoyée que sous le compte qui l'a préparée.

## Conséquences

- ➕ Catalogue, fiches, achats, missions et espace vendeur déjà consultés restent lisibles sans
  réseau, même après avoir fermé l'application ; plus de reconnexion forcée.
- ➕ Un vendeur prépare ses fiches sans données mobiles ; elles partent une seule fois.
- ➕ Rien qui engage de l'argent n'est rejoué tout seul.
- ➖ Un écran jamais ouvert reste vide sans réseau (il le dit).
- ➖ Les photos d'une fiche en attente sont dans le cache du téléphone : si Android le vide (stockage
  plein), la fiche passe en « Non envoyée » et la photo est à reprendre.
- ➖ La version web de l'application (servant aux parcours automatisés) n'a pas de service worker :
  elle ne se rouvre pas sans le serveur qui la sert ; le parcours coupe donc l'accès à l'API seule.
