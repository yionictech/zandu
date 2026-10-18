-- Rapprochement quotidien avec l'agrégateur (ADR-0015) : chaque nuit, le relevé de la veille
-- est comparé, mouvement par mouvement, au compte asset:provider_cash:<agrégateur> du grand livre.
-- Les tables reconciliation_* de 0001 n'ont encore jamais été alimentées : on les complète.

-- 1. Contrôles : un par agrégateur et par journée (heure du Congo), relançable.
ALTER TABLE reconciliation_runs
  -- Fin de la période contrôlée : fin de la journée, ou l'heure du contrôle pour la journée en cours.
  ADD COLUMN covered_until timestamptz,
  ADD COLUMN attempts      int NOT NULL DEFAULT 0,
  -- Dernier lancement manuel par un administrateur (NULL : contrôle de nuit du worker).
  ADD COLUMN triggered_by  uuid REFERENCES users (id);

-- 2. Lignes des relevés, telles que l'agrégateur les a transmises : un mouvement d'argent par ligne.
CREATE TABLE provider_statement_lines (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider      text NOT NULL,
  provider_ref  text NOT NULL,          -- identifiant du mouvement chez l'agrégateur
  kind          text NOT NULL CHECK (kind IN ('collection', 'payout', 'refund', 'other')),
  reference     text,                   -- notre référence (paiement, reversement, remboursement)
  known         boolean NOT NULL,       -- la référence désigne bien une opération Zandu de cet agrégateur
  amount        bigint NOT NULL CHECK (amount <> 0), -- effet sur le solde hors frais : + entrée, − sortie
  fee           bigint NOT NULL DEFAULT 0 CHECK (fee >= 0),
  occurred_at   timestamptz NOT NULL,
  description   text,
  run_id        uuid NOT NULL REFERENCES reconciliation_runs (id), -- premier contrôle qui l'a lue
  UNIQUE (provider, provider_ref)
);
CREATE INDEX provider_statement_lines_reference ON provider_statement_lines (provider, kind, reference);
CREATE INDEX provider_statement_lines_occurred ON provider_statement_lines (provider, occurred_at);

-- 3. Écarts : un écart est identifié par ce qu'il concerne, pour ne jamais être signalé deux fois.
--    operation_kind : collection, payout, refund, other (mouvement propre à l'agrégateur),
--    fee (frais d'une opération) ou balance (solde inexpliqué de la journée, reference = date).
ALTER TABLE reconciliation_discrepancies
  ADD COLUMN provider        text NOT NULL,
  ADD COLUMN operation_kind  text NOT NULL
    CHECK (operation_kind IN ('collection', 'payout', 'refund', 'other', 'fee', 'balance')),
  ADD COLUMN provider_ref    text,
  ADD COLUMN auto_resolved   boolean NOT NULL DEFAULT false,
  -- Écriture de régularisation passée à la résolution (frais, apport, compte d'attente).
  ADD COLUMN adjustment_transaction_id uuid UNIQUE REFERENCES ledger_transactions (id),
  DROP CONSTRAINT reconciliation_discrepancies_kind_check,
  ADD CONSTRAINT reconciliation_discrepancies_kind_check CHECK (kind IN
    ('missing_internal', 'missing_provider', 'amount_mismatch', 'status_mismatch',
     'fee_mismatch', 'balance_mismatch')),
  ADD CHECK ((resolved_at IS NULL) = (resolution_note IS NULL));
CREATE UNIQUE INDEX reconciliation_discrepancies_identity
  ON reconciliation_discrepancies (provider, kind, operation_kind, reference);
CREATE INDEX reconciliation_discrepancies_open
  ON reconciliation_discrepancies (provider, created_at) WHERE resolved_at IS NULL;
CREATE INDEX reconciliation_discrepancies_run ON reconciliation_discrepancies (run_id);

-- Argent versé par Zandu sur son compte agrégateur (fonds de roulement des reversements).
INSERT INTO ledger_accounts (code, type, name) VALUES
  ('liability:platform_funding', 'liability', 'Apports de Zandu sur le compte de l''agrégateur');

-- 4. Agrégateur simulé (développement, tests, recette ; interdit en production) : ses propres
--    comptes, tenus comme ceux d'un vrai agrégateur et indépendants des nôtres. L'API et le
--    worker, deux processus, les partagent ; le relevé du simulateur se lit ici.
CREATE SCHEMA simulator;
CREATE TABLE simulator.operations (
  provider_ref  text PRIMARY KEY,
  reference     text UNIQUE,          -- référence Zandu ; NULL pour un mouvement propre (frais de compte)
  kind          text NOT NULL CHECK (kind IN ('collection', 'payout', 'refund', 'other')),
  amount        bigint NOT NULL,      -- effet sur le solde hors frais : + collecte, − sortie
  fee           bigint NOT NULL DEFAULT 0,
  fee_announced boolean NOT NULL DEFAULT false, -- frais aussi annoncés par webhook (sinon : relevé seul)
  msisdn        text,
  status        text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  failure_code  text,
  -- false : le mouvement pèse sur le solde mais manque au relevé détaillé (essai d'écart de solde).
  listed        boolean NOT NULL DEFAULT true,
  description   text,
  settled_at    timestamptz,
  created_at    timestamptz NOT NULL
);
CREATE INDEX simulator_operations_settled ON simulator.operations (settled_at)
  WHERE status = 'succeeded';
