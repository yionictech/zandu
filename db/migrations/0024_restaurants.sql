-- Repas et restaurants.
--
-- 1. Une boutique peut être un restaurant (plats préparés) : rayon « Repas » de l'application,
--    acceptation en 15 minutes, « ouvert maintenant » selon ses horaires.
ALTER TABLE seller_profiles ADD COLUMN shop_type text NOT NULL DEFAULT 'shop'
  CHECK (shop_type IN ('shop', 'restaurant'));
CREATE INDEX seller_profiles_restaurants ON seller_profiles (city) WHERE shop_type = 'restaurant';

-- 2. Options d'un plat : jusqu'à 3 choix obligatoires (« Taille », « Accompagnement »…), chacun
--    avec ses propositions et leur supplément :
--    [{"name": "Accompagnement", "choices": [{"label": "Alloco", "extra": 0}, …]}]
ALTER TABLE products ADD COLUMN options jsonb
  CHECK (options IS NULL OR (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) <= 3));

-- 3. Choix figés dans la commande ; unit_price comprend déjà les suppléments.
--    [{"group": "Accompagnement", "choice": "Alloco", "extra": 0}]
ALTER TABLE order_items ADD COLUMN options jsonb;

-- 4. Rayon « Repas et boissons » (aussi dans db/seeds/reference.sql).
INSERT INTO categories (id, parent_id, slug, name, position) VALUES
  ('10000000-0000-4000-8000-000000000008', NULL, 'repas', 'Repas et boissons', 6)
ON CONFLICT DO NOTHING;
