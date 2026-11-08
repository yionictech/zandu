-- Points fidélité et parrainage (packages/domain/src/loyalty.ts).
--
-- 1 point = 1 FCFA de réduction, payée par Zandu : le séquestre reçoit le montant entier des
-- commandes, la part payée en points est une charge (expense:loyalty_rewards) écrite à la
-- capture du paiement, annulée si la commande est remboursée (points recrédités).

ALTER TABLE users ADD COLUMN referral_code text UNIQUE CHECK (referral_code ~ '^[A-Z0-9]{6,12}$');
ALTER TABLE users ADD COLUMN referred_by uuid REFERENCES users (id);
ALTER TABLE users ADD COLUMN referred_at timestamptz;
ALTER TABLE users ADD CONSTRAINT users_not_self_referred CHECK (referred_by IS DISTINCT FROM id);

-- Mouvements de points, jamais modifiés : le solde est leur somme.
CREATE TABLE loyalty_entries (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users (id),
  points           int NOT NULL CHECK (points <> 0),
  kind             text NOT NULL
                   CHECK (kind IN ('earned', 'referral_bonus', 'redeemed', 'released', 'restored')),
  order_id         uuid REFERENCES orders (id),
  checkout_id      uuid REFERENCES checkouts (id),
  related_user_id  uuid REFERENCES users (id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loyalty_entries_user ON loyalty_entries (user_id, id DESC);
-- Une fois seulement : points d'une commande, utilisation et libération d'un panier, parrainage.
CREATE UNIQUE INDEX loyalty_earned_once ON loyalty_entries (order_id) WHERE kind = 'earned';
CREATE UNIQUE INDEX loyalty_checkout_once ON loyalty_entries (checkout_id, kind)
  WHERE kind IN ('redeemed', 'released');
CREATE UNIQUE INDEX loyalty_referral_once ON loyalty_entries (user_id, related_user_id)
  WHERE kind = 'referral_bonus';
CREATE TRIGGER loyalty_entries_append_only BEFORE UPDATE OR DELETE ON loyalty_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Points utilisés : par panier (le paiement Mobile Money porte sur le reste) et par commande.
ALTER TABLE checkouts ADD COLUMN points_used bigint NOT NULL DEFAULT 0
  CHECK (points_used >= 0 AND points_used < grand_total);
ALTER TABLE orders ADD COLUMN points_used bigint NOT NULL DEFAULT 0
  CHECK (points_used >= 0 AND points_used < total);

INSERT INTO ledger_accounts (code, type, name) VALUES
  ('expense:loyalty_rewards', 'expense', 'Points fidélité utilisés (réductions payées par Zandu)')
ON CONFLICT (code) DO NOTHING;
