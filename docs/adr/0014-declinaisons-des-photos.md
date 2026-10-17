# ADR-0014 — Photos produits déclinées par le worker

**Statut** : acceptée · **Date** : octobre 2026

## Contexte

L'application compresse chaque photo avant l'envoi (1600 px, JPEG). Sur de vraies photos de marché
prises au téléphone, cela donne **422 Ko en moyenne**. Ces originaux étaient servis tels quels partout :
une page d'accueil de 12 produits pesait **5,2 Mo** et ses premières photos apparaissaient en 3G
après **54 secondes**. Les originaux gardent aussi ce que le téléphone y a mis (orientation, parfois
la position GPS), et rien ne vérifiait qu'un fichier annoncé comme JPEG en était un.

## Décision

1. Le **worker** décline chaque photo produit dès qu'elle est rattachée (tâche `processProductMedia`,
   même modèle que les autres balayeurs : verrou de ligne, idempotent, plusieurs instances possibles) :

   | Déclinaison | Taille (bord le plus long) | Format  | Usage                          | Vraies photos |
   | ----------- | -------------------------- | ------- | ------------------------------ | ------------- |
   | `thumb`     | 320 px                     | WebP 70 | listes, panier, espace vendeur | ≈ 18 Ko       |
   | `large`     | 800 px                     | WebP 75 | fiche produit, modération      | ≈ 94 Ko       |
   | `share`     | 1200 px                    | JPEG 80 | aperçus WhatsApp / Facebook    | ≈ 210 Ko      |

   Tailles choisies sur l'écran réel : une tuile mesure ~160 px de large sur un écran ×2 ; la photo de
   la fiche ~360 px de haut. Le JPEG de partage existe parce que tous les aperçus de lien ne lisent
   pas le WebP. Jamais d'agrandissement.

2. Chaque déclinaison est **entièrement réencodée** : orientation appliquée, métadonnées supprimées
   (GPS, modèle d'appareil), couleurs en sRGB. Un fichier qui ne se décode pas (page HTML, texte,
   fichier tronqué) est marqué `invalid` et **n'est jamais affiché** ; au-delà de 40 mégapixels, refus.
3. L'API sert les déclinaisons sans changer ses champs : `coverImage` devient la vignette,
   `media[].url` la grande image, et `shareImage` (nouveau) le JPEG de partage. Tant que le worker
   n'est pas passé (quelques secondes), ou s'il échoue durablement, **l'original** reste affiché :
   jamais de trou dans la grille.
4. Les déclinaisons sont écrites à côté de l'original, avec la taille dans le nom
   (`…-thumb320.webp`), et servies avec `Cache-Control: immutable` sur un an. Changer un réglage
   change le nom ; `node dist/cli/reprocess-media.js` remet en file les photos à refaire.
5. Le traitement utilise `sharp` (libvips), dans le worker seulement : l'API ne décode aucune image.

## Mesures (recette en conteneurs, 3G simulée 750 kbit/s, 300 ms, cache vide)

| Page (12 vraies photos de téléphone)   | Avant    | Après      |
| -------------------------------------- | -------- | ---------- |
| Accueil : poids total                  | 5 232 Ko | **358 Ko** |
| Accueil : 4 premières photos affichées | 54,1 s   | **3,5 s**  |
| Accueil : chargement complet           | 56,7 s   | **4,6 s**  |
| Fiche produit : poids total            | 551 Ko   | **236 Ko** |
| Fiche produit : photo affichée         | 6,6 s    | **3,2 s**  |

Les deux pages tiennent leur budget de poids (accueil 400 Ko, fiche 300 Ko, architecture §6.2).

## Conséquences

- ➕ Données mobiles divisées par 14 sur l'accueil : moins cher pour l'acheteur, page utilisable en 3G.
- ➕ Plus de métadonnées personnelles ni de faux fichiers image servis au public.
- ➕ Rien à changer dans les applications : les adresses changent, pas les champs.
- ➖ Trois fichiers de plus par photo dans le stockage (≈ 320 Ko pour un original de 420 Ko).
- ➖ L'original reste dans le compartiment public, à une adresse aléatoire qui n'est plus diffusée.
  Le déplacer vers le compartiment privé est possible plus tard sans changer l'API.
- ➖ Quelques secondes après l'ajout d'une photo, c'est l'original qui s'affiche.

## Options écartées

- **Redimensionnement à la volée** (imgproxy, service de l'hébergeur) : un service de plus à opérer et
  à protéger ; le choix du CDN dépend de D12. Les déclinaisons fixes suffisent au catalogue.
- **Vignette produite par le téléphone** : rien ne garantit qu'elle corresponde à l'original, et les
  photos déjà en ligne n'en auraient pas.
- **Next.js `next/image`** : ne concerne que le site, pas l'application Android, et ferait du serveur
  web un serveur d'images.
