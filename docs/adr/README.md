# Décisions d'architecture (ADR)

Chaque décision structurante est consignée ici : contexte, décision, conséquences. Une décision n'est
jamais effacée ; si on change d'avis, on écrit un nouvel ADR qui « remplace » l'ancien.

| N°   | Décision                                                                                           | Statut   |
| ---- | -------------------------------------------------------------------------------------------------- | -------- |
| 0001 | [Monolithe modulaire plutôt que microservices](0001-monolithe-modulaire.md)                        | Acceptée |
| 0002 | [TypeScript de bout en bout](0002-typescript-de-bout-en-bout.md)                                   | Acceptée |
| 0003 | [PostgreSQL unique : données, grand livre, file, recherche](0003-postgresql-unique.md)             | Acceptée |
| 0004 | [Agrégateur derrière un port ; séquestre = règle de statuts](0004-agregateur-et-sequestre.md)      | Acceptée |
| 0005 | [Grand livre en partie double, en écriture seule](0005-grand-livre-partie-double.md)               | Acceptée |
| 0006 | [Web en Next.js avec rendu serveur et PWA](0006-web-nextjs-ssr-pwa.md)                             | Proposée |
| 0007 | [Android en React Native + Expo](0007-android-react-native-expo.md)                                | Acceptée |
| 0008 | [Connexion par OTP et sessions opaques révocables](0008-otp-et-sessions.md)                        | Acceptée |
| 0009 | [Tâches de fond : échéances en base, balayeurs, outbox](0009-taches-de-fond.md)                    | Acceptée |
| 0010 | [Hébergement portable, région choisie sur mesure](0010-hebergement.md)                             | Proposée |
| 0011 | [Une commande par vendeur, un paiement par panier](0011-une-commande-par-vendeur.md)               | Acceptée |
| 0012 | [Back-office : rendu serveur, sans kit d'admin, second facteur](0012-back-office-rendu-serveur.md) | Acceptée |
