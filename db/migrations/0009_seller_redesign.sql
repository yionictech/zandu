-- Espace vendeur de la nouvelle direction visuelle (docs/ux/03 §3, étape 3).

-- 1. Ma boutique : ouverte ou en congé, préparation par défaut, horaires, ce qui est vendu,
--    nom du titulaire Mobile Money et acceptation des conditions vendeur.
ALTER TABLE seller_profiles
  -- En congé : les produits disparaissent du catalogue et ne peuvent plus être achetés.
  ADD COLUMN is_open boolean NOT NULL DEFAULT true,
  ADD COLUMN default_prep_minutes smallint NOT NULL DEFAULT 30
    CHECK (default_prep_minutes IN (15, 30, 60, 120)),
  ADD COLUMN opening_hours text CHECK (char_length(opening_hours) BETWEEN 3 AND 80),
  ADD COLUMN sold_category_ids uuid[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(sold_category_ids) <= 10),
  -- Comparé par le support au nom de la pièce d'identité lors de la vérification.
  ADD COLUMN payout_account_name text CHECK (char_length(payout_account_name) BETWEEN 2 AND 80),
  ADD COLUMN terms_accepted_at timestamptz;

-- 2. Produits : état (neuf, reconditionné, occasion) et seuil d'alerte de stock.
CREATE TYPE product_condition AS ENUM ('new', 'refurbished', 'used');
ALTER TABLE products
  ADD COLUMN condition product_condition NOT NULL DEFAULT 'new',
  ADD COLUMN low_stock_threshold smallint NOT NULL DEFAULT 2
    CHECK (low_stock_threshold BETWEEN 0 AND 1000);

-- 3. Commandes : heure promise à l'acceptation (« Prêt dans 30 min »).
ALTER TABLE orders ADD COLUMN ready_promised_at timestamptz;

-- 4. Avis : réponse publique du vendeur.
ALTER TABLE reviews
  ADD COLUMN seller_reply text CHECK (char_length(seller_reply) BETWEEN 2 AND 1000),
  ADD COLUMN seller_replied_at timestamptz;

-- 5. Litiges : réponse du vendeur, lue par le support avant de trancher.
CREATE TYPE dispute_seller_choice AS ENUM ('exchange', 'take_back_refund', 'contest');
ALTER TABLE disputes
  ADD COLUMN seller_choice dispute_seller_choice,
  ADD COLUMN seller_message text CHECK (char_length(seller_message) <= 1000),
  ADD COLUMN seller_responded_at timestamptz,
  ADD CHECK ((seller_choice IS NULL) = (seller_responded_at IS NULL));

CREATE INDEX reviews_seller ON reviews (seller_id, created_at DESC);
