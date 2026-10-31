-- Avis sur le livreur : après la remise à domicile, l'acheteur note la course (une fois par
-- commande). La note moyenne est vue par le livreur, sa société de livraison et le support ;
-- une mauvaise note prévient le support.
CREATE TABLE rider_reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL UNIQUE REFERENCES orders (id),
  rider_id    uuid NOT NULL REFERENCES riders (id),
  buyer_id    uuid NOT NULL REFERENCES users (id),
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  tags        text[] NOT NULL DEFAULT '{}' CHECK (
    tags <@ ARRAY['ponctuel', 'poli', 'soigneux', 'en_retard', 'impoli', 'colis_abime']::text[]),
  comment     text CHECK (char_length(comment) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rider_reviews_rider ON rider_reviews (rider_id, created_at DESC);
