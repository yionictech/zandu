-- =============================================================================
-- Zandu — schéma initial du MVP (PostgreSQL 16)
--
-- Conventions (voir docs/architecture/04-modele-de-donnees.md) :
--   * montants en BIGINT, en francs CFA entiers (XAF n'a pas de décimales) ;
--     jamais de float/numeric pour l'argent ;
--   * horodatages en TIMESTAMPTZ (stockés en UTC, affichés en Africa/Brazzaville) ;
--   * identifiants UUID ; référence publique lisible au téléphone pour les commandes ;
--   * le grand livre (ledger_*) et le journal d'audit sont en écriture seule ;
--   * les statuts de commande ne suivent que les transitions déclarées dans
--     order_status_transitions (miroir de packages/domain/src/order-machine.ts).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------------------------------
-- Fonctions utilitaires
-- -----------------------------------------------------------------------------

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Interdit UPDATE et DELETE : utilisé pour le grand livre, l'historique et l'audit.
CREATE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La table % est en écriture seule (opération % refusée)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- unaccent() n'est pas IMMUTABLE ; cette enveloppe permet de l'indexer.
CREATE FUNCTION f_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$;

-- Recherche plein texte en français, insensible aux accents (« telephone » trouve « téléphone »).
CREATE TEXT SEARCH CONFIGURATION fr_unaccent (COPY = french);
ALTER TEXT SEARCH CONFIGURATION fr_unaccent
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, french_stem;

-- -----------------------------------------------------------------------------
-- Types énumérés
-- -----------------------------------------------------------------------------

CREATE TYPE user_role AS ENUM ('buyer', 'seller', 'rider', 'support', 'admin');
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'closed');
CREATE TYPE mobile_operator AS ENUM ('mtn', 'airtel');

CREATE TYPE seller_kind AS ENUM ('individual', 'business');
CREATE TYPE seller_verification_status AS ENUM
  ('unverified', 'pending_review', 'verified', 'rejected', 'suspended');
CREATE TYPE kyc_document_type AS ENUM
  ('national_id', 'passport', 'residence_proof', 'selfie', 'rccm', 'niu');
CREATE TYPE kyc_document_status AS ENUM ('pending', 'accepted', 'rejected');

CREATE TYPE product_status AS ENUM ('draft', 'pending_review', 'published', 'rejected', 'archived');
CREATE TYPE commission_scope AS ENUM ('default', 'category', 'seller');

CREATE TYPE delivery_mode AS ENUM ('home', 'pickup_point');
CREATE TYPE delivery_status AS ENUM
  ('awaiting_assignment', 'assigned', 'picked_up', 'at_pickup_point', 'delivered', 'failed', 'cancelled');

CREATE TYPE checkout_status AS ENUM ('awaiting_payment', 'paid', 'expired');
CREATE TYPE order_status AS ENUM (
  'pending_payment',    -- en attente de paiement
  'paid',               -- payée, fonds bloqués en séquestre, en attente du vendeur
  'preparing',          -- acceptée par le vendeur, en préparation
  'ready_for_pickup',   -- colis prêt, en attente du livreur
  'in_delivery',        -- colis récupéré par le livreur
  'awaiting_collection',-- déposé au point relais, en attente de retrait
  'delivered',          -- remis à l'acheteur ; fenêtre de litige ouverte
  'completed',          -- terminée : séquestre libéré, vendeur crédité
  'disputed',           -- litige ouvert : reversement gelé
  'refunded',           -- remboursée intégralement
  'cancelled'           -- annulée (avant ou après paiement)
);

CREATE TYPE payment_status AS ENUM ('created', 'pending', 'succeeded', 'failed', 'expired');
CREATE TYPE payout_status AS ENUM ('pending', 'processing', 'succeeded', 'failed');
CREATE TYPE refund_status AS ENUM ('pending', 'processing', 'succeeded', 'failed');

CREATE TYPE ledger_account_type AS ENUM ('asset', 'liability', 'revenue', 'expense');

CREATE TYPE dispute_reason AS ENUM
  ('not_received', 'not_as_described', 'damaged', 'counterfeit', 'missing_items', 'other');
CREATE TYPE dispute_status AS ENUM ('open', 'resolved');
CREATE TYPE dispute_resolution AS ENUM ('release_to_seller', 'refund_full', 'refund_partial');

