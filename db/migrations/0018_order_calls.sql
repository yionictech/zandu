-- Appels internet dans l'application (LiveKit, docs/exploitation/appels.md) entre les
-- participants d'une commande : qui appelle qui, et comment l'appel s'est terminé. Le son ne
-- passe jamais par la base ni par l'API, et n'est pas enregistré.
CREATE TYPE call_status AS ENUM ('ringing', 'accepted', 'declined', 'missed', 'ended');

CREATE TABLE order_calls (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders (id),
  caller_id    uuid NOT NULL REFERENCES users (id),
  callee_id    uuid NOT NULL REFERENCES users (id),
  status       call_status NOT NULL DEFAULT 'ringing',
  created_at   timestamptz NOT NULL DEFAULT now(),
  answered_at  timestamptz,
  ended_at     timestamptz
);
CREATE INDEX order_calls_callee ON order_calls (callee_id, created_at DESC);
CREATE INDEX order_calls_order ON order_calls (order_id, created_at);
