-- Suivi du livreur en route (docs/ux/03 §4.2, §15) : la DERNIÈRE position seulement, par
-- course, tant que le colis est en route vers le client. Effacée à la remise ou à l'échec :
-- aucun historique des déplacements n'est gardé.
CREATE TABLE rider_positions (
  delivery_id  uuid PRIMARY KEY REFERENCES deliveries (id) ON DELETE CASCADE,
  rider_id     uuid NOT NULL REFERENCES riders (id),
  lat          double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng          double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m   real CHECK (accuracy_m >= 0),
  recorded_at  timestamptz NOT NULL
);

-- Dès que le colis n'est plus en route vers le client (remis, déposé au point relais, rapporté
-- au vendeur, échec, réassigné), la position est effacée, quel que soit le chemin du code.
CREATE FUNCTION forget_rider_position() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'picked_up' THEN
    DELETE FROM rider_positions WHERE delivery_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deliveries_forget_position AFTER UPDATE OF status ON deliveries
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION forget_rider_position();
