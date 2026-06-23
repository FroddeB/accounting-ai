-- Accounting-AI MCP — database schema
-- Run via `npm run db:init`. Idempotent (safe to re-run).

-- Append-only audit trail (bogføringsloven-friendly).
-- Every tool invocation is recorded here, success or failure.
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor           TEXT NOT NULL,          -- agent / user identifier
  tool_name       TEXT NOT NULL,
  request_json    JSONB NOT NULL,
  response_json   JSONB,
  status          TEXT NOT NULL,          -- success | error | dry_run | proposed | approved
  dry_run         BOOLEAN NOT NULL DEFAULT false,
  idempotency_key TEXT
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_tool_name_idx ON audit_log (tool_name);
-- Enforce idempotency: a given key may only succeed once.
CREATE UNIQUE INDEX IF NOT EXISTS audit_log_idem_unique
  ON audit_log (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status = 'success';

-- Two-step approval queue for write actions.
CREATE TABLE IF NOT EXISTS pending_actions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  tool_name     TEXT NOT NULL,
  payload_json  JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | executed
  approved_at   TIMESTAMPTZ,
  executed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pending_actions_status_idx ON pending_actions (status);

-- Optional cached reference data to avoid repeated per-agreement lookups
-- (layout, payment terms, VAT zone, currency, account references).
CREATE TABLE IF NOT EXISTS economic_refs (
  ref_type   TEXT NOT NULL,   -- layout | payment_term | vat_zone | currency | account
  ref_key    TEXT NOT NULL,
  ref_value  JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ref_type, ref_key)
);
