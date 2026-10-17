-- Rapports d'activité du back-office : les commandes et les reversements se lisent par période.
CREATE INDEX orders_paid_at ON orders (paid_at) WHERE paid_at IS NOT NULL;
CREATE INDEX payouts_succeeded_at ON payouts (succeeded_at) WHERE status = 'succeeded';
CREATE INDEX ledger_entries_created_at ON ledger_entries (created_at);
