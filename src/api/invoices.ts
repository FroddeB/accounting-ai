import { Router } from "express";
import multer from "multer";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { processInvoice, confirmJob, rejectJob } from "../ai/invoices.js";
import { listJobs, getJob } from "../db/aiJobs.js";
import { isConfigured } from "../ai/anthropic.js";

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth); // any logged-in member can upload invoices

const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED.has(file.mimetype)),
});

// Upload an invoice/receipt → Claude extracts + suggests a voucher. Returns the job.
invoicesRouter.post("/", upload.single("file"), async (req: AuthedRequest, res) => {
  if (!isConfigured()) {
    res.status(503).json({ error: "AI is not configured (ANTHROPIC_API_KEY missing)" });
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded (allowed: PDF, JPEG, PNG, GIF, WEBP)" });
    return;
  }
  try {
    const jobId = await processInvoice({
      source: "upload",
      createdBy: req.user!.email,
      filename: file.originalname,
      mimetype: file.mimetype,
      bytes: file.buffer,
    });
    res.json(await getJob(jobId));
  } catch (err) {
    console.error("[invoices] process:", err);
    res.status(500).json({ error: "Failed to process invoice" });
  }
});

// History: list AI jobs.
invoicesRouter.get("/", async (_req, res) => {
  try {
    res.json({ jobs: await listJobs() });
  } catch (err) {
    console.error("[invoices] list:", err);
    res.status(500).json({ error: "Failed to load history" });
  }
});

// Single job.
invoicesRouter.get("/:id", async (req, res) => {
  const job = await getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(job);
});

// Confirm a suggestion → attach to the chosen voucher.
invoicesRouter.post("/:id/confirm", async (req: AuthedRequest, res) => {
  const voucherId = String(req.body?.voucherId ?? "");
  if (!voucherId) {
    res.status(400).json({ error: "voucherId required" });
    return;
  }
  try {
    await confirmJob(String(req.params.id), voucherId, req.user!.email);
    res.json(await getJob(String(req.params.id)));
  } catch (err) {
    console.error("[invoices] confirm:", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Attach failed" });
  }
});

// Reject a suggestion.
invoicesRouter.post("/:id/reject", async (req: AuthedRequest, res) => {
  try {
    await rejectJob(String(req.params.id), req.user!.email);
    res.json(await getJob(String(req.params.id)));
  } catch (err) {
    console.error("[invoices] reject:", err);
    res.status(500).json({ error: "Reject failed" });
  }
});
