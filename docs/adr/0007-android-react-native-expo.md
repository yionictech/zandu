# ADR-0007 — Android en React Native + Expo

**Statut** : proposée · **Date** : octobre 2026

## Décision

Application Android unique (acheteur, vendeur, livreur selon le rôle) en **React Native + Expo**, moteur
Hermes, publiée en AAB découpé par architecture. Stockage local (SQLite/MMKV) pour le hors ligne.

## Raisons

- **Mises à jour à distance** (EAS Update) : corriger un écran sans faire retélécharger 15 Mo en 3G.
- Code TypeScript partagé avec le web et le backend (ADR-0002).
- Performances suffisantes sur Android 8+ d'entrée de gamme avec Hermes ; cible < 15 Mo installée.

## Alternatives

- **Flutter** : très bon choix aussi pour Android seul ; écarté pour l'unité de langage. Réversible.
- **PWA seule (TWA sur le Play Store)** : la plus légère, mais accès plus limité aux fonctions du
  téléphone (caméra en continu, notifications fiables sur certains appareils). Possible en plan B.

## Conséquences

- iOS (hors périmètre MVP) devient un simple build supplémentaire en V2.
