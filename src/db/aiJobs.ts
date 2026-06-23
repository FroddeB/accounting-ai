import { query } from "./pool.js";
import type { MatchResult } from "../ai/anthropic.js";

export interface AiJob {
  id: string;
  created_at: string;
  source: string;
  created_by: string;
  filename: string | null;
  mimetype: string | null;
  status: string;
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  currency: string | null;
  total_amount: string | null;
  match_journal_number: number | null;
  match_voucher_id: string | null;
  match_voucher_number: number | null;
  match_confidence: string | null;
  match_reasoning: string | null;
  ai_raw: unknown;
  attached_voucher_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  error: string | null;
}

/** Columns safe to return to the client (everything except the file bytes). */
const PUBLIC_COLS = `id, created_at, source, created_by, filename, mimetype, status,
  supplier_name, invoice_number, invoice_date, currency, total_amount,
  match_journal_number, match_voucher_id, match_voucher_number, match_confidence, match_reasoning,
  ai_raw, attached_voucher_id, decided_by, decided_at, error`;

export async function createJob(input: {
  source: string;
  createdBy: string;
  filename: string;
  mimetype: string;
  fileData: Buffer;
}): Promise<string> {
  const r = await query<{ id: string }>(
    `INSERT INTO ai_jobs (source, created_by, filename, mimetype, file_data, status)
     VALUES ($1, $2, $3, $4, $5, 'processing') RETURNING id`,
    [input.source, input.createdBy, input.filename, input.mimetype, input.fileData],
  );
  return r.rows[0].id;
}

export async function saveSuggestion(
  id: string,
  journalNumber: number,
  result: MatchResult,
): Promise<void> {
  await query(
    `UPDATE ai_jobs SET status = 'suggested',
        supplier_name = $2, invoice_number = $3, invoice_date = $4, currency = $5, total_amount = $6,
        match_journal_number = $7, match_voucher_id = $8, match_voucher_number = $9,
        match_confidence = $10, match_reasoning = $11, ai_raw = $12
     WHERE id = $1`,
    [
      id,
      result.invoice.supplierName,
      result.invoice.invoiceNumber,
      result.invoice.invoiceDate,
      result.invoice.currency,
      result.invoice.totalAmount,
      journalNumber,
      result.match.voucherId,
      result.match.voucherNumber,
      result.match.confidence,
      result.match.reasoning,
      JSON.stringify(result),
    ],
  );
}

export async function markError(id: string, message: string): Promise<void> {
  await query(`UPDATE ai_jobs SET status = 'error', error = $2 WHERE id = $1`, [id, message]);
}

export async function getJob(id: string): Promise<AiJob | null> {
  const r = await query<AiJob>(`SELECT ${PUBLIC_COLS} FROM ai_jobs WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function getJobFile(id: string): Promise<{ mimetype: string; filename: string; data: Buffer } | null> {
  const r = await query<{ mimetype: string; filename: string; file_data: Buffer | null }>(
    `SELECT mimetype, filename, file_data FROM ai_jobs WHERE id = $1`,
    [id],
  );
  const row = r.rows[0];
  if (!row || !row.file_data) return null;
  return { mimetype: row.mimetype, filename: row.filename, data: row.file_data };
}

export async function listJobs(limit = 100): Promise<AiJob[]> {
  const r = await query<AiJob>(
    `SELECT ${PUBLIC_COLS} FROM ai_jobs ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return r.rows;
}

/** Mark attached and clear the stored file bytes (no longer needed). */
export async function markAttached(id: string, voucherId: string, decidedBy: string): Promise<void> {
  await query(
    `UPDATE ai_jobs SET status = 'attached', attached_voucher_id = $2, decided_by = $3,
        decided_at = now(), file_data = NULL WHERE id = $1`,
    [id, voucherId, decidedBy],
  );
}

export async function markRejected(id: string, decidedBy: string): Promise<void> {
  await query(
    `UPDATE ai_jobs SET status = 'rejected', decided_by = $2, decided_at = now(), file_data = NULL WHERE id = $1`,
    [id, decidedBy],
  );
}
