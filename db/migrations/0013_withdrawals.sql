-- Retrait à la demande de l'argent du vendeur (docs/ux/03 §4.3, §14). Désactivé par défaut :
-- tant que le back-office ne choisit pas « à la demande », le reversement reste automatique.

-- Un retrait au-dessus du seuil attend le contrôle du back-office ; le montant est déjà
-- réservé dans le grand livre, il ne peut pas partir deux fois.
ALTER TYPE payout_status ADD VALUE IF NOT EXISTS 'awaiting_review' BEFORE 'pending';

ALTER TABLE payouts
  ADD COLUMN kind text NOT NULL DEFAULT 'automatic' CHECK (kind IN ('automatic', 'withdrawal')),
  ADD COLUMN reviewed_by uuid REFERENCES users (id),
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_note text CHECK (char_length(review_note) <= 300);
-- (Pas d'index partiel sur la nouvelle valeur : elle n'est utilisable qu'après cette migration.)
CREATE INDEX payouts_status ON payouts (status, created_at);

-- Code SMS de confirmation du retrait : même table que les codes de connexion.
ALTER TABLE otp_challenges DROP CONSTRAINT otp_challenges_purpose_check;
ALTER TABLE otp_challenges
  ADD CONSTRAINT otp_challenges_purpose_check CHECK (purpose IN ('login', 'step_up', 'withdrawal')),
  ADD COLUMN context jsonb;

ALTER TABLE platform_settings DROP CONSTRAINT platform_settings_known_key;
ALTER TABLE platform_settings
  ADD CONSTRAINT platform_settings_known_key CHECK (key IN (
    'seller_acceptance_minutes', 'seller_acceptance_open_hours_only',
    'payout_mode', 'withdrawal_review_amount'));
