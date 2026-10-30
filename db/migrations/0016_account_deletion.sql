-- Suppression de compte (exigence Google Play et App Store, docs/exploitation/publication-stores.md) :
-- le compte est fermé et ses données personnelles effacées ; les écritures comptables, commandes
-- et reversements restent (obligation légale de conservation), sans nom ni téléphone.
ALTER TABLE users ADD COLUMN deleted_at timestamptz;

ALTER TABLE otp_challenges DROP CONSTRAINT otp_challenges_purpose_check;
ALTER TABLE otp_challenges
  ADD CONSTRAINT otp_challenges_purpose_check
  CHECK (purpose IN ('login', 'step_up', 'withdrawal', 'account_deletion'));
