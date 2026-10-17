# 2. Modules et traçabilité des exigences

## 2.1 Organisation du dépôt

```
zandu/
├── packages/domain/        Règles métier PURES (aucune dépendance : ni base, ni réseau, ni framework)
│   └── src/                money · phone · commission · order-machine · payment-machine
│                           ledger · payout-policy · chat-filter
├── apps/api/               Backend : API HTTP (main.ts) + worker (worker.ts), même code
│   └── src/
│       ├── modules/        Un dossier par domaine fonctionnel (voir 2.2)
│       ├── jobs/           Balayeurs exécutés par le worker
│       ├── db/             Pool, transactions, migrations, données de référence
│       └── lib/            Erreurs HTTP, crypto, horloge, idempotence
├── db/migrations/          SQL versionné, appliqué dans l'ordre (jamais modifié une fois en production)
├── db/seeds/               Données de référence (zones, tarifs, catégories, commissions)
└── docs/                   Ce dossier d'architecture
```

```
├── packages/api-client/    Client HTTP typé, GÉNÉRÉ depuis docs/api/openapi.yaml (pnpm generate)
└── apps/mobile/            Application Android (Expo / React Native, expo-router)
    ├── app/                Un fichier par écran : acheteur (accueil, recherche, produit, panier,
    │                       livraison, paiement, commandes, litige, compte, connexion),
    │   ├── vendeur/        boutique, tableau de bord, commandes, produits, argent, vérification
    │   └── livreur/        missions, remise avec code
    ├── src/                Session, panier, client d'API, envoi de photos (compression), thème,
    │                       composants, textes (i18n/fr.ts)
    └── e2e/                Parcours acheteur, vendeur et livreur de bout en bout (Chromium, web)
├── apps/web/               Site acheteurs (Next.js, rendu serveur, ADR-0006)
│   ├── src/app/            Accueil, recherche, fiche produit (Open Graph + JSON-LD), boutique,
│   │                       panier, connexion, livraison, paiement, suivi ; manifeste PWA, plan du site
│   └── e2e/                Parcours d'achat de bout en bout + budget de performance en 3G
└── apps/backoffice/        Back-office du support (Next.js, rendu serveur, ADR-0012)
    ├── src/app/connexion/  SMS puis second facteur TOTP (QR code à la première connexion)
    ├── src/app/(console)/  Tableau de bord, vérifications, modération, livraisons, litiges,
    │                       commandes, alertes, comptabilité
    └── e2e/                Parcours du support de bout en bout
```

À venir : espace vendeur sur le web (aujourd'hui dans l'application Android).

## 2.2 Modules du monolithe

| Module          | Responsabilité                                                             | Tables possédées (écriture)                                 |
| --------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `auth`          | OTP, sessions, rôles, second facteur TOTP du personnel, gardes d'accès     | users, otp_challenges, sessions, user_mfa                   |
| `catalog`       | Boutiques, produits, recherche, zones de livraison (lecture)               | seller_profiles, products, product_media, categories        |
| `checkout`      | Panier → checkout → une commande par vendeur, réservation du stock         | checkouts, orders (création), order_items                   |
| `orders`        | **Seul point d'évolution d'une commande** + livraison + litiges            | orders (statut), order_status_history, deliveries, disputes |
| `payments`      | Collecte Mobile Money, webhooks, interrogation, expiration, remboursements | payments, provider_events, refunds                          |
| `payouts`       | Reversements vendeurs, moteur commun des sorties d'argent                  | payouts                                                     |
| `ledger`        | Grand livre : écriture idempotente, soldes                                 | ledger_accounts, ledger_transactions, ledger_entries        |
| `notifications` | Outbox → notifications → WhatsApp/SMS                                      | outbox_events, notifications                                |
| `admin`         | Vérification vendeurs, modération, audit, contrôles comptables             | audit_logs, commission_rules, platform_settings             |
| `support`       | Files du back-office, recherche de commandes, alertes (lecture seule)      | — (lit les autres modules ; agit via leurs routes)          |

**Règles de dépendance**

