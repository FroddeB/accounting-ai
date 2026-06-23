# Accounting Management MCP System — Build Spec

> **Purpose:** Build an MCP server (deployed on Railway) that gives a Claude agent controlled tools to manage Danish accounting and payroll via the **e-conomic** and **Salary.dk** APIs.
> **Stack:** Node.js + TypeScript, PostgreSQL, deployed via GitHub → Railway. MCP server exposed over HTTP/SSE.
> **Audience:** This document is written for Claude Code to implement.

---

## 0. Context & constraints

- e-conomic is already connected to **Lunar Bank**, so new bank transactions/transfers appear in e-conomic automatically. We are **not** building bank sync — we are building an agent layer on top.
- This system can **move money and run payroll**. Treat write operations as high-risk. Default to read-only + propose-only until the audit trail is trusted.
- Danish **bogføringsloven** (Bookkeeping Act) requires a complete, tamper-evident transaction trail. The audit log is a near-compliance requirement, not optional polish.

---

## 1. Architecture

```
Claude Code / Claude.ai  ──MCP (SSE/HTTP)──►  MCP Server (Railway)
                                                  ├── e-conomic toolset ──► e-conomic REST + OpenAPI
                                                  └── salary toolset    ──► Salary.dk API
                                              PostgreSQL (audit log, token store, cache)
```

**Decision: one server, two toolsets.** Simpler to deploy and lets a single agent reason across both domains (e.g. "book this salary payment against the payroll run"). Revisit only if we need hard permission boundaries between accounting and payroll.

---

## 2. API facts to design around

### e-conomic (proprietary two-token auth — NOT OAuth)

Every request requires these headers:

```
X-AppSecretToken: <app secret token>
X-AgreementGrantToken: <agreement grant token>
Content-Type: application/json
```

- **AppSecretToken** — obtained by registering a free developer agreement and creating an app. Shown once; store securely.
- **AgreementGrantToken** — obtained by installing that app against the *live* (data-containing) agreement.

**Critical quirks:**
1. **Two parallel APIs.** Older REST API (`https://restdocs.e-conomic.com/`) and newer OpenAPI (`https://apis.e-conomic.com/`). Functionality is split across both with different pagination behavior. We need both. Daybook/journal endpoints (Kassekladde) are on the OpenAPI.
2. **No PATCH.** The REST API does not support PATCH on JSON documents. Updates are **full-document PUTs** — fetch the entire entity, modify, send it back whole.
3. **Cursor-based pagination** — cannot jump to a page or use limit/offset directly.
4. **Pre-fetched references required for creates.** Layout, payment terms, VAT zone, currency, and account references must be resolved per agreement before creating an invoice/customer/entry.
5. **Validation on write.** Invalid data returns `400 Bad Request` with an annotated error document mirroring the payload.

Docs: `https://restdocs.e-conomic.com/`, `https://apis.e-conomic.com/`, connect guide at `https://www.e-conomic.com/developer/connect`.
Use the free **"demo with data"** sandbox agreement for all testing before touching production.

### Salary.dk

- API at `https://api.salary.dk` with auth via an **account-level API key** (same model as its native integrations).
- Public docs are thin (`https://api.salary.dk/docs`). **Action item:** request the exact API spec (REST vs GraphQL, endpoints, auth header format) from Salary.dk support, or pull the schema once a key is issued. This is the project's biggest unknown — do not assume endpoint shapes.

---

## 3. Environment variables (Railway)

Store all secrets as Railway environment variables. Never commit them.

```
ECONOMIC_APP_SECRET_TOKEN=
ECONOMIC_AGREEMENT_GRANT_TOKEN=
ECONOMIC_API_BASE_REST=https://restapi.e-conomic.com
ECONOMIC_API_BASE_OPENAPI=https://apis.e-conomic.com
SALARY_API_KEY=
SALARY_API_BASE=https://api.salary.dk
DATABASE_URL=                # provided by Railway Postgres plugin
MCP_AUTH_TOKEN=              # shared secret to protect the MCP endpoint
DRY_RUN_DEFAULT=true
```

---

## 4. Build phases

