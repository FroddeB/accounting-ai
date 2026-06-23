import { query } from "./pool.js";

export type AuditStatus =
  | "success"
  | "error"
  | "dry_run"
  | "proposed"
  | "approved";

export interface AuditEntry {
  actor: string;
  toolName: string;
  request: unknown;
  response?: unknown;
  status: AuditStatus;
  dryRun?: boolean;
  idempotencyKey?: string;
}

/**
 * Append a row to the immutable audit trail. Never throws into the caller's
 * happy path — a failed audit write is logged but must not mask the tool result
 * (and in production should trip an alert).
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_log
         (actor, tool_name, request_json, response_json, status, dry_run, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.actor,
        entry.toolName,
        JSON.stringify(entry.request ?? null),
        entry.response === undefined ? null : JSON.stringify(entry.response),
        entry.status,
        entry.dryRun ?? false,
        entry.idempotencyKey ?? null,
      ],
    );
  } catch (err) {
    console.error("[audit] FAILED to write audit entry:", err, entry.toolName);
  }
}

/**
 * Wrap a tool handler so that every invocation — success or failure — produces
 * exactly one audit row. Returns the handler's result unchanged.
 */
export async function withAudit<T>(
  meta: { actor: string; toolName: string; request: unknown; dryRun?: boolean; idempotencyKey?: string },
  run: () => Promise<T>,
): Promise<T> {
  try {
    const response = await run();
    await recordAudit({
      ...meta,
      response,
      status: meta.dryRun ? "dry_run" : "success",
    });
    return response;
  } catch (err) {
    await recordAudit({
      ...meta,
      response: { error: err instanceof Error ? err.message : String(err) },
      status: "error",
    });
    throw err;
  }
}
