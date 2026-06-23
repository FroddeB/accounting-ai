# accounting-ai

MCP server that gives a Claude agent controlled tools to manage Danish accounting
and payroll via the **e-conomic** and **Salary.dk** APIs. Deployed on Railway,
exposed to Claude over remote MCP (Streamable HTTP).

> ⚠️ This system can move money and run payroll. Write operations are high-risk
> and default to dry-run / propose-only. See [`docs/accounting-mcp-plan.md`](./docs/accounting-mcp-plan.md)
> for the full build spec and safety model.

## Status

Phase-7 scaffold (first implementation target):

- ✅ MCP server skeleton over Streamable HTTP with bearer-token auth
- ✅ e-conomic REST client (two-token auth, cursor pagination, fetch-modify-PUT, retry/backoff)
- ✅ PostgreSQL audit schema + `withAudit` wrapper (every tool call recorded)
- ✅ Read-only e-conomic tools: `list_customers`, `list_suppliers`, `list_accounts`, `get_account_balance`
- ⬜ `list_transactions` (general-ledger entries) — deferred until the exact endpoint is verified against the sandbox
- ⬜ Write tools (propose/approve + dry-run) — Phase 4
- ⬜ Salary.dk toolset — blocked on confirming the API spec

## Local development

```bash
cp .env.example .env          # fill in tokens; "demo"/"demo" works read-only against the sandbox
npm install
npm run db:init               # apply schema to the DATABASE_URL Postgres
npm run dev                   # tsx watch on http://localhost:3000
```

Smoke-test the endpoint (replace the token with your `MCP_AUTH_TOKEN`):

```bash
curl -s http://localhost:3000/health
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Layout

```
src/
  config.ts            env loading + validation (fail-fast)
  index.ts             express + Streamable HTTP transport + bearer auth
  server.ts            McpServer factory; registers toolsets
  clients/
    economic.ts        e-conomic REST client (two-token, pagination, PUT-update)
    salary.ts          Salary.dk client — STUB pending API spec
  db/
    pool.ts            pg pool
    schema.sql         audit_log, pending_actions, economic_refs
    audit.ts           recordAudit / withAudit
  tools/
    economicRead.ts    read-only e-conomic tools
scripts/
  db-init.ts           apply schema.sql (idempotent)
```

## Deploy (Railway)

`railway.json` builds with Nixpacks, runs `db:init` then `npm start`, and health-checks
`/health`. Set every variable from `.env.example` as a Railway service variable; add the
Postgres plugin to supply `DATABASE_URL`. Then add the service URL as a custom connector
in Claude with the bearer token.
