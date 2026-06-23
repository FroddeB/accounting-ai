import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { economic } from "../clients/economic.js";
import { withAudit } from "../db/audit.js";

/**
 * Read-only e-conomic tools. Every handler runs inside `withAudit`, so a row is
 * written to the audit trail on every call (success or error) before the result
 * is returned to the agent.
 *
 * Scope note: these four endpoints are stable in the REST API and work against
 * the free "demo with data" sandbox (tokens "demo"/"demo", GET-only). The
 * general-ledger `list_transactions` (entries) tool is intentionally NOT here
 * yet — its exact endpoint/pagination must be confirmed against the sandbox
 * first (plan §2.1, §7). Add it once verified.
 */

// Actor identity is a placeholder until per-connection auth identity is wired
// through the MCP transport (see server.ts). For now all calls share one actor.
const ACTOR = "mcp-agent";

/** Shape a successful tool result the way the MCP SDK expects. */
function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

export function registerEconomicReadTools(server: McpServer): void {
  server.registerTool(
    "list_customers",
    {
      title: "List customers",
      description:
        "List customers from e-conomic. Cursor-paginated under the hood; returns up to `limit` rows.",
      inputSchema: {
        limit: z.number().int().min(1).max(1000).default(100)
          .describe("Maximum number of customers to return."),
        pageSize: z.number().int().min(1).max(1000).default(100)
          .describe("Server-side page size used while following the pagination cursor."),
      },
    },
    async ({ limit, pageSize }) =>
      withAudit(
        { actor: ACTOR, toolName: "list_customers", request: { limit, pageSize } },
        async () => {
          const customers = await economic.collect<Record<string, unknown>>(
            `/customers?pagesize=${pageSize}`,
            limit,
          );
          return ok({ count: customers.length, customers });
        },
      ),
  );

  server.registerTool(
    "list_suppliers",
    {
      title: "List suppliers",
      description: "List suppliers from e-conomic. Cursor-paginated; returns up to `limit` rows.",
      inputSchema: {
        limit: z.number().int().min(1).max(1000).default(100),
        pageSize: z.number().int().min(1).max(1000).default(100),
      },
    },
    async ({ limit, pageSize }) =>
      withAudit(
        { actor: ACTOR, toolName: "list_suppliers", request: { limit, pageSize } },
        async () => {
          const suppliers = await economic.collect<Record<string, unknown>>(
            `/suppliers?pagesize=${pageSize}`,
            limit,
          );
          return ok({ count: suppliers.length, suppliers });
        },
      ),
  );

  server.registerTool(
    "list_accounts",
    {
      title: "List chart-of-accounts",
      description:
        "List the chart of accounts from e-conomic, including each account's current balance.",
      inputSchema: {
        limit: z.number().int().min(1).max(2000).default(500),
        pageSize: z.number().int().min(1).max(1000).default(200),
      },
    },
    async ({ limit, pageSize }) =>
      withAudit(
        { actor: ACTOR, toolName: "list_accounts", request: { limit, pageSize } },
        async () => {
          const accounts = await economic.collect<Record<string, unknown>>(
            `/accounts?pagesize=${pageSize}`,
            limit,
          );
          return ok({ count: accounts.length, accounts });
        },
      ),
  );

  server.registerTool(
    "get_account_balance",
    {
      title: "Get account balance",
      description:
        "Fetch a single ledger account by its account number and return its current balance.",
      inputSchema: {
        accountNumber: z.number().int().describe("The e-conomic account number, e.g. 1000."),
      },
    },
    async ({ accountNumber }) =>
      withAudit(
        { actor: ACTOR, toolName: "get_account_balance", request: { accountNumber } },
        async () => {
          const account = await economic.get<{
            accountNumber: number;
            name?: string;
            balance?: number;
            accountType?: string;
          }>(`/accounts/${accountNumber}`);
          return ok({
            accountNumber: account.accountNumber,
            name: account.name ?? null,
            balance: account.balance ?? null,
            accountType: account.accountType ?? null,
          });
        },
      ),
  );
}
