# ADR-0010 — Hébergement portable, région choisie sur mesure

**Statut** : proposée · **Date** : octobre 2026

## Décision

- Tout est livré en **conteneurs Docker** ; PostgreSQL et stockage S3 **standards** : aucun service
  propriétaire dans le code.
- Production : PaaS de conteneurs + PostgreSQL managé avec PITR + stockage objet + CDN/pare-feu.
- La **région** est choisie après mesure de latence réelle depuis Pointe-Noire (MTN et Airtel) et avis
  juridique sur le transfert de données (loi 29-2019). Procédure : architecture §7.3.

## Conséquences

- ➕ Changer d'hébergeur = changer des variables d'environnement et une recette de déploiement.
- ➖ On renonce aux services très intégrés d'un fournisseur unique (volontaire).
