# ADR-0016 — Site acheteurs utilisable quand le réseau coupe

**Statut** : acceptée · **Date** : octobre 2026

## Contexte

À Pointe-Noire, le réseau mobile coupe souvent, et beaucoup d'acheteurs coupent eux-mêmes leurs
données pour économiser leur forfait. Jusqu'ici, sans réseau, le site affichait la page d'erreur du
navigateur, même pour une fiche produit consultée une minute plus tôt. Le panier, lui, était déjà
gardé dans le navigateur.

## Décision

1. Un **service worker écrit à la main** (`apps/web/public/sw.js`, environ 120 lignes, sans
   dépendance) :
   - **Pages** : le réseau d'abord ; sans réseau, la dernière version enregistrée ; sinon la page
     **« hors connexion »** (`/hors-ligne`), enregistrée dès l'installation, qui propose le panier
     et les **produits vus récemment** (gardés dans le navigateur).
   - **Fichiers de l'application** (`/_next/static`, noms à empreinte) et **photos** : cache
     d'abord, avec un nombre d'entrées plafonné (pages 60, photos 80, fichiers 150).
   - Le réseau d'abord plutôt qu'une copie servie d'emblée : un prix ou un stock n'est jamais
     montré périmé quand le réseau répond.
2. **Jamais de copie** pour ce qui engage de l'argent ou une identité : paiement, validation du
   panier, connexion, routes `/api`, pages de recette. Sans réseau, elles mènent à la page
   « hors connexion ». Rien n'est jamais rejoué tout seul au retour du réseau.
3. Les **pages personnelles** (« Mes achats », suivi de commande) vont dans un cache à part, vidé
   dès que le site voit l'acheteur déconnecté : un téléphone prêté ou partagé ne montre pas les
   commandes de l'acheteur précédent.
4. Un **bandeau** prévient l'acheteur qu'il voit la dernière version enregistrée, et que le
   paiement attendra le retour du réseau.

## Conséquences

- ➕ Fiches, accueil, panier et suivi de commande déjà consultés restent lisibles sans réseau.
- ➕ Moins de données consommées : fichiers de l'application et photos ne sont plus retéléchargés.
- ➕ Aucune donnée d'argent ni de connexion n'est servie depuis le téléphone.
- ➖ Une page jamais consultée reste indisponible sans réseau (la page « hors connexion » le dit).
- ➖ Le service worker est un code de plus à faire évoluer : changer `VERSION` dans `sw.js` vide les
  pages enregistrées lors d'un changement de mise en page important.
- ➖ L'application Android n'est pas concernée : son fonctionnement sans réseau reste à traiter.
