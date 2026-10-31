-- Statistiques vendeur : vues des fiches produits, comptées par jour (heure de Brazzaville).
-- Aucune donnée sur la personne qui regarde : seulement un compteur.
CREATE TABLE product_view_days (
  product_id  uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  day         date NOT NULL,
  views       int NOT NULL DEFAULT 0 CHECK (views >= 0),
  PRIMARY KEY (product_id, day)
);
