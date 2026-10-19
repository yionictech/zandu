-- Notifications sur le téléphone (ADR-0018) : la notification de l'application d'abord,
-- WhatsApp puis SMS en secours si elle ne peut pas partir ou, pour les messages importants,
-- si la personne ne l'a ni ouverte ni utilisé l'application dans le délai prévu.

-- 1. Téléphones qui reçoivent les notifications : un jeton par installation de l'application,
-- rattaché à la session qui l'a enregistré. Une session fermée (déconnexion, accès retiré,
-- expiration) ne reçoit plus rien, même si le téléphone n'a pas pu prévenir le serveur.
CREATE TABLE push_devices (
  token         text PRIMARY KEY,         -- jeton Expo (ExponentPushToken[…])
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id    uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('android', 'ios')),
  created_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL,
  disabled_at   timestamptz               -- jeton refusé par le service de notifications
);
CREATE INDEX push_devices_user ON push_devices (user_id) WHERE disabled_at IS NULL;

-- 2. Notifications : lien à ouvrir, canal de secours et accusé de lecture.
ALTER TABLE notifications
  ADD COLUMN data              jsonb NOT NULL DEFAULT '{}',   -- { url } : écran ouvert au toucher
  ADD COLUMN fallback_channel  notification_channel,          -- canal si la notification n'aboutit pas
  ADD COLUMN fallback_at       timestamptz,                   -- doublée après cette date si non lue
  ADD COLUMN fallback_done     boolean NOT NULL DEFAULT false,
  ADD COLUMN acked_at          timestamptz;                   -- reçue dans l'application ou touchée
CREATE INDEX notifications_fallback ON notifications (fallback_at)
  WHERE fallback_at IS NOT NULL AND acked_at IS NULL AND NOT fallback_done;
