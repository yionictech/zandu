# ADR-0012 — Back-office : Next.js rendu serveur, sans kit d'administration, second facteur obligatoire

**Statut** : acceptée · **Date** : octobre 2026 · **Précise** : ADR-0006 (back-office) et ADR-0008 (TOTP)

## Contexte

L'ADR-0006 prévoyait un back-office Next.js « construit avec un kit d'administration (Refine,
React-Admin ou équivalent) ». En le construisant, il est apparu que le support n'a pas besoin
d'écrans de listes et de formulaires génériques : il a besoin de **files de travail** (boutiques à
vérifier, produits à modérer, livraisons à assigner, litiges, alertes) et de **décisions** qui
déclenchent des mouvements d'argent. Un compte support est aussi la cible la plus rentable pour un
fraudeur : il peut vérifier un faux vendeur ou rembourser un complice.

## Décision

1. `apps/backoffice` : Next.js 16 (App Router), **rendu serveur uniquement**. Chaque page lit l'API
   depuis le serveur du back-office ; chaque décision est une _server action_ (formulaire HTML) qui
   appelle une route d'action de l'API, journalisée. Pas de kit d'administration.
2. Le jeton de session de l'API reste **côté serveur**, dans un cookie `httpOnly`, `SameSite=Strict`,
   `Secure` en production. Aucun script du navigateur ne peut le lire.
3. **Second facteur TOTP obligatoire** pour les routes `/v1/support/*` et `/v1/admin/*`, vérifié par
   l'API pour chaque session (pas seulement par l'interface) : secret chiffré en base (AES-256-GCM),
   code à usage unique (anti-rejeu), 5 erreurs révoquent la session, réinitialisation par un
   administrateur (journalisée). Toujours exigé en production (`STAFF_MFA_REQUIRED` ne peut pas l'y
   désactiver).
4. En-têtes de sécurité : interdiction d'affichage en cadre, `Referrer-Policy: no-referrer` (les URL
   signées des pièces KYC ne fuient pas), pas d'indexation.
5. Domaine distinct (ex. `admin.zandu.cg`), filtré par IP ou VPN au lancement.

## Raisons

- Moins de code et de dépendances que React-Admin/Refine pour 8 écrans métier ; pas de JavaScript
  côté client hormis le menu et l'anti-double-envoi des boutons.
- La sécurité repose sur l'API, pas sur l'interface : un jeton volé sans le second facteur n'ouvre
  aucune route du personnel.
- Le client d'API typé (`@zandu/api-client`) est partagé avec l'application mobile : un changement de
  contrat casse la compilation des deux.

## Conséquences

- ➕ Toute action du support passe par les mêmes routes que les tests d'intégration couvrent.
- ➕ Un nouvel écran = une page serveur + un appel typé ; pas de configuration de kit.
- ➖ Pas de tri/filtre générique sur chaque colonne : on ajoute les filtres utiles au cas par cas.
- ➖ Premier enrôlement en « confiance au premier usage » : tant qu'un compte du personnel n'a pas
  configuré son second facteur, une session volée pourrait le faire à sa place. Procédure : l'agent
  configure son application **au moment même** où un administrateur lui donne le rôle ; ensuite,
  seule une réinitialisation par un administrateur permet de recommencer.
- ➖ `next build` ne vérifie pas les types (TypeScript 7 natif n'expose pas l'API attendue) :
  `pnpm typecheck` le fait, en CI.
