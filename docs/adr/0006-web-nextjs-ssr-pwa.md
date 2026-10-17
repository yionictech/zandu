# ADR-0006 — Web en Next.js avec rendu serveur et PWA

**Statut** : acceptée (site en place dans `apps/web` ; cache hors ligne par service worker à venir) · **Date** : octobre 2026

## Décision

Le site acheteur/vendeur est une application **Next.js** : fiches produit et catalogue rendus côté
serveur (HTML complet, balises Open Graph), mis en cache au CDN ; PWA installable avec service worker
(cache hors ligne, mode économie de données). Le back-office est une application Next.js distincte,
sur un domaine distinct, construite avec un kit d'administration (Refine, React-Admin ou équivalent).
_Précisé par l'ADR-0012 : back-office en rendu serveur, sans kit d'administration._

## Raisons

- Partage WhatsApp/Facebook : aperçu avec photo, prix et titre pour **chaque** produit.
- 3G : HTML utile au premier octet, JavaScript initial limité (budget ≤ 170 Ko gzip).
- Précédents en marchés émergents : les versions « Lite » en PWA de Flipkart et AliExpress ont nettement
  augmenté la conversion sur réseaux lents.

## Conséquences

- ➕ Un lien partagé s'ouvre sans installer l'application ; acquisition par le partage.
- ➖ Deux interfaces à maintenir (web et Android), atténué par le partage de code TypeScript.
