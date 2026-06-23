import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "../src/db/pool.js";

/**
 * Apply the database schema. Idempotent — the schema uses IF NOT EXISTS, so this
 * is safe to run on every deploy as a lightweight migration step.
 */
const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "src", "db", "schema.sql");

async function main(): Promise<void> {
  const sql = readFileSync(schemaPath, "utf8");
  console.log(`[db:init] applying schema from ${schemaPath}`);
  await pool.query(sql);
  console.log("[db:init] schema applied.");
  await pool.end();
}

main().catch((err) => {
  console.error("[db:init] FAILED:", err);
  process.exit(1);
});
