import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEconomicReadTools } from "./tools/economicRead.js";

/**
 * Build a fully-configured MCP server instance with all toolsets registered.
 *
 * A fresh server is created per request (stateless Streamable HTTP), so this
 * factory must be cheap and side-effect free beyond tool registration.
 */
export function buildServer(): McpServer {
  const server = new McpServer({
    name: "accounting-ai",
    version: "0.1.0",
  });

  // e-conomic read-only toolset (live).
  registerEconomicReadTools(server);

  // TODO: registerEconomicWriteTools(server)  — gated behind propose/approve + dry-run.
  // TODO: registerSalaryTools(server)         — blocked on confirming the Salary.dk API spec.

  return server;
}
