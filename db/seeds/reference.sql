-- Données de référence de démarrage (Pointe-Noire puis Brazzaville).
-- Tarifs et commissions = hypothèses du business plan, à ajuster par le back-office.

INSERT INTO categories (id, parent_id, slug, name, position) VALUES
  ('10000000-0000-4000-8000-000000000001', NULL, 'electronique', 'Électronique', 1),
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'telephones', 'Téléphones et accessoires', 1),
  ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'informatique', 'Informatique', 2),
  ('10000000-0000-4000-8000-000000000004', NULL, 'mode', 'Mode', 2),
  ('10000000-0000-4000-8000-000000000005', NULL, 'beaute', 'Beauté et soins', 3),
  ('10000000-0000-4000-8000-000000000006', NULL, 'maison', 'Maison et électroménager', 4),
  ('10000000-0000-4000-8000-000000000007', NULL, 'alimentation', 'Alimentation et produits locaux', 5)
ON CONFLICT DO NOTHING;

-- Commission : 10 % par défaut, 8 % électronique (faible marge), 12 % mode et beauté.
INSERT INTO commission_rules (scope, category_id, rate_bps, valid_from, note) VALUES
  ('default',  NULL,                                   1000, '2026-01-01', 'Taux par défaut'),
  ('category', '10000000-0000-4000-8000-000000000001',  800, '2026-01-01', 'Électronique'),
  ('category', '10000000-0000-4000-8000-000000000004', 1200, '2026-01-01', 'Mode'),
  ('category', '10000000-0000-4000-8000-000000000005', 1200, '2026-01-01', 'Beauté');

-- Arrondissements de Pointe-Noire et de Brazzaville.
INSERT INTO delivery_zones (id, city, name) VALUES
  ('20000000-0000-4000-8000-000000000001', 'Pointe-Noire', 'Lumumba (Centre-ville)'),
  ('20000000-0000-4000-8000-000000000002', 'Pointe-Noire', 'Mvoumvou'),
  ('20000000-0000-4000-8000-000000000003', 'Pointe-Noire', 'Tié-Tié'),
  ('20000000-0000-4000-8000-000000000004', 'Pointe-Noire', 'Loandjili'),
  ('20000000-0000-4000-8000-000000000005', 'Pointe-Noire', 'Mongo-Mpoukou'),
  ('20000000-0000-4000-8000-000000000006', 'Pointe-Noire', 'Ngoyo'),
  ('20000000-0000-4000-8000-000000000011', 'Brazzaville', 'Makélékélé'),
  ('20000000-0000-4000-8000-000000000012', 'Brazzaville', 'Bacongo'),
  ('20000000-0000-4000-8000-000000000013', 'Brazzaville', 'Poto-Poto'),
  ('20000000-0000-4000-8000-000000000014', 'Brazzaville', 'Moungali'),
  ('20000000-0000-4000-8000-000000000015', 'Brazzaville', 'Ouenzé'),
  ('20000000-0000-4000-8000-000000000016', 'Brazzaville', 'Talangaï')
ON CONFLICT DO NOTHING;

-- Tarifs intra-ville : 1 000 FCFA dans le même arrondissement, 1 500 sinon ; point relais 700.
-- La part livreur est ~87 % du tarif (marge plateforme 10 à 15 %, business plan §6).
INSERT INTO delivery_rates (from_zone_id, to_zone_id, mode, price, courier_share)
SELECT f.id, t.id, m.mode,
       CASE WHEN m.mode = 'pickup_point' THEN 700 WHEN f.id = t.id THEN 1000 ELSE 1500 END,
       CASE WHEN m.mode = 'pickup_point' THEN 600 WHEN f.id = t.id THEN 870 ELSE 1300 END
FROM delivery_zones f
JOIN delivery_zones t ON t.city = f.city
CROSS JOIN (VALUES ('home'::delivery_mode), ('pickup_point'::delivery_mode)) AS m(mode)
ON CONFLICT DO NOTHING;

INSERT INTO pickup_points (id, zone_id, name, landmark, opening_hours) VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   'Relais Centre-ville', 'Avenue Charles de Gaulle, face au marché central', 'Lun-Sam 8h-19h'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003',
   'Relais Tié-Tié', 'Rond-point Tié-Tié, boutique à côté de la pharmacie', 'Lun-Sam 8h-20h')
ON CONFLICT DO NOTHING;

-- Coordonnées des points relais pilotes (pour la carte du livreur et le temps d'arrivée).
UPDATE pickup_points SET lat = v.lat, lng = v.lng
FROM (VALUES ('30000000-0000-4000-8000-000000000001'::uuid, -4.7795, 11.8641),
             ('30000000-0000-4000-8000-000000000002'::uuid, -4.7612, 11.8735)) AS v(id, lat, lng)
WHERE pickup_points.id = v.id AND pickup_points.lat IS NULL;

INSERT INTO courier_partners (id, name, kind, phone) VALUES
  ('40000000-0000-4000-8000-000000000001', 'Coursiers Ponténégrins (pilote)', 'company', '+242061000000')
ON CONFLICT DO NOTHING;