CREATE TYPE notification_channel AS ENUM ('whatsapp', 'sms', 'push');
CREATE TYPE notification_status AS ENUM ('queued', 'sent', 'failed');

-- -----------------------------------------------------------------------------
-- 1. Identité et accès
-- -----------------------------------------------------------------------------

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'), -- E.164
  full_name   text CHECK (char_length(full_name) <= 120),
  roles       user_role[] NOT NULL DEFAULT '{buyer}',
  status      user_status NOT NULL DEFAULT 'active',
  locale      text NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'ln', 'mkw')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Codes à usage unique envoyés par SMS/WhatsApp. Seule l'empreinte HMAC est stockée.
CREATE TABLE otp_challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text NOT NULL,
  purpose       text NOT NULL CHECK (purpose IN ('login', 'step_up')),
  code_hash     text NOT NULL,
  attempts      int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  requested_ip  inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_challenges_phone_recent ON otp_challenges (phone, created_at DESC);
CREATE INDEX otp_challenges_ip_recent ON otp_challenges (requested_ip, created_at DESC);

-- Sessions opaques révocables ; seule l'empreinte SHA-256 du jeton est stockée.
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  device_label  text,
  ip            inet,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Second facteur (TOTP) pour support et administrateurs. Secret chiffré par l'application.
CREATE TABLE user_mfa (
  user_id               uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  totp_secret_encrypted bytea NOT NULL,
  enabled_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. Livraison : zones, tarifs, points relais, partenaires
-- -----------------------------------------------------------------------------

CREATE TABLE delivery_zones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city        text NOT NULL,
  name        text NOT NULL,          -- quartier / arrondissement
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city, name)
);

-- Tarif payé par l'acheteur ; courier_share revient au livreur, le reste est la marge plateforme.
CREATE TABLE delivery_rates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_zone_id  uuid NOT NULL REFERENCES delivery_zones (id),
  to_zone_id    uuid NOT NULL REFERENCES delivery_zones (id),
  mode          delivery_mode NOT NULL,
  price         bigint NOT NULL CHECK (price >= 0),
  courier_share bigint NOT NULL CHECK (courier_share >= 0 AND courier_share <= price),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_zone_id, to_zone_id, mode)
);

CREATE TABLE pickup_points (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id       uuid NOT NULL REFERENCES delivery_zones (id),
  name          text NOT NULL,
  landmark      text NOT NULL,        -- repère : « face à la pharmacie du rond-point »
  phone         text,
  opening_hours text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE courier_partners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('company', 'independent')),
  phone       text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE riders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL UNIQUE REFERENCES users (id),
  courier_partner_id  uuid NOT NULL REFERENCES courier_partners (id),
  zone_id             uuid REFERENCES delivery_zones (id),
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3. Vendeurs et vérification (KYC)
-- -----------------------------------------------------------------------------

CREATE TABLE seller_profiles (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL UNIQUE REFERENCES users (id),
  shop_name                 text NOT NULL CHECK (char_length(shop_name) BETWEEN 2 AND 80),
  slug                      text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind                      seller_kind NOT NULL DEFAULT 'individual',
  city                      text NOT NULL,
  pickup_zone_id            uuid NOT NULL REFERENCES delivery_zones (id),
  payout_msisdn             text NOT NULL CHECK (payout_msisdn ~ '^\+[1-9][0-9]{7,14}$'),
  payout_operator           mobile_operator NOT NULL,
  -- Changement de numéro de reversement : délai de carence anti-piratage de compte.
  payout_msisdn_changed_at  timestamptz,
  verification_status       seller_verification_status NOT NULL DEFAULT 'unverified',
  verified_at               timestamptz,
  rejection_reason          text,
  rccm                      text,
  niu                       text,
  -- Plafond de reversement spécifique (NULL = politique par défaut des nouveaux vendeurs).
  payout_cap_override       bigint CHECK (payout_cap_override IS NULL OR payout_cap_override >= 0),
  rating_avg                numeric(3, 2),
  rating_count              int NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'individual' OR (rccm IS NOT NULL AND niu IS NOT NULL) OR verification_status <> 'verified')
);
CREATE TRIGGER seller_profiles_updated_at BEFORE UPDATE ON seller_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Pièces stockées dans un compartiment privé séparé (storage_key), jamais en public.
CREATE TABLE kyc_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id         uuid NOT NULL REFERENCES seller_profiles (id),
  type              kyc_document_type NOT NULL,
  storage_key       text NOT NULL,
  status            kyc_document_status NOT NULL DEFAULT 'pending',
  reviewed_by       uuid REFERENCES users (id),
  reviewed_at       timestamptz,
  rejection_reason  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kyc_documents_seller ON kyc_documents (seller_id);

