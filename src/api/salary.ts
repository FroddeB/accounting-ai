import { Router } from "express";
import multer from "multer";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import {
  salary, isConfigured, SalaryNotConfiguredError, SalaryApiError,
  type SalaryEmployeeInput,
} from "../clients/salary.js";
import { extractEmployeeFromContract } from "../ai/contracts.js";
import { isConfigured as aiConfigured } from "../ai/anthropic.js";
import { recordAudit } from "../db/audit.js";

export const salaryRouter = Router();
salaryRouter.use(requireAuth);

const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED.has(file.mimetype)),
});

// Whitelist the master-data fields we accept from the client (no salary/remuneration).
function pickEmployeeInput(body: Record<string, unknown>): SalaryEmployeeInput {
  const s = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
  return {
    name: s(body.name),
    email: s(body.email),
    phoneNumber: s(body.phoneNumber),
    phoneNumberCountryCode: s(body.phoneNumberCountryCode),
    address: s(body.address),
    postalCode: s(body.postalCode),
    city: s(body.city),
    affiliationType: s(body.affiliationType),
    language: s(body.language),
    departmentID: s(body.departmentID),
    nationalID: s(body.nationalID),
    bankRegistrationNumber: s(body.bankRegistrationNumber),
    bankAccountNumber: s(body.bankAccountNumber),
  };
}

function handle(res: import("express").Response, err: unknown, what: string): void {
  if (err instanceof SalaryNotConfiguredError) {
    res.status(503).json({ error: "Salary.dk is not configured (needs API client + company key)" });
  } else if (err instanceof SalaryApiError) {
    console.error(`[salary] ${what}:`, err.status, err.body);
    res.status(502).json({ error: `Salary.dk error (${err.status})`, detail: err.body });
  } else {
    console.error(`[salary] ${what}:`, err);
    res.status(500).json({ error: "Internal error" });
  }
}

salaryRouter.get("/status", (_req, res) => res.json({ configured: isConfigured() }));

salaryRouter.get("/employees", async (_req, res) => {
  try {
    res.json(await salary.listEmployees());
  } catch (err) {
    handle(res, err, "employees");
  }
});

salaryRouter.get("/payrolls", async (_req, res) => {
  try {
    res.json(await salary.listPayrolls());
  } catch (err) {
    handle(res, err, "payrolls");
  }
});

salaryRouter.get("/departments", async (_req, res) => {
  try {
    res.json(await salary.listDepartments());
  } catch (err) {
    handle(res, err, "departments");
  }
});

// Parse an uploaded employment contract → Claude returns a draft employee for review.
// Stateless: nothing is written; the UI holds the draft and the user saves explicitly.
salaryRouter.post("/employees/parse-contract", upload.single("file"), async (req: AuthedRequest, res) => {
  if (!aiConfigured()) {
    res.status(503).json({ error: "AI is not configured (ANTHROPIC_API_KEY missing)" });
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded (allowed: PDF, JPEG, PNG, GIF, WEBP)" });
    return;
  }
  try {
    const draft = await extractEmployeeFromContract(file.buffer, file.mimetype);
    await recordAudit({
      actor: req.user!.email,
      toolName: "ai.contract_parse",
      request: { filename: file.originalname, mimetype: file.mimetype },
      response: { name: draft.name, summary: draft.summary },
      status: "success",
    });
    res.json({ draft, filename: file.originalname });
  } catch (err) {
    console.error("[salary] parse-contract:", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to read contract" });
  }
});

salaryRouter.get("/employees/:id", async (req, res) => {
  try {
    res.json(await salary.getEmployee(String(req.params.id)));
  } catch (err) {
    handle(res, err, "get-employee");
  }
});

// Create a new employee as an onboarding draft in Salary.dk.
salaryRouter.post("/employees", async (req: AuthedRequest, res) => {
  const input = pickEmployeeInput(req.body ?? {});
  if (!input.name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  try {
    const created = await salary.createEmployee(input);
    await recordAudit({
      actor: req.user!.email,
      toolName: "salary.employee_create",
      request: { input },
      response: { id: created.id, name: created.name },
      status: "success",
    });
    res.json(created);
  } catch (err) {
    await recordAudit({
      actor: req.user!.email,
      toolName: "salary.employee_create",
      request: { input },
      response: { error: err instanceof SalaryApiError ? err.body : String(err) },
      status: "error",
    });
    handle(res, err, "create-employee");
  }
});

// Update an existing employee's master record.
salaryRouter.patch("/employees/:id", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const input = pickEmployeeInput(req.body ?? {});
  try {
    const updated = await salary.updateEmployee(id, input);
    await recordAudit({
      actor: req.user!.email,
      toolName: "salary.employee_update",
      request: { id, input },
      response: { id: updated.id, name: updated.name },
      status: "success",
    });
    res.json(updated);
  } catch (err) {
    await recordAudit({
      actor: req.user!.email,
      toolName: "salary.employee_update",
      request: { id, input },
      response: { error: err instanceof SalaryApiError ? err.body : String(err) },
      status: "error",
    });
    handle(res, err, "update-employee");
  }
});