### Phase 1 — Foundations & credentials
- [ ] Register e-conomic developer agreement, create an app (role: SuperUser for testing, scope down later).
- [ ] Capture AppSecretToken; install app against live agreement to get AgreementGrantToken.
- [ ] Create the "demo with data" sandbox agreement for testing.
- [ ] Request Salary.dk API key from the Salary admin panel.
- [ ] Set all env vars in Railway.

### Phase 2 — API client layer
Build typed TypeScript clients for each service. Fully unit-testable against the sandbox before any MCP wiring.
- [ ] Header injection for both e-conomic tokens.
- [ ] Cursor-pagination iterator helper.
- [ ] Fetch-modify-PUT helper for e-conomic updates (full-document).
- [ ] Reference resolver (layout, payment terms, VAT zone, currency, account).
- [ ] Retry/backoff + rate-limit handling.
- [ ] Salary client (finalize once API spec confirmed).

### Phase 3 — MCP server
Use the official **MCP TypeScript SDK**. Expose over **HTTP/SSE** so Railway can host it and Claude can connect remotely. Protect the endpoint with `MCP_AUTH_TOKEN`.

Initial toolset:

**e-conomic (read)**
- `list_transactions`
- `get_account_balance`
- `list_invoices`
- `list_customers`
- `list_suppliers`
- `get_vat_summary`
- `list_draft_entries`

**e-conomic (write)**
- `create_journal_entry`
- `book_draft_entry`
- `create_supplier_invoice`
- `reconcile_transaction`

**Salary (read)**
- `list_employees`
- `get_payroll_run`
- `list_salary_components`

**Salary (write)**
- `create_employee`
- `register_supplement`
- `approve_payroll_run`

### Phase 4 — Safety, audit, approvals (most important)
- [ ] **Audit log** in PostgreSQL: every tool call recorded with actor, tool, timestamp, request payload, response/result. Append-only.
- [ ] **Read/write separation:** destructive tools require an explicit confirmation argument OR a two-step propose → approve flow. The agent must not silently book entries or approve a payroll run.
- [ ] **Dry-run mode** for every write tool (default ON via `DRY_RUN_DEFAULT`).
- [ ] **Idempotency keys** on writes to prevent duplicate bookings on retries.

### Phase 5 — Deploy & connect
- [ ] Deploy as a **separate Railway service** via the existing GitHub pipeline.
- [ ] Add the MCP server URL as a custom connector in Claude.
- [ ] Validate end-to-end against the sandbox, then cut over to production tokens.

---

## 5. Suggested data model (PostgreSQL)

```sql
-- Append-only audit trail (bogføringsloven-friendly)
CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor         TEXT NOT NULL,          -- agent / user identifier
  tool_name     TEXT NOT NULL,
  request_json  JSONB NOT NULL,
  response_json JSONB,
  status        TEXT NOT NULL,          -- success | error | dry_run | proposed | approved
  dry_run       BOOLEAN NOT NULL DEFAULT false,
  idempotency_key TEXT
);

-- Two-step approval queue for write actions
CREATE TABLE pending_actions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  tool_name     TEXT NOT NULL,
  payload_json  JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | executed
  approved_at   TIMESTAMPTZ,
  executed_at   TIMESTAMPTZ
);

-- Optional cached reference data to avoid repeated lookups
CREATE TABLE econsize_refs (
  ref_type      TEXT NOT NULL,          -- layout | payment_term | vat_zone | currency | account
  ref_key       TEXT NOT NULL,
  ref_value     JSONB NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ref_type, ref_key)
);
```

---

## 6. Open decisions

1. **Write authority.** Recommend starting **read-only + propose-only**; enable auto-write tools only once the audit trail is trusted.
2. **Webhooks.** e-conomic has a Webhooks API. Instead of polling for new bank transactions, have e-conomic push them to the Railway service (more responsive, cheaper). Add in a later phase.
3. **Salary API shape.** Blocked on confirming REST vs GraphQL and exact endpoints — resolve in Phase 1.

---

## 7. First implementation target

Start narrow and safe:
1. Scaffold the repo (MCP server skeleton + e-conomic client with two-token auth + Postgres audit schema).
2. Implement **read-only** e-conomic tools (`list_transactions`, `get_account_balance`) against the sandbox.
3. Verify audit logging works on every call.
4. Only then add propose/approve write tools.
