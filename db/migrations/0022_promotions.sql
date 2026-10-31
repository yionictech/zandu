-- Réductions et codes promo, accordés et payés par le vendeur.
--
-- 1. Prix barré : le vendeur baisse son prix pour un temps ; l'ancien prix est gardé
--    (compare_at_price, déjà prévu au schéma initial) et rétabli tout seul à la fin.
ALTER TABLE products ADD COLUMN sale_ends_at timestamptz;

-- 2. Code promo de boutique (« GRACE10 » : −10 % chez cette boutique). La remise baisse le
--    montant des articles de la commande : séquestre, commission et reversement restent justes.
CREATE TABLE shop_coupons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     uuid NOT NULL REFERENCES seller_profiles (id),
  code          text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{3,20}$'),
  percent       smallint NOT NULL CHECK (percent BETWEEN 5 AND 50),
  min_subtotal  bigint NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),
  max_uses      int CHECK (max_uses > 0),
  ends_at       timestamptz,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shop_coupons_seller ON shop_coupons (seller_id, created_at DESC);

ALTER TABLE orders ADD COLUMN coupon_id uuid REFERENCES shop_coupons (id);
ALTER TABLE orders ADD COLUMN discount_total bigint NOT NULL DEFAULT 0 CHECK (discount_total >= 0);
CREATE INDEX orders_coupon ON orders (coupon_id) WHERE coupon_id IS NOT NULL;

-- Remise répartie sur les lignes : line_total est le montant payé pour la ligne.
ALTER TABLE order_items ADD COLUMN discount bigint NOT NULL DEFAULT 0 CHECK (discount >= 0);
ALTER TABLE order_items DROP CONSTRAINT order_items_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_line_total_check
  CHECK (line_total = unit_price * quantity - discount AND line_total > 0);