-- -----------------------------------------------------------------------------
-- 4. Catalogue
-- -----------------------------------------------------------------------------

CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   uuid REFERENCES categories (id),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  position    int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id         uuid NOT NULL REFERENCES seller_profiles (id),
  category_id       uuid NOT NULL REFERENCES categories (id),
  title             text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 140),
  description       text NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
  price             bigint NOT NULL CHECK (price > 0),
  compare_at_price  bigint CHECK (compare_at_price IS NULL OR compare_at_price > price), -- promo (P2)
  stock             int NOT NULL CHECK (stock >= 0),
  city              text NOT NULL,  -- dénormalisé depuis la boutique pour le filtre « ville »
  status            product_status NOT NULL DEFAULT 'draft',
  rejection_reason  text,
  published_at      timestamptz,
  search_vector     tsvector GENERATED ALWAYS AS (
                      setweight(to_tsvector('fr_unaccent', title), 'A') ||
                      setweight(to_tsvector('fr_unaccent', description), 'C')
                    ) STORED,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX products_search ON products USING gin (search_vector);
CREATE INDEX products_title_trgm ON products USING gin (f_unaccent(lower(title)) gin_trgm_ops);
CREATE INDEX products_listing ON products (status, category_id, published_at DESC);
CREATE INDEX products_city_price ON products (city, price) WHERE status = 'published';
CREATE INDEX products_seller ON products (seller_id, status);

-- Jusqu'à 6 photos par produit (F3), dans l'ordre d'affichage.
CREATE TABLE product_media (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  storage_key  text NOT NULL,
  position     smallint NOT NULL CHECK (position BETWEEN 0 AND 5),
  width        int,
  height       int,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, position)
);

-- Commission en points de base (1 000 = 10 %). Priorité : vendeur > catégorie > défaut.
CREATE TABLE commission_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope        commission_scope NOT NULL,
  category_id  uuid REFERENCES categories (id),
  seller_id    uuid REFERENCES seller_profiles (id),
  rate_bps     int NOT NULL CHECK (rate_bps BETWEEN 0 AND 5000),
  valid_from   timestamptz NOT NULL DEFAULT now(),
  valid_to     timestamptz,
  note         text,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope = 'default'  AND category_id IS NULL     AND seller_id IS NULL) OR
    (scope = 'category' AND category_id IS NOT NULL AND seller_id IS NULL) OR
    (scope = 'seller'   AND seller_id IS NOT NULL   AND category_id IS NULL)
  ),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

-- -----------------------------------------------------------------------------
-- 5. Achat : un checkout (un paiement) se découpe en une commande par vendeur
-- -----------------------------------------------------------------------------

CREATE TABLE checkouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id        uuid NOT NULL REFERENCES users (id),
  status          checkout_status NOT NULL DEFAULT 'awaiting_payment',
  items_total     bigint NOT NULL CHECK (items_total > 0),
  delivery_total  bigint NOT NULL CHECK (delivery_total >= 0),
  grand_total     bigint NOT NULL CHECK (grand_total = items_total + delivery_total),
  currency        char(3) NOT NULL DEFAULT 'XAF',
  expires_at      timestamptz NOT NULL,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER checkouts_updated_at BEFORE UPDATE ON checkouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX checkouts_expiry ON checkouts (expires_at) WHERE status = 'awaiting_payment';

