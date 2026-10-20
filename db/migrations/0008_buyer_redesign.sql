-- Parcours acheteur de la nouvelle direction visuelle (docs/ux/03 §3).

-- 1. Étiquettes d'avis (« Conforme à l'annonce », « Livreur ponctuel », « Bien emballé »).
ALTER TABLE reviews
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}'
    CHECK (tags <@ ARRAY['conforme', 'livreur_ponctuel', 'bien_emballe']::text[]);

-- 2. Centre de notifications : ce qui a été vu (« Tout lire »).
ALTER TABLE users ADD COLUMN notifications_seen_at timestamptz;
CREATE INDEX notifications_inbox ON notifications (user_id, created_at DESC) WHERE user_id IS NOT NULL;
