-- Espace livreur de la nouvelle direction visuelle (docs/ux/03 §3, étape 5), dans le modèle
-- actuel : livreurs partenaires, courses attribuées par le support (§4.1).

-- 1. Retour au vendeur : cliente absente ou colis refusé, le livreur rapporte le colis.
ALTER TYPE delivery_status ADD VALUE IF NOT EXISTS 'returning' AFTER 'at_pickup_point';

-- 2. Codes à 4 chiffres montrés par le livreur, saisis par le vendeur : retrait (le bon livreur
--    prend le colis) et retour (le vendeur a bien récupéré son colis). Ils ne déplacent pas
--    d'argent : en clair, pour être affichés au livreur.
ALTER TABLE deliveries
  ADD COLUMN pickup_code text CHECK (pickup_code ~ '^[0-9]{4}$'),
  ADD COLUMN pickup_confirmed_at timestamptz,
  -- Arrivée chez le client (livraison à domicile) : départ de l'attente avant « absente ».
  ADD COLUMN arrived_at timestamptz,
  ADD COLUMN return_code text CHECK (return_code ~ '^[0-9]{4}$'),
  ADD COLUMN return_confirmed_at timestamptz,
  ADD COLUMN returned_at timestamptz;

-- 3. Journal de la course : arrivée, appels et SMS au client, absence, refus, incident, retour.
CREATE TABLE delivery_events (
  id           bigserial PRIMARY KEY,
  delivery_id  uuid NOT NULL REFERENCES deliveries (id),
  kind         text NOT NULL
    CHECK (kind IN ('arrived', 'call', 'sms', 'absent', 'refused', 'incident', 'returned')),
  -- Incident : panne, accident, colis pas prêt, colis abîmé, autre.
  incident     text CHECK (incident IN ('breakdown', 'accident', 'not_ready', 'damaged', 'other')),
  note         text CHECK (char_length(note) <= 500),
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'incident') = (incident IS NOT NULL))
);
CREATE INDEX delivery_events_delivery ON delivery_events (delivery_id, id);
CREATE INDEX delivery_events_recent ON delivery_events (created_at) WHERE kind IN ('incident', 'absent', 'refused');
