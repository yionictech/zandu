-- Déclinaisons des photos produits, produites par le worker à partir de l'original envoyé :
-- vignette (listes), grande image (fiche) et image de partage JPEG (aperçus WhatsApp).
-- Réencodées, redressées et sans métadonnées (position GPS du téléphone comprise).
--
-- processing_status :
--   pending  à traiter (l'original s'affiche en attendant) ;
--   ready    déclinaisons disponibles dans `variants` ;
--   invalid  le fichier n'est pas une image lisible : jamais affiché ;
--   failed   échecs répétés (stockage indisponible…) : l'original reste affiché.

ALTER TABLE product_media
  ADD COLUMN variants            jsonb,
  ADD COLUMN processing_status   text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'ready', 'invalid', 'failed')),
  ADD COLUMN processing_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN processing_after    timestamptz,
  ADD COLUMN processing_error    text,
  ADD CHECK ((processing_status = 'ready') = (variants IS NOT NULL));

CREATE INDEX product_media_pending ON product_media (created_at) WHERE processing_status = 'pending';