1. `packages/domain` ne dépend de rien. Tout calcul d'argent ou décision de statut y vit.
2. Un module n'écrit que dans **ses** tables ; pour agir sur un autre domaine il appelle **son service**
   (ex. `payments` appelle `applyOrderEvent` de `orders`, jamais `UPDATE orders SET status`).
   Les lectures croisées en SQL sont permises pour construire des vues.
3. Les routes HTTP ne contiennent pas de règle métier : validation (zod), contrôle d'accès, appel de service.
4. Toute écriture comptable passe par `postJournal` avec une écriture produite par `packages/domain/ledger.ts`.

## 2.3 Traçabilité des exigences du cahier des charges

| Réf. | Exigence (priorité)                                           | Où                                                                     | État dans ce dépôt                                                                               |
| ---- | ------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| F1   | Inscription / connexion par code SMS (P1)                     | `auth`                                                                 | ✅ OTP, limites anti-fraude, sessions révocables                                                 |
| F2   | Vérification du vendeur (P1)                                  | `seller` (pièces), `uploads`, `admin` (file, consultation, décision)   | ✅ API + écran vendeur + écran de décision du back-office                                        |
| F3   | Création d'un produit, 6 photos (P1)                          | `seller`, `uploads` (URL signées)                                      | ✅ API + écran « photo d'abord » (compression, brouillon) ; miniatures serveur ⏳                |
| F4   | Recherche, filtres, tri (P1)                                  | `catalog`                                                              | ✅ plein texte FR sans accents + fautes de frappe                                                |
| F5   | Variantes et promotions (P2)                                  | `products.compare_at_price`                                            | ⏳ V2 (migration `product_variants` prévue)                                                      |
| F6   | Panier, adresse, domicile / point relais (P1)                 | `checkout`                                                             | ✅ multi-vendeurs, adresse par repères                                                           |
| F7   | Paiement MTN / Airtel, séquestre (P1)                         | `payments`, `ledger`                                                   | ✅ avec simulateur ; adaptateur agrégateur réel ⏳                                               |
| F8   | Reversement automatique, commission déduite (P1)              | `orders` → `payouts`                                                   | ✅ avec plafonds nouveaux vendeurs                                                               |
| F9   | Remboursement total ou partiel (P1)                           | `orders`, `payments/refunds`                                           | ✅                                                                                               |
| F10  | Tarif par zone, livreur, code de remise (P1)                  | `checkout`, `orders`                                                   | ✅ dont écran livreur (missions, pavé du code de remise)                                         |
| F11  | Avis réservés aux acheteurs livrés (P1)                       | `orders` (`/v1/order-items/{id}/review`), `catalog` (lecture)          | ✅ API + écran de notation dans l'application                                                    |
| F12  | Litige sous 48 h avec photos (P1)                             | `orders`, `uploads`                                                    | ✅ API (litige, photos, file support) ; écran de litige ✅ (photos dans l'app ⏳)                |
| F13  | Messagerie filtrée (P2)                                       | `domain/chat-filter`, tables `conversations`, `messages`               | 🟡 filtre ✅ ; endpoints + temps réel ⏳                                                         |
| F14  | Notifications SMS et WhatsApp (P1)                            | `notifications`                                                        | 🟡 outbox + modèles ✅ ; adaptateur fournisseur réel ⏳                                          |
| F15  | Tableau de bord vendeur (P1)                                  | `seller` (`/v1/seller/balance`, produits, aperçu commission), `orders` | ✅ API + écrans (à traiter, mon argent) ; statistiques de ventes ⏳                              |
| F16  | Back-office : modération, comptes, commissions, rapports (P1) | `admin`, `support`, `orders` (support), `apps/backoffice`              | 🟡 files, décisions, recherche, alertes, comptabilité ✅ ; commissions et rapports ⏳            |
| F17  | Journal d'audit (P1)                                          | `admin/audit`, table `audit_logs`                                      | ✅ écriture seule, verrouillé en base ; consultations KYC et preuves, second facteur journalisés |

Légende : ✅ fait et testé · 🟡 partiel · ⏳ à faire.
