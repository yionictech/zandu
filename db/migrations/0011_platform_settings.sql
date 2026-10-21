-- Réglages de la plateforme modifiables depuis le back-office (docs/ux/03 §4.4, §12). La table
-- existe depuis 0001 ; seules les clés connues de l'API sont acceptées. Une clé absente = la
-- valeur de la configuration du serveur (variables d'environnement).
ALTER TABLE platform_settings
  ADD CONSTRAINT platform_settings_known_key CHECK (key IN ('seller_acceptance_minutes'));
