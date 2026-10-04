# ADR-0008 — Connexion par OTP et sessions opaques révocables

**Statut** : acceptée · **Date** : octobre 2026

## Décision

- Connexion par **numéro de téléphone + code à 6 chiffres** (SMS ; WhatsApp en option plus tard).
  Code stocké sous forme d'empreinte HMAC, valable 5 min, 5 essais, limites par numéro et par IP.
- **Jetons de session opaques** (32 octets aléatoires), stockés hachés en base, révocables
  individuellement ; 30 jours pour les clients, 12 h pour le support et les administrateurs.
- Second facteur TOTP obligatoire pour support/admin ; confirmation OTP pour les actions vendeur sensibles.

## Raisons

Pas de mot de passe à oublier, adapté au Mobile Money (le numéro est l'identité). Des jetons opaques
plutôt que des JWT : révocation immédiate en cas de vol de téléphone, sans liste noire.

## Conséquences

- ➖ Une requête base par appel authentifié (négligeable à notre échelle ; cache possible plus tard).
- ➖ Coût SMS par connexion : sessions longues côté client pour le limiter.