CREATE TABLE orders (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_ref              text NOT NULL UNIQUE,     -- ex. ZD-7K3M9Q2P, lisible au téléphone
  checkout_id             uuid NOT NULL REFERENCES checkouts (id),
  buyer_id                uuid NOT NULL REFERENCES users (id),
  seller_id               uuid NOT NULL REFERENCES seller_profiles (id),
  status                  order_status NOT NULL DEFAULT 'pending_payment',
  items_subtotal          bigint NOT NULL CHECK (items_subtotal > 0),
  delivery_fee            bigint NOT NULL CHECK (delivery_fee >= 0),
  courier_share           bigint NOT NULL CHECK (courier_share BETWEEN 0 AND delivery_fee),
  commission_total        bigint NOT NULL CHECK (commission_total BETWEEN 0 AND items_subtotal),
  total                   bigint NOT NULL CHECK (total = items_subtotal + delivery_fee),
  refunded_amount         bigint NOT NULL DEFAULT 0 CHECK (refunded_amount BETWEEN 0 AND total),
  currency                char(3) NOT NULL DEFAULT 'XAF',
  delivery_mode           delivery_mode NOT NULL,
  delivery_zone_id        uuid NOT NULL REFERENCES delivery_zones (id),
  pickup_point_id         uuid REFERENCES pickup_points (id),
  shipping_address        jsonb NOT NULL,           -- instantané : destinataire, téléphone, repère
  -- Échéances surveillées par les tâches de fond (voir apps/api/src/jobs)
  seller_accept_deadline  timestamptz,
  dispute_window_ends_at  timestamptz,
  paid_at                 timestamptz,
  delivered_at            timestamptz,
  completed_at            timestamptz,
  cancelled_at            timestamptz,
  cancel_reason           text,
  version                 int NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (delivery_mode = 'home' OR pickup_point_id IS NOT NULL)
);
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX orders_checkout ON orders (checkout_id);
CREATE INDEX orders_buyer ON orders (buyer_id, created_at DESC);
CREATE INDEX orders_seller ON orders (seller_id, status, created_at DESC);
CREATE INDEX orders_accept_deadline ON orders (seller_accept_deadline) WHERE status = 'paid';
CREATE INDEX orders_dispute_window ON orders (dispute_window_ends_at) WHERE status = 'delivered';

-- Prix et commission figés au moment de la commande : jamais recalculés.
CREATE TABLE order_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES orders (id),
  product_id          uuid NOT NULL REFERENCES products (id),
  title_snapshot      text NOT NULL,
  unit_price          bigint NOT NULL CHECK (unit_price > 0),
  quantity            int NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  line_total          bigint NOT NULL CHECK (line_total = unit_price * quantity),
  commission_rate_bps int NOT NULL CHECK (commission_rate_bps BETWEEN 0 AND 5000),
  commission_amount   bigint NOT NULL CHECK (commission_amount BETWEEN 0 AND line_total)
);
CREATE INDEX order_items_order ON order_items (order_id);

-- Transitions autorisées : miroir exact de la machine à états du domaine
-- (un test d'intégration vérifie que les deux restent identiques).
CREATE TABLE order_status_transitions (
  from_status order_status NOT NULL,
  to_status   order_status NOT NULL,
  PRIMARY KEY (from_status, to_status)
);
INSERT INTO order_status_transitions (from_status, to_status) VALUES
  ('pending_payment',     'paid'),
  ('pending_payment',     'cancelled'),
  ('paid',                'preparing'),
  ('paid',                'cancelled'),
  ('preparing',           'ready_for_pickup'),
  ('preparing',           'cancelled'),
  ('ready_for_pickup',    'in_delivery'),
  ('ready_for_pickup',    'cancelled'),
  ('in_delivery',         'awaiting_collection'),
  ('in_delivery',         'delivered'),
  ('in_delivery',         'disputed'),
  ('awaiting_collection', 'delivered'),
  ('awaiting_collection', 'disputed'),
  ('delivered',           'completed'),
  ('delivered',           'disputed'),
  ('disputed',            'completed'),
  ('disputed',            'refunded');

CREATE FUNCTION orders_guard_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
    SELECT 1 FROM order_status_transitions
    WHERE from_status = OLD.status AND to_status = NEW.status
  ) THEN
    RAISE EXCEPTION 'Transition de commande interdite : % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_status_guard BEFORE UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_guard_transition();

