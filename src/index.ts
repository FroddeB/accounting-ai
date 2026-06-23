import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { buildServer } from "./server.js";
import { pool } from "./db/pool.js";
import { loadUser } from "./auth/middleware.js";
import { authRouter } from "./api/auth.js";
import { bilagRouter } from "./api/bilag.js";
import { dashboardRouter } from "./api/dashboard.js";
import { ensureAdmin } from "./auth/service.js";

/**
 * One Express server hosting three things:
 *   1. POST /mcp        — remote MCP over Streamable HTTP (bearer-token gated)
 *   2. /api/*           — the web app's JSON API (cookie-session auth)
 *   3. /                — the built React SPA (static)
 */

const app = express();
app.use(express.json({ limit: "8mb" }));
app.use(loadUser); // populate req.user from the session cookie when present

/** Bearer-token gate for the MCP endpoint (separate from the web-app session auth). */
function requireMcpAuth(req: Request, res: Response): boolean {
  const header = req.headers.authorization ?? "";
  const expected = `Bearer ${config.mcpAuthToken}`;
  if (header !== expected) {
    res
      .status(401)
      .set("WWW-Authenticate", 'Bearer realm="accounting-ai", error="invalid_token"')
      .json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
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

// ── Web app API ──────────────────────────────────────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/bilag", bilagRouter);
app.use("/api/dashboard", dashboardRouter);

// ── MCP endpoint ─────────────────────────────────────────────────────────────
app.post("/mcp", async (req, res) => {
  if (!requireMcpAuth(req, res)) return;
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
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
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});
app.get("/mcp", (_req, res) => res.status(405).json({ error: "Method Not Allowed" }));
app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Method Not Allowed" }));

// ── Static SPA (built by `web`) ──────────────────────────────────────────────
const webDist = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  // SPA fallback: any non-API, non-MCP GET serves index.html (client-side routing).
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api") || req.path.startsWith("/mcp")) return next();
    res.sendFile(join(webDist, "index.html"));
  });
} else {
  console.warn(`[accounting-ai] web build not found at ${webDist} — SPA not served`);
}

app.listen(config.port, async () => {
  console.log(`[accounting-ai] listening on :${config.port}`);
  console.log(`[accounting-ai] dry-run default: ${config.dryRunDefault}`);
  try {
    await ensureAdmin();
    console.log(`[accounting-ai] admin ensured: ${config.adminEmail}`);
  } catch (err) {
    console.error("[accounting-ai] failed to ensure admin:", err);
  }
});
