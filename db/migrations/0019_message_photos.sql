-- Messagerie enrichie : une photo peut accompagner (ou remplacer) le texte d'un message.
-- Les photos restent privées (lien signé, valable une heure) : seuls les participants les voient.
ALTER TYPE upload_purpose ADD VALUE IF NOT EXISTS 'message_photo';

ALTER TABLE order_messages DROP CONSTRAINT order_messages_body_check;
ALTER TABLE order_messages ADD COLUMN photo_key text;
ALTER TABLE order_messages ADD CONSTRAINT order_messages_content_check
  CHECK (length(body) <= 1000 AND (length(body) >= 1 OR photo_key IS NOT NULL));