CREATE TABLE order_status_history (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     uuid NOT NULL REFERENCES orders (id),
  from_status  order_status,
  to_status    order_status NOT NULL,
  event        text NOT NULL,
  actor_id     uuid REFERENCES users (id),
  actor_role   text NOT NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_status_history_order ON order_status_history (order_id, id);
CREATE TRIGGER order_status_history_append_only BEFORE UPDATE OR DELETE ON order_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- -----------------------------------------------------------------------------
-- 6. Paiements Mobile Money
-- -----------------------------------------------------------------------------

-- Une tentative de paiement par ligne. L'id sert de référence (et de clé d'idempotence)
-- auprès de l'agrégateur : renvoyer la même demande ne peut pas débiter deux fois.
CREATE TABLE payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_id      uuid NOT NULL REFERENCES checkouts (id),
  buyer_id         uuid NOT NULL REFERENCES users (id),
  idempotency_key  text NOT NULL,            -- clé fournie par le client (en-tête Idempotency-Key)
  provider         text NOT NULL,            -- code de l'agrégateur (ex. pawapay, simulator)
  operator         mobile_operator NOT NULL,
  msisdn           text NOT NULL CHECK (msisdn ~ '^\+[1-9][0-9]{7,14}$'),
  amount           bigint NOT NULL CHECK (amount > 0),
  currency         char(3) NOT NULL DEFAULT 'XAF',
  status           payment_status NOT NULL DEFAULT 'created',
  provider_ref     text,
  failure_code     text,
  failure_message  text,
  late_success     boolean NOT NULL DEFAULT false, -- succès reçu après expiration : remboursé d'office
  expires_at       timestamptz NOT NULL,
  poll_until       timestamptz NOT NULL,     -- interrogation de l'agrégateur jusqu'à cette date
  next_poll_at     timestamptz,
  poll_attempts    int NOT NULL DEFAULT 0,
  succeeded_at     timestamptz,
  failed_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_id, idempotency_key),
  UNIQUE (provider, provider_ref)
);
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Au plus un paiement effectif et au plus une tentative en cours par checkout
-- (un succès tardif, remboursé d'office, n'est pas un paiement effectif).
CREATE UNIQUE INDEX payments_one_success_per_checkout ON payments (checkout_id)
  WHERE status = 'succeeded' AND NOT late_success;
CREATE UNIQUE INDEX payments_one_active_per_checkout ON payments (checkout_id)
  WHERE status IN ('created', 'pending');
CREATE INDEX payments_polling ON payments (next_poll_at)
  WHERE status IN ('created', 'pending', 'expired') AND next_poll_at IS NOT NULL;
CREATE INDEX payments_expiry ON payments (expires_at) WHERE status IN ('created', 'pending');

-- Boîte de réception des webhooks : dédoublonnage et rejeu.
CREATE TABLE provider_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL,
  event_id          text NOT NULL,
  event_type        text NOT NULL,
  payload           jsonb NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  processing_error  text,
  UNIQUE (provider, event_id)
);

-- -----------------------------------------------------------------------------
-- 7. Grand livre en partie double (écriture seule)
--    Convention : montant > 0 = débit, montant < 0 = crédit ; chaque transaction somme à 0.
-- -----------------------------------------------------------------------------

CREATE TABLE ledger_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE,   -- ex. liability:seller_payable:<uuid>
  type                ledger_account_type NOT NULL,
  name                text NOT NULL,
  seller_id           uuid REFERENCES seller_profiles (id),
  courier_partner_id  uuid REFERENCES courier_partners (id),
  currency            char(3) NOT NULL DEFAULT 'XAF',
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (split_part(code, ':', 1) = type::text)
);

