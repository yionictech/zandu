# ADR-0002 — TypeScript de bout en bout

**Statut** : acceptée — le fondateur a lancé le codage sur cette base (octobre 2026) · **Date** : octobre 2026

## Contexte

Le cahier des charges suggère Flutter (Android + web) et Supabase ou Node.js + PostgreSQL. L'équipe
compte un développeur mobile et un développeur backend, plus un testeur à partir du mois 5.

## Décision

- **Backend** : Node.js 22 + Fastify + PostgreSQL (SQL explicite, sans ORM pour la partie argent).
- **Android** : React Native + Expo (ADR-0007). **Web** et **back-office** : Next.js (ADR-0006).
- Code partagé : règles et types (`packages/domain`), client d'API généré depuis OpenAPI, traductions.

## Pourquoi pas Flutter pour le web

Flutter web dessine dans un canevas : premier chargement de plusieurs Mo, référencement faible,
pas d'aperçu de lien par produit sans serveur dédié. Or le business plan mise sur le partage dans les
groupes WhatsApp/Facebook : chaque lien de produit doit afficher photo, prix et titre, et s'ouvrir vite en 3G.

## Pourquoi un seul langage

Avec deux développeurs, la capacité à se remplacer vaut plus que tout : le développeur backend peut
corriger un écran, le développeur mobile peut écrire une route. Les règles d'argent sont écrites une
fois (`packages/domain`) ; les applications réutilisent formatage des montants, validation des numéros, etc.

## Pourquoi pas Supabase comme backend

Supabase est excellent pour un CRUD rapide, mais le séquestre exige : idempotence, verrous explicites,
appels à l'agrégateur hors transaction, tâches de reprise, grand livre vérifié. Les écrire en fonctions
SQL/edge functions disperse la logique la plus critique. Supabase reste possible comme **hébergeur
PostgreSQL et stockage** (ADR-0010).

## Conséquences

- ➕ Recrutement plus large (JavaScript/TypeScript), outillage unique (pnpm, Vitest, Prettier).
- ➖ Le développeur mobile doit être à l'aise en React Native ; profil à vérifier dans les devis.
- Si le fondateur préfère Flutter pour Android, c'est compatible : seuls ADR-0007 et le partage de
  code mobile changent ; le web reste en Next.js.
