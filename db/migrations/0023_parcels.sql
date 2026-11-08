-- Envoi de colis entre particuliers, avec les livreurs Zandu.
--
-- Un envoi est une commande de type « parcel » : même paiement en séquestre, même livraison
-- (livreur assigné, code de retrait, code de remise, suivi sur la carte, messagerie, appels),
-- même litige. L'expéditeur est l'« acheteur » (il paie) ; le destinataire n'a pas besoin de
-- compte : il reçoit le code de remise par SMS. Il n'y a pas d'articles : le montant est
-- entièrement des frais de livraison (part livreur + marge Zandu).
--
-- La commande est rattachée à une boutique de la plateforme (« Zandu Envois »,
-- seller_profiles.is_platform) créée au premier envoi : aucune requête existante ne perd ces
-- commandes, et aucun vendeur ne les voit.

CREATE TYPE order_kind AS ENUM ('shop', 'parcel');

ALTER TABLE seller_profiles ADD COLUMN is_platform boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX seller_profiles_one_platform ON seller_profiles (is_platform) WHERE is_platform;

ALTER TABLE orders ADD COLUMN kind order_kind NOT NULL DEFAULT 'shop';
-- Où le livreur enlève le colis : quartier, repère, téléphone, repère sur la carte.
ALTER TABLE orders ADD COLUMN pickup_zone_id uuid REFERENCES delivery_zones (id);
ALTER TABLE orders ADD COLUMN pickup_address jsonb;
-- Ce que contient l'envoi : taille (small, medium, large) et description courte.
ALTER TABLE orders ADD COLUMN parcel jsonb;
ALTER TABLE orders ADD CONSTRAINT orders_parcel_fields CHECK (
  kind = 'shop'
  OR (pickup_zone_id IS NOT NULL AND pickup_address IS NOT NULL AND parcel IS NOT NULL
      AND items_subtotal = 0 AND commission_total = 0 AND delivery_mode = 'home')
);
ALTER TABLE orders DROP CONSTRAINT orders_items_subtotal_check;
ALTER TABLE orders ADD CONSTRAINT orders_items_subtotal_check
  CHECK (items_subtotal > 0 OR (kind = 'parcel' AND items_subtotal = 0));
ALTER TABLE orders ADD CONSTRAINT orders_total_positive CHECK (total > 0);
CREATE INDEX orders_parcels ON orders (buyer_id, created_at DESC) WHERE kind = 'parcel';

ALTER TABLE checkouts DROP CONSTRAINT checkouts_items_total_check;
ALTER TABLE checkouts ADD CONSTRAINT checkouts_items_total_check CHECK (items_total >= 0);
ALTER TABLE checkouts ADD CONSTRAINT checkouts_grand_total_positive CHECK (grand_total > 0);

-- Envoi payé : prêt à être enlevé, sans acceptation d'un vendeur. L'expéditeur peut annuler
-- tant que le livreur n'a pas le colis (ready_for_pickup -> cancelled existe déjà).
INSERT INTO order_status_transitions (from_status, to_status) VALUES ('paid', 'ready_for_pickup');