CREATE TABLE ledger_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL,
  -- Clé métier unique : impossible de libérer deux fois le même séquestre,
  -- de capturer deux fois le même paiement, etc.
  idempotency_key  text NOT NULL UNIQUE,
  payment_id       uuid REFERENCES payments (id),
  order_id         uuid REFERENCES orders (id),
  payout_id        uuid,
  refund_id        uuid,
  description      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id  uuid NOT NULL REFERENCES ledger_transactions (id),
  account_id      uuid NOT NULL REFERENCES ledger_accounts (id),
  amount          bigint NOT NULL CHECK (amount <> 0),
  order_id        uuid REFERENCES orders (id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_account ON ledger_entries (account_id, id);
CREATE INDEX ledger_entries_transaction ON ledger_entries (transaction_id);
CREATE INDEX ledger_entries_order ON ledger_entries (order_id) WHERE order_id IS NOT NULL;

CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_transactions_no_truncate BEFORE TRUNCATE ON ledger_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Vérifié au COMMIT : toute transaction comptable est équilibrée et compte au moins 2 lignes.
CREATE FUNCTION ledger_assert_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  tx_id    uuid;
  total    bigint;
  n_lines  int;
BEGIN
  IF TG_TABLE_NAME = 'ledger_entries' THEN
    tx_id := NEW.transaction_id;
  ELSE
    tx_id := NEW.id;
  END IF;
  SELECT coalesce(sum(amount), 0), count(*) INTO total, n_lines
  FROM ledger_entries WHERE transaction_id = tx_id;
  IF n_lines < 2 OR total <> 0 THEN
    RAISE EXCEPTION 'Transaction comptable % invalide : % ligne(s), somme %', tx_id, n_lines, total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_assert_balanced();
CREATE CONSTRAINT TRIGGER ledger_transactions_not_empty AFTER INSERT ON ledger_transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_assert_balanced();

-- Comptes de la plateforme (les comptes vendeurs, livreurs et agrégateurs sont créés à la demande).
INSERT INTO ledger_accounts (code, type, name) VALUES
  ('liability:escrow',             'liability', 'Séquestre — fonds acheteurs bloqués'),
  ('liability:refunds_in_transit', 'liability', 'Remboursements en cours'),
  ('liability:payouts_in_transit', 'liability', 'Reversements vendeurs en cours'),
  ('liability:suspense',           'liability', 'Attente — paiements tardifs ou non rapprochés'),
  ('revenue:commission',           'revenue',   'Commissions sur ventes'),
  ('revenue:delivery_margin',      'revenue',   'Marge sur frais de livraison'),
  ('expense:payment_fees',         'expense',   'Frais Mobile Money / agrégateur');

-- -----------------------------------------------------------------------------
-- 8. Reversements vendeurs et remboursements acheteurs
-- -----------------------------------------------------------------------------

CREATE TABLE payouts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id        uuid NOT NULL REFERENCES seller_profiles (id),
  order_id         uuid REFERENCES orders (id),  -- reversement automatique lié à une commande
  amount           bigint NOT NULL CHECK (amount > 0),
  currency         char(3) NOT NULL DEFAULT 'XAF',
  provider         text NOT NULL,
  operator         mobile_operator NOT NULL,
  msisdn           text NOT NULL,
  status           payout_status NOT NULL DEFAULT 'pending',
  provider_ref     text,
  attempts         int NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  succeeded_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER payouts_updated_at BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX payouts_due ON payouts (next_attempt_at) WHERE status = 'pending';
CREATE INDEX payouts_seller ON payouts (seller_id, created_at DESC);

CREATE TABLE refunds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id       uuid NOT NULL REFERENCES payments (id),
  order_id         uuid REFERENCES orders (id),  -- NULL pour un paiement tardif sans commande
  amount           bigint NOT NULL CHECK (amount > 0),
  currency         char(3) NOT NULL DEFAULT 'XAF',
  reason           text NOT NULL,
  status           refund_status NOT NULL DEFAULT 'pending',
  provider_ref     text,
  attempts         int NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  decided_by       uuid REFERENCES users (id),
  succeeded_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER refunds_updated_at BEFORE UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX refunds_due ON refunds (next_attempt_at) WHERE status = 'pending';

-- -----------------------------------------------------------------------------
-- 9. Livraisons
-- -----------------------------------------------------------------------------

CREATE TABLE deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL UNIQUE REFERENCES orders (id),
  status              delivery_status NOT NULL DEFAULT 'awaiting_assignment',
  rider_id            uuid REFERENCES riders (id),
  courier_partner_id  uuid REFERENCES courier_partners (id),
  -- Code de remise en main propre : envoyé à l'acheteur, saisi par le livreur. Empreinte seulement.
  handover_code_hash  text NOT NULL,
  handover_attempts   int NOT NULL DEFAULT 0,
  assigned_at         timestamptz,
  picked_up_at        timestamptz,
  delivered_at        timestamptz,
  failure_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER deliveries_updated_at BEFORE UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX deliveries_rider ON deliveries (rider_id, status);

-- -----------------------------------------------------------------------------
-- 10. Confiance : avis et litiges
-- -----------------------------------------------------------------------------

-- Un avis par article reçu (F11) : impossible de noter sans avoir acheté.
CREATE TABLE reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id  uuid NOT NULL UNIQUE REFERENCES order_items (id),
  product_id     uuid NOT NULL REFERENCES products (id),
  seller_id      uuid NOT NULL REFERENCES seller_profiles (id),
  buyer_id       uuid NOT NULL REFERENCES users (id),
  rating         smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        text CHECK (char_length(comment) <= 2000),
  hidden         boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_product ON reviews (product_id, created_at DESC) WHERE NOT hidden;

CREATE TABLE disputes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL UNIQUE REFERENCES orders (id),
  opened_by      uuid NOT NULL REFERENCES users (id),
  reason         dispute_reason NOT NULL,
  description    text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 2000),
  status         dispute_status NOT NULL DEFAULT 'open',
  resolution     dispute_resolution,
  refund_amount  bigint CHECK (refund_amount IS NULL OR refund_amount > 0),
  decided_by     uuid REFERENCES users (id),
  decided_at     timestamptz,
  decision_note  text,
  sla_due_at     timestamptz NOT NULL,   -- objectif : décision sous 72 h
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'open') = (resolution IS NULL))
);
CREATE TRIGGER disputes_updated_at BEFORE UPDATE ON disputes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX disputes_open ON disputes (sla_due_at) WHERE status = 'open';

