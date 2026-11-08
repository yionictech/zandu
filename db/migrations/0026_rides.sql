-- Moto-taxi : une course est une commande de type « ride » (comme un envoi de colis, sans
-- articles) : le passager paie avant de partir, en séquestre ; le conducteur (livreur Zandu)
-- est payé à la fin de la course. Les livreurs peuvent aussi accepter eux-mêmes les courses et
-- les envois disponibles (sans attendre le support).
--
-- La nouvelle valeur d'énumération n'est pas utilisée dans ce fichier (une seule transaction).
ALTER TYPE order_kind ADD VALUE IF NOT EXISTS 'ride';

-- Les contraintes ne visent plus « parcel » seul mais tout ce qui n'est pas un achat.
ALTER TABLE orders DROP CONSTRAINT orders_parcel_fields;
ALTER TABLE orders ADD CONSTRAINT orders_errand_fields CHECK (
  kind = 'shop'
  OR (pickup_zone_id IS NOT NULL AND pickup_address IS NOT NULL
      AND commission_total = 0 AND delivery_mode = 'home'
      AND (kind <> 'parcel' OR (parcel IS NOT NULL AND items_subtotal = 0)))
);
ALTER TABLE orders DROP CONSTRAINT orders_items_subtotal_check;
ALTER TABLE orders ADD CONSTRAINT orders_items_subtotal_check
  CHECK (items_subtotal > 0 OR (kind <> 'shop' AND items_subtotal = 0));

-- Trajet d'une course : distance à vol d'oiseau et temps estimé, au moment de la commande.
ALTER TABLE orders ADD COLUMN trip jsonb;

DROP INDEX orders_parcels;
CREATE INDEX orders_errands ON orders (buyer_id, kind, created_at DESC) WHERE kind <> 'shop';
