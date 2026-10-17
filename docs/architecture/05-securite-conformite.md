# 5. Sécurité, fraude et conformité

## 5.1 Ce qu'on protège, contre qui

| Actif                           | Menace principale                                        | Parade (✅ en place · ⏳ à faire)                                                                                  |
| ------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| L'argent en séquestre           | Faux webhook « paiement réussi »                         | ✅ Signature HMAC + horodatage ±5 min ; ⏳ liste blanche d'IP de l'agrégateur                                      |
|                                 | Double reversement (bug, rejeu, timeout)                 | ✅ Clés métier uniques au grand livre, vérification avant nouvelle tentative                                       |
|                                 | Détournement du numéro de reversement                    | ✅ Gel de 48 h après changement de numéro ; ⏳ re-vérification OTP pour le changer                                 |
|                                 | Faux vendeurs (risque n°1 du business plan)              | ✅ Séquestre + KYC avant tout reversement + plafond 30 jours + modération des non-vérifiés                         |
| Comptes utilisateurs            | Vol de session, force brute OTP                          | ✅ OTP 6 chiffres, 5 essais, 5 min ; jetons opaques révocables, stockés hachés                                     |
|                                 | « SMS pumping » (bots qui font envoyer des SMS surtaxés) | ✅ 1 code / 60 s et 5 / h par numéro, 30 / h par IP ; ⏳ CAPTCHA invisible au-delà de seuils                       |
| Données des autres utilisateurs | IDOR (lire la commande d'un autre en changeant l'id)     | ✅ Contrôle de propriété sur chaque route (404 sinon) ; tests dédiés                                               |
| Pièces d'identité (KYC)         | Fuite                                                    | ✅ Compartiment privé, URL signées de 5 min, consultation journalisée ; ⏳ chiffrement serveur                     |
| Le back-office                  | Prise de contrôle d'un compte support                    | ✅ Sessions de 12 h, TOTP obligatoire vérifié par l'API, jeton en cookie httpOnly ; ⏳ domaine séparé, IP filtrées |
| Intégrité des statuts           | Bug ou requête SQL manuelle                              | ✅ Trigger de transitions, tables en écriture seule, audit                                                         |
| Disponibilité                   | Déni de service, bots                                    | ⏳ CDN + pare-feu applicatif + limitation de débit en bordure                                                      |

## 5.2 Exigences du cahier §7 — réponse

| Domaine          | Exigence                                                         | Réponse                                                                                             |
| ---------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Authentification | Code SMS ; double authentification vendeurs, support, admin      | ✅ OTP SMS. Staff : TOTP obligatoire ✅ (ADR-0012). Vendeurs : OTP pour les actions sensibles (⏳). |
| Données          | TLS ; chiffrement au repos ; KYC dans un stockage séparé         | TLS 1.2+ partout ; disques et sauvegardes chiffrés (hébergeur) ; KYC compartiment privé.            |
| Application      | Injections, limitation de débit, validation des entrées          | ✅ Requêtes paramétrées uniquement ; validation zod de toutes les entrées ; ⏳ débit en bordure.    |
| Paiement         | Aucune donnée de portefeuille au-delà du numéro ; clés en coffre | ✅ Seuls numéro et opérateur sont stockés ; secrets par variables d'environnement issues du coffre. |
| Conformité       | Audit, KYC, conservation des pièces, données personnelles        | ✅ Journal d'audit en écriture seule ; ⏳ politique de conservation (voir 5.4).                     |
| Tests            | Tests automatiques paiement/séquestre ; audit externe            | ✅ 157 tests + 4 parcours de bout en bout ; ⏳ audit de sécurité externe semaines 13-14.            |

## 5.3 Règles anti-fraude du MVP

1. **Séquestre systématique** : aucun vendeur n'est payé avant la remise au client (code de remise) et la fin de la fenêtre de litige.
2. **Vendre avant d'être vérifié, encaisser après** : un vendeur non vérifié peut publier (modération a priori) et vendre, mais rien ne lui est reversé avant validation KYC.
3. **Plafond des 30 premiers jours** : 150 000 FCFA reversés par 24 h (paramétrable par vendeur).
4. **Gel de 48 h** après changement du numéro de reversement.
5. **Messagerie filtrée** : numéros, liens et e-mails masqués (évite la vente hors plateforme, donc sans protection).
6. **Code de remise** : 6 chiffres, envoyé par SMS à l'acheteur seulement, 5 essais côté livreur puis verrouillage.
7. **Alertes** (⏳ tableau de bord) : nouveau compte avec gros montant, vendeur au taux de litige > 5 %, pics de remboursements, écarts de rapprochement.

## 5.4 Conformité réglementaire (à valider par un juriste local)

| Sujet                               | Référence                                                                                                                                                                            | Position d'architecture                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Services de paiement                | Règlement n° 04/18/CEMAC/UMAC/COBAC (en vigueur depuis le 1er janvier 2019) : seuls banques, microfinances et établissements de paiement agréés fournissent des services de paiement | Zandu **ne détient pas les fonds** : l'agrégateur agréé les détient ; Zandu tient un registre et donne des ordres. **À confirmer par écrit** avec un juriste et l'agrégateur. |
| Données personnelles                | Loi n° 29-2019 du 10 octobre 2019 (Congo) : principes proches du RGPD, droits d'accès, rectification, effacement ; autorité prévue (CPDCP)                                           | Minimisation (numéro, nom, adresse par repères) ; export et suppression de compte (⏳) ; politique de conservation ; déclaration à l'autorité dès qu'elle est opérationnelle. |
| Conservation KYC / anti-blanchiment | Obligations de vigilance                                                                                                                                                             | Pièces conservées dans le compartiment privé pendant la durée légale à préciser ; accès journalisés.                                                                          |
| Facturation                         | TVA sur commissions, facturation électronique (SFEC)                                                                                                                                 | La commission est isolée au grand livre (`revenue:commission`) : export comptable direct ; taux de TVA à paramétrer.                                                          |
| Hébergement hors du Congo           | Transferts de données                                                                                                                                                                | À valider avant le choix de la région (ADR-0010).                                                                                                                             |

## 5.5 Avant le lancement (checklist sécurité)

- [ ] Audit de sécurité externe (test d'intrusion API + applications) : aucune faille critique ou élevée.
- [x] TOTP obligatoire pour support et admin (vérifié par l'API, anti-rejeu, révocation après 5 erreurs).
- [ ] Back-office sur domaine séparé, filtré par IP ou VPN (prêt : `BACKOFFICE_ALLOWED_IPS`, ADR-0013 ;
      reste à fournir les adresses du bureau).
- [x] Aucune route de test en production : simulateur refusé au démarrage ; en recette, SMS de test
      lisibles seulement avec `RECETTE_KEY` (ADR-0013).
- [x] Stockage vérifié avant chaque démarrage : pièces d'identité illisibles sans URL signée.
- [ ] Rôle PostgreSQL applicatif **non superutilisateur**, sans droit `UPDATE/DELETE` sur `ledger_*` et `audit_logs`.
- [ ] Secrets dans le coffre de l'hébergeur ; rotation documentée de `APP_SECRET` et des clés agrégateur.
- [ ] Restauration de sauvegarde testée (point-in-time) et chronométrée.
- [ ] Purge des payloads de l'outbox traités après 30 jours (contiennent des codes de remise).
- [ ] Pare-feu applicatif et limitation de débit en bordure (CDN).
