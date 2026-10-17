-- Second facteur (TOTP) obligatoire pour le support et l'administration (back-office).
-- Une session du personnel n'ouvre les routes /v1/support et /v1/admin qu'une fois le code TOTP
-- vérifié pour CETTE session ; 5 codes erronés révoquent la session.

ALTER TABLE sessions
  ADD COLUMN mfa_verified_at     timestamptz,
  ADD COLUMN mfa_failed_attempts int NOT NULL DEFAULT 0;

-- Anti-rejeu : un code TOTP (pas de 30 s) ne sert qu'une fois.
ALTER TABLE user_mfa
  ADD COLUMN last_used_step bigint;
