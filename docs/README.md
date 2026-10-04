# Dossier d'architecture Zandu

## Par où commencer

| Vous êtes…                            | Lisez dans cet ordre                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fondateur**                         | [Vue d'ensemble](architecture/01-vue-d-ensemble.md) → [Décisions à prendre](produit/decisions-a-prendre.md) → [Feuille de route](produit/feuille-de-route-16-semaines.md) → [Principes UX](ux/01-principes-experience.md) |
| **Prestataire qui chiffre le projet** | Vue d'ensemble → [Modules et traçabilité](architecture/02-modules.md) → [Feuille de route](produit/feuille-de-route-16-semaines.md) → [Contrat d'API](api/openapi.yaml)                                                   |
| **Développeur backend**               | [Guide du développeur](developpement.md) → [Paiement et séquestre](architecture/03-paiement-sequestre-grand-livre.md) → [Données](architecture/04-modele-de-donnees.md) → [ADR](adr/README.md)                            |
| **Développeur mobile / web**          | Guide du développeur → [Parcours et écrans](ux/02-parcours-et-ecrans.md) → [Contrat d'API](api/openapi.yaml) → [Performance](architecture/06-exigences-non-fonctionnelles.md)                                             |
| **Designer**                          | [Principes UX](ux/01-principes-experience.md) → [Parcours et écrans](ux/02-parcours-et-ecrans.md)                                                                                                                         |
| **Auditeur sécurité**                 | [Sécurité et conformité](architecture/05-securite-conformite.md) → Paiement et séquestre                                                                                                                                  |

## Sommaire

**Architecture**

1. [Vue d'ensemble](architecture/01-vue-d-ensemble.md) — principes, contexte, conteneurs, choix technologiques
2. [Modules et traçabilité](architecture/02-modules.md) — organisation du code, exigences F1-F17
3. [Paiement, séquestre, grand livre](architecture/03-paiement-sequestre-grand-livre.md) — le cœur du produit
4. [Modèle de données](architecture/04-modele-de-donnees.md)
5. [Sécurité, fraude, conformité](architecture/05-securite-conformite.md)
6. [Exigences non fonctionnelles](architecture/06-exigences-non-fonctionnelles.md) — performance, hors ligne, supervision
7. [Infrastructure et déploiement](architecture/07-infrastructure-deploiement.md)

**Décisions** — [ADR 0001 à 0011](adr/README.md)

**Expérience utilisateur** — [Principes](ux/01-principes-experience.md) · [Parcours et écrans](ux/02-parcours-et-ecrans.md)

**Produit** — [Feuille de route 16 semaines](produit/feuille-de-route-16-semaines.md) · [Décisions à prendre](produit/decisions-a-prendre.md)

**API** — [Contrat OpenAPI](api/openapi.yaml) · [Guide du développeur](developpement.md)
