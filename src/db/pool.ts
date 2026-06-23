import pg from "pg";
import { config } from "../config.js";

/**
 * Shared PostgreSQL connection pool.
 * Railway's managed Postgres requires SSL in production; we relax cert
 * verification because Railway terminates with its own internal CA.
 */
const isLocal =
  config.databaseUrl.includes("localhost") ||
  config.databaseUrl.includes("127.0.0.1");

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => {
  // A pool-level error means an idle client died; log and let the pool recover.
  console.error("[db] unexpected pool error:", err);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as any[]);
}
