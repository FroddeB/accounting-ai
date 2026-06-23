import { Router } from "express";
import multer from "multer";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import {
  listJournals,
  listVouchersWithAttachmentStatus,
  uploadVoucherAttachment,
  deleteVoucherAttachment,
} from "../clients/economicBilag.js";
import { recordAudit } from "../db/audit.js";
import { getIgnoredKeys, addIgnored, removeIgnored, ignoreKey, type IgnoreInput } from "../db/ignored.js";

export const bilagRouter = Router();

// Everything under /api/bilag requires a logged-in user.
bilagRouter.use(requireAuth);

const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (_req, file, cb) => cb(null, ALLOWED.has(file.mimetype)),
});

// List journals (daybooks).
bilagRouter.get("/journals", async (_req, res) => {
  try {
    res.json({ journals: await listJournals() });
  } catch (err) {
    console.error("[bilag] journals:", err);
    res.status(502).json({ error: "Failed to load journals from e-conomic" });
  }
});

// List a journal's vouchers, each flagged hasAttachment + ignored.
bilagRouter.get("/journals/:journalNumber/vouchers", async (req, res) => {
  try {
    const journalNumber = Number(req.params.journalNumber);
    const [base, ignored] = await Promise.all([
      listVouchersWithAttachmentStatus(journalNumber),
      getIgnoredKeys(),
    ]);
    const vouchers = base.map((v) => ({
      ...v,
      ignored: ignored.has(ignoreKey(v.accountingYear, v.voucherNumber)),
    }));
    res.json({
      journalNumber,
      total: vouchers.length,
      // "missing" = no attachment AND not ignored (the actionable set).
      missing: vouchers.filter((v) => !v.hasAttachment && !v.ignored).length,
      ignored: vouchers.filter((v) => v.ignored).length,
      vouchers,
    });
  } catch (err) {
    console.error("[bilag] vouchers:", err);
    res.status(502).json({ error: "Failed to load vouchers from e-conomic" });
  }
});

// Ignore one or more vouchers (flag in our DB only). Body: { vouchers: IgnoreInput[], reason? }.
bilagRouter.post("/ignore", async (req: AuthedRequest, res) => {
  try {
    const vouchers = (req.body?.vouchers ?? []) as IgnoreInput[];
    if (!Array.isArray(vouchers) || vouchers.length === 0) {
      res.status(400).json({ error: "Provide a non-empty 'vouchers' array" });
      return;
    }
    const added = await addIgnored(vouchers, req.user!.email, req.body?.reason);
    await recordAudit({
      actor: req.user!.email,
      toolName: "bilag.ignore",
      request: { count: vouchers.length, keys: vouchers.map((v) => ignoreKey(v.accountingYear, v.voucherNumber)), reason: req.body?.reason },
      response: { added },
      status: "success",
    });
    res.json({ ok: true, added });
  } catch (err) {
    console.error("[bilag] ignore:", err);
    res.status(500).json({ error: "Failed to ignore vouchers" });
  }
});

// Un-ignore one or more vouchers. Body: { vouchers: [{ accountingYear, voucherNumber }] }.
bilagRouter.post("/unignore", async (req: AuthedRequest, res) => {
  try {
    const vouchers = (req.body?.vouchers ?? []) as { accountingYear: string; voucherNumber: number }[];
    if (!Array.isArray(vouchers) || vouchers.length === 0) {
      res.status(400).json({ error: "Provide a non-empty 'vouchers' array" });
      return;
    }
    const removed = await removeIgnored(vouchers);
    await recordAudit({
      actor: req.user!.email,
      toolName: "bilag.unignore",
      request: { count: vouchers.length, keys: vouchers.map((v) => ignoreKey(v.accountingYear, v.voucherNumber)) },
      response: { removed },
      status: "success",
    });
    res.json({ ok: true, removed });
  } catch (err) {
    console.error("[bilag] unignore:", err);
    res.status(500).json({ error: "Failed to un-ignore vouchers" });
  }
});

// Upload a bilag (receipt/invoice) to a voucher.
bilagRouter.post(
  "/journals/:journalNumber/vouchers/:voucherId/attachment",
  upload.single("file"),
  async (req: AuthedRequest, res) => {
    const journalNumber = Number(req.params.journalNumber);
    const voucherId = String(req.params.voucherId);
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded (allowed: PDF, JPEG, PNG, HEIC, WEBP)" });
      return;
    }
    try {
      await uploadVoucherAttachment(journalNumber, voucherId, file.buffer, file.mimetype, file.originalname);
      await recordAudit({
        actor: req.user!.email,
        toolName: "bilag.upload",
        request: { journalNumber, voucherId, filename: file.originalname, mimetype: file.mimetype, size: file.size },
        response: { ok: true },
        status: "success",
      });
      res.json({ ok: true });
    } catch (err) {
      await recordAudit({
        actor: req.user!.email,
        toolName: "bilag.upload",
        request: { journalNumber, voucherId, filename: file.originalname },
        response: { error: err instanceof Error ? err.message : String(err) },
        status: "error",
      });
      console.error("[bilag] upload:", err);
      res.status(502).json({ error: "Upload to e-conomic failed" });
    }
  },
);

// Remove a voucher's attachment.
bilagRouter.delete("/journals/:journalNumber/vouchers/:voucherId/attachment", async (req: AuthedRequest, res) => {
  try {
    const journalNumber = Number(req.params.journalNumber);
    await deleteVoucherAttachment(journalNumber, String(req.params.voucherId));
    await recordAudit({
      actor: req.user!.email,
      toolName: "bilag.delete_attachment",
      request: { journalNumber, voucherId: req.params.voucherId },
      response: { ok: true },
      status: "success",
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[bilag] delete:", err);
    res.status(502).json({ error: "Delete failed" });
  }
});
