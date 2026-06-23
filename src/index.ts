import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { buildServer } from "./server.js";
import { pool } from "./db/pool.js";

/**
 * Remote MCP server over Streamable HTTP (stateless).
 *
 * Each POST /mcp spins up a fresh server + transport, handles the single
 * request, then tears down — no session affinity required, which keeps Railway
 * horizontal scaling trivial. The endpoint is protected by a shared bearer
 * token (MCP_AUTH_TOKEN); a missing/invalid token returns 401 with a
 * WWW-Authenticate header so clients can detect the auth requirement.
 */

const app = express();
app.use(express.json({ limit: "4mb" }));

/** Bearer-token gate for the MCP endpoint. */
function requireAuth(req: Request, res: Response): boolean {
  const header = req.headers.authorization ?? "";
  const expected = `Bearer ${config.mcpAuthToken}`;
  if (header !== expected) {
    res
      .status(401)
      .set("WWW-Authenticate", 'Bearer realm="accounting-ai", error="invalid_token"')
      .json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
    return false;
  }
  return true;
}

// Health check (unauthenticated) for Railway.
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "degraded", db: "unreachable" });
  }
});

app.post("/mcp", async (req, res) => {
  if (!requireAuth(req, res)) return;

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcp] request handling error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless server: GET (SSE stream) and DELETE (session teardown) are not used.
app.get("/mcp", (_req, res) => res.status(405).json({ error: "Method Not Allowed" }));
app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Method Not Allowed" }));

app.listen(config.port, () => {
  console.log(`[accounting-ai] MCP server listening on :${config.port}`);
  console.log(`[accounting-ai] dry-run default: ${config.dryRunDefault}`);
});
