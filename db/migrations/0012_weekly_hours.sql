-- Horaires d'ouverture jour par jour (docs/ux/03 §13) : 7 éléments, lundi d'abord, chacun
-- {"open":"08:00","close":"18:00"} ou null (fermé). Le texte opening_hours en est tiré.
ALTER TABLE seller_profiles
  ADD COLUMN weekly_hours jsonb
    CHECK (weekly_hours IS NULL OR (jsonb_typeof(weekly_hours) = 'array'
                                    AND jsonb_array_length(weekly_hours) = 7));

-- Option du back-office : le délai d'acceptation ne compte que les heures d'ouverture.
ALTER TABLE platform_settings DROP CONSTRAINT platform_settings_known_key;
ALTER TABLE platform_settings
  ADD CONSTRAINT platform_settings_known_key
    CHECK (key IN ('seller_acceptance_minutes', 'seller_acceptance_open_hours_only'));
