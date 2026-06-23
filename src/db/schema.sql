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

-- ── Web app: users & email-based auth ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT,                  -- NULL until the user sets one via reset
  display_name    TEXT,
  is_admin        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at   TIMESTAMPTZ
);

-- Normalise email lookups to lowercase.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

-- Short-lived single-use tokens for email 2FA codes and password resets.
CREATE TABLE IF NOT EXISTS email_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose       TEXT NOT NULL,           -- 'twofa' | 'password_reset'
  code_hash     TEXT NOT NULL,           -- hashed OTP / reset token
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  attempts      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_tokens_user_purpose_idx
  ON email_tokens (user_id, purpose, expires_at);

-- Vouchers a user has chosen to "ignore" (flagged only in our DB, never in
-- e-conomic). Ignored vouchers are hidden from the missing/all views and shown
-- only under the "ignored" filter. Keyed like the attachment cross-reference:
-- (accounting_year, voucher_number) is unique per agreement.
CREATE TABLE IF NOT EXISTS ignored_vouchers (
  accounting_year TEXT NOT NULL,
  voucher_number  INT NOT NULL,
  journal_number  INT NOT NULL,
  voucher_id      TEXT NOT NULL,
  ignored_by      TEXT NOT NULL,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (accounting_year, voucher_number)
);

-- Optional cached reference data to avoid repeated per-agreement lookups
-- (layout, payment terms, VAT zone, currency, account references).
CREATE TABLE IF NOT EXISTS economic_refs (
  ref_type   TEXT NOT NULL,   -- layout | payment_term | vat_zone | currency | account
  ref_key    TEXT NOT NULL,
  ref_value  JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ref_type, ref_key)
);
