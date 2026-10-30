-- Messagerie de la commande : acheteur, vendeur, livreur (et le support) échangent dans
-- l'application, sans se donner leur numéro. Une conversation par commande ; le support la lit
-- en cas de litige. Les messages restent avec la commande (preuve en cas de litige).
CREATE TYPE message_author_role AS ENUM ('buyer', 'seller', 'rider', 'support');

CREATE TABLE order_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Ordre d'arrivée, même à la milliseconde près.
  seq          bigint GENERATED ALWAYS AS IDENTITY,
  order_id     uuid NOT NULL REFERENCES orders (id),
  author_id    uuid NOT NULL REFERENCES users (id),
  author_role  message_author_role NOT NULL,
  body         text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_messages_order ON order_messages (order_id, seq);
CREATE INDEX order_messages_author ON order_messages (author_id, created_at);

-- Dernier message lu par chaque participant (pastille « non lus »).
CREATE TABLE order_message_reads (
  order_id      uuid NOT NULL REFERENCES orders (id),
  user_id       uuid NOT NULL REFERENCES users (id),
  last_read_at  timestamptz NOT NULL,
  PRIMARY KEY (order_id, user_id)
);