CREATE TABLE dispute_evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id   uuid NOT NULL REFERENCES disputes (id),
  uploaded_by  uuid NOT NULL REFERENCES users (id),
  storage_key  text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('photo', 'video', 'document')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 11. Messagerie acheteur-vendeur (numéros et liens masqués à l'écriture)
-- -----------------------------------------------------------------------------

CREATE TABLE conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id         uuid NOT NULL REFERENCES users (id),
  seller_id        uuid NOT NULL REFERENCES seller_profiles (id),
  last_message_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_id, seller_id)
);

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations (id),
  sender_id        uuid NOT NULL REFERENCES users (id),
  body             text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  was_filtered     boolean NOT NULL DEFAULT false,
  product_id       uuid REFERENCES products (id),
  order_id         uuid REFERENCES orders (id),
  read_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation ON messages (conversation_id, created_at);

-- -----------------------------------------------------------------------------
-- 12. Événements sortants (outbox) et notifications
-- -----------------------------------------------------------------------------

-- Écrit dans la même transaction que le changement métier, puis distribué par le worker :
-- aucune notification ne part pour une transaction annulée, aucune n'est perdue.
CREATE TABLE outbox_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic           text NOT NULL,
  aggregate_type  text NOT NULL,
  aggregate_id    uuid NOT NULL,
  payload         jsonb NOT NULL,
  available_at    timestamptz NOT NULL DEFAULT now(),
  attempts        int NOT NULL DEFAULT 0,
  last_error      text,
  processed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending ON outbox_events (available_at) WHERE processed_at IS NULL;

CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES users (id),
  recipient     text NOT NULL,          -- numéro E.164 ou jeton push
  channel       notification_channel NOT NULL,
  template      text NOT NULL,
  variables     jsonb NOT NULL DEFAULT '{}',
  status        notification_status NOT NULL DEFAULT 'queued',
  provider_ref  text,
  error         text,
  outbox_id     bigint REFERENCES outbox_events (id),
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 13. Idempotence des requêtes API, audit, rapprochement, paramètres
-- -----------------------------------------------------------------------------

CREATE TABLE idempotency_keys (
  user_id          uuid NOT NULL REFERENCES users (id),
  key              text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 128),
  method           text NOT NULL,
  path             text NOT NULL,
  request_hash     text NOT NULL,
  response_status  int,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE audit_logs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id     uuid REFERENCES users (id),
  actor_role   text NOT NULL,
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  ip           inet,
  user_agent   text,
  metadata     jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity ON audit_logs (entity_type, entity_id, id);
CREATE INDEX audit_logs_actor ON audit_logs (actor_id, id);
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Rapprochement quotidien grand livre <-> relevé de l'agrégateur.
CREATE TABLE reconciliation_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text NOT NULL,
  statement_date  date NOT NULL,
  status          text NOT NULL CHECK (status IN ('running', 'balanced', 'discrepancies', 'error')),
  summary         jsonb NOT NULL DEFAULT '{}',
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  UNIQUE (provider, statement_date)
);

CREATE TABLE reconciliation_discrepancies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid NOT NULL REFERENCES reconciliation_runs (id),
  kind             text NOT NULL CHECK (kind IN
                     ('missing_internal', 'missing_provider', 'amount_mismatch', 'status_mismatch')),
  reference        text NOT NULL,
  internal_amount  bigint,
  provider_amount  bigint,
  details          jsonb NOT NULL DEFAULT '{}',
  resolved_at      timestamptz,
  resolved_by      uuid REFERENCES users (id),
  resolution_note  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users (id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
