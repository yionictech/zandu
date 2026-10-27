-- Repère GPS de la livraison (docs/ux/03 §16) : le client peut poser son adresse sur la carte à
-- la commande (shipping_address.location, facultatif) ; les points relais ont leurs coordonnées.
ALTER TABLE pickup_points
  ADD COLUMN lat double precision,
  ADD COLUMN lng double precision,
  ADD CONSTRAINT pickup_points_location CHECK ((lat IS NULL) = (lng IS NULL));

-- Bases déjà remplies : coordonnées des deux points relais pilotes (sans effet ailleurs).
UPDATE pickup_points SET lat = v.lat, lng = v.lng
FROM (VALUES ('30000000-0000-4000-8000-000000000001'::uuid, -4.7795, 11.8641),
             ('30000000-0000-4000-8000-000000000002'::uuid, -4.7612, 11.8735)) AS v(id, lat, lng)
WHERE pickup_points.id = v.id AND pickup_points.lat IS NULL;
