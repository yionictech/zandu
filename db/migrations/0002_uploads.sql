-- =============================================================================
-- 0002 — Fichiers envoyés par les applications (photos produits, pièces KYC,
-- preuves de litige). Le téléphone envoie le fichier DIRECTEMENT au stockage
-- objet grâce à une URL signée ; l'API ne voit jamais passer les octets.
-- Chaque envoi est d'abord réservé ici : on ne peut rattacher à un produit,
-- un dossier KYC ou un litige qu'un fichier que l'on a soi-même envoyé, une
-- seule fois, et seulement s'il respecte le type et la taille annoncés.
-- =============================================================================

CREATE TYPE upload_purpose AS ENUM ('product_photo', 'kyc_document', 'dispute_evidence');

CREATE TABLE uploads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id),
  purpose       upload_purpose NOT NULL,
  bucket        text NOT NULL CHECK (bucket IN ('public', 'private')),
  storage_key   text NOT NULL UNIQUE,
  content_type  text NOT NULL,
  max_bytes     int NOT NULL CHECK (max_bytes > 0),
  size_bytes    int,
  expires_at    timestamptz NOT NULL,   -- validité de l'URL d'envoi
  consumed_at   timestamptz,            -- rattaché (produit, KYC, litige) : non réutilisable
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((purpose = 'product_photo') = (bucket = 'public'))
);
CREATE INDEX uploads_user_recent ON uploads (user_id, created_at DESC);

-- Les pièces KYC et preuves de litige référencent leur envoi d'origine.
ALTER TABLE kyc_documents ADD COLUMN upload_id uuid REFERENCES uploads (id);
ALTER TABLE dispute_evidence ADD COLUMN upload_id uuid REFERENCES uploads (id);
ALTER TABLE product_media ADD COLUMN upload_id uuid REFERENCES uploads (id);
