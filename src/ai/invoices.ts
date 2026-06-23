import { listVouchersWithAttachmentStatus, uploadVoucherAttachment } from "../clients/economicBilag.js";
import { getIgnoredKeys, ignoreKey } from "../db/ignored.js";
import { extractAndMatch, type VoucherCandidate } from "./anthropic.js";
import * as jobs from "../db/aiJobs.js";
import { recordAudit } from "../db/audit.js";

// The bank feed lands in journal 1 ("Daglig"); candidates come from there.
const JOURNAL = 1;

/** Candidate vouchers = drafts in the journal that are missing a bilag and not ignored. */
async function candidates(): Promise<VoucherCandidate[]> {
  const [vouchers, ignored] = await Promise.all([
    listVouchersWithAttachmentStatus(JOURNAL),
    getIgnoredKeys(),
  ]);
  return vouchers
    .filter((v) => !v.hasAttachment && !ignored.has(ignoreKey(v.accountingYear, v.voucherNumber)))
    .map((v) => ({
      voucherId: v.voucherId,
      voucherNumber: v.voucherNumber,
      date: v.date,
      text: v.text,
      amount: v.amount,
    }));
}

/**
 * Process an uploaded (or, in future, emailed) invoice: store it, ask Claude to
 * extract + match against the missing-bilag vouchers, and record the suggestion.
 * Returns the created job id. Never attaches anything — that's a separate, human
 * confirmation step (confirmJob).
 */
export async function processInvoice(input: {
  source: "upload" | "email";
  createdBy: string;
  filename: string;
  mimetype: string;
  bytes: Buffer;
}): Promise<string> {
  const jobId = await jobs.createJob({
    source: input.source,
    createdBy: input.createdBy,
    filename: input.filename,
    mimetype: input.mimetype,
    fileData: input.bytes,
  });

  try {
    const cands = await candidates();
    const result = await extractAndMatch(input.bytes, input.mimetype, cands);
    await jobs.saveSuggestion(jobId, JOURNAL, result);
    await recordAudit({
      actor: input.createdBy,
      toolName: "ai.invoice_suggest",
      request: { jobId, filename: input.filename, source: input.source, candidateCount: cands.length },
      response: { supplier: result.invoice.supplierName, total: result.invoice.totalAmount, match: result.match },
      status: "success",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await jobs.markError(jobId, message);
    await recordAudit({
      actor: input.createdBy,
      toolName: "ai.invoice_suggest",
      request: { jobId, filename: input.filename, source: input.source },
      response: { error: message },
      status: "error",
    });
  }

  return jobId;
}

/** Confirm a suggestion: attach the stored file to the chosen voucher in e-conomic. */
export async function confirmJob(jobId: string, voucherId: string, actor: string): Promise<void> {
  const file = await jobs.getJobFile(jobId);
  if (!file) throw new Error("Job not found or already finalised (no file to attach)");

  await uploadVoucherAttachment(JOURNAL, voucherId, file.data, file.mimetype, file.filename);
  await jobs.markAttached(jobId, voucherId, actor);
  await recordAudit({
    actor,
    toolName: "ai.invoice_attach",
    request: { jobId, journalNumber: JOURNAL, voucherId, filename: file.filename },
    response: { ok: true },
    status: "success",
  });
}

export async function rejectJob(jobId: string, actor: string): Promise<void> {
  await jobs.markRejected(jobId, actor);
  await recordAudit({
    actor,
    toolName: "ai.invoice_reject",
    request: { jobId },
    response: { ok: true },
    status: "success",
  });
}
