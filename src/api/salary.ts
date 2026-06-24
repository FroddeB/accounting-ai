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
  const b = (v: unknown) => (typeof v === "boolean" ? v : undefined);
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
    nationalIDType: s(body.nationalIDType),
    bankRegistrationNumber: s(body.bankRegistrationNumber),
    bankAccountNumber: s(body.bankAccountNumber),
    transferDestinationType: s(body.transferDestinationType),
    paySlipTransportEMail: b(body.paySlipTransportEMail),
    paySlipTransportMitDK: b(body.paySlipTransportMitDK),
    paySlipTransportEBoks: b(body.paySlipTransportEBoks),
    paySlipTransportSMS: b(body.paySlipTransportSMS),
  };
}

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

/**
 * Create the employment + contract (salary, hours, vacation, lunch, DISCO-08) for an
 * employee that already exists. Auto-resolves the production unit and monthly cycle when
 * not given. Used both by the full create and to complete an existing draft.
 */
async function setupContract(employeeId: string, c: Record<string, unknown>, actor: string) {
  const startDate = str(c.startDate)?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

  // Reuse the existing employment if there is one (contracts are versioned, not updated;
  // a new contract is posted against the same employment). Only create one if none exists.
  const employments = (await salary.listEmployments(employeeId)).data ?? [];
  let employmentID = employments[0]?.id;
  if (!employmentID) {
    const employeeNumber = await salary.nextEmployeeNumber();
    const employment = await salary.createEmployment({
      employeeID: employeeId,
      employeeNumber,
      startDate,
      preferredTaxCardType: str(c.preferredTaxCardType) || "Primary",
      incomeType: str(c.incomeType) || "DKSalaryIncome",
    });
    employmentID = employment.id;
  }

  let productionUnitID = str(c.productionUnitID);
  if (!productionUnitID) {
    const pus = await salary.listProductionUnits();
    productionUnitID = pus[0]?.id;
  }
  if (!productionUnitID) throw new Error("No production unit (Arbejdssted) is configured in Salary.dk");

  let salaryCycleID = str(c.salaryCycleID);
  if (!salaryCycleID) {
    const cycles = (await salary.listSalaryCycles()).data ?? [];
    salaryCycleID = (cycles.find((x) => x.frequency === "Monthly") ?? cycles[0])?.id;
  }
  if (!salaryCycleID) throw new Error("No salary cycle is configured in Salary.dk");

  const salaryTypeID = str(c.salaryTypeID);
  const monthlySalary = num(c.monthlySalary);
  const leaveTypeID = str(c.leaveTypeID);
  const vacationDays = num(c.vacationDays) ?? 25; // Default to 25 days per year
  const lunchAmount = num(c.lunchAmount);
  // "Lunch" = per period, "Lunch Daily" = per day.
  const lunchType = str(c.lunchType) === "Lunch Daily" ? "Lunch Daily" : "Lunch";
  // Vacation scheme defaults: "Ferie med løn" (paid) with 1% allowance and Great Prayer Day supplement.
  const ferieType = str(c.ferieType) || "Ferie med løn";
  const ferietillæg = num(c.ferietillæg) ?? 1; // Default to 1%
  const storeBededagstillæg = c.storeBededagstillæg !== false; // Default to true (enabled)

  try {
    var contract = await salary.createEmployeeContract({
      employmentID,
      productionUnitID,
      salaryCycleID,
      validFrom: startDate,
      position: str(c.position),
      employmentPositionID: str(c.employmentPositionID),
      departmentID: str(c.departmentID),
      employmentType: str(c.employmentType) || "Ordinary",
      weeklyHours: num(c.weeklyHours),
      workDaysPerWeek: num(c.workDaysPerWeek),
      salary: salaryTypeID && monthlySalary != null ? [{ salaryTypeID, rate: monthlySalary }] : [],
      leave: leaveTypeID && vacationDays != null ? [{ typeID: leaveTypeID, days: vacationDays }] : [],
      benefits: lunchAmount != null ? [{ type: lunchType, amount: lunchAmount, title: "Frokostordning" }] : [],
      vacationDays,
      ferieType,
      ferietillæg,
      storeBededagstillæg,
    });
  } catch (e) {
    console.error("[salary] contract creation 400 detail:", JSON.stringify(e instanceof SalaryApiError ? e.body : e, null, 2));
    throw e;
  }

  await recordAudit({
    actor, toolName: "salary.contract_create",
    request: { employeeId, contract: c },
    response: { employmentID, contractID: contract.id }, status: "success",
  });

  // Try to take the employee out of kladde (draft) and make them payroll-ready.
  // A 400 means Salary still wants something — pass the reason back so the user sees it.
  let ready = false;
  let readyError: unknown;
  try {
    await salary.markReady(employeeId);
    ready = true;
  } catch (e) {
    readyError = e instanceof SalaryApiError ? fmtSalaryError(e.body) : (e instanceof Error ? e.message : String(e));
  }
  await recordAudit({
    actor, toolName: "salary.employee_ready",
    request: { employeeId }, response: { ready, readyError }, status: ready ? "success" : "error",
  });

  return { employmentID, contractID: contract.id, ready, readyError };
}

// Format Salary.dk error objects into human-readable messages.
function fmtSalaryError(e: unknown): string {
  if (typeof e === "string") return e;
  const o = e as any;
  if (o.message && typeof o.message === "string") return o.message;
  if (o.error && typeof o.error === "string") return o.error;
  if (o.errors) {
    const msgs: string[] = [];
    for (const [k, v] of Object.entries(o.errors as any)) {
      if (typeof v === "string") msgs.push(`${k}: ${v}`);
      else if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") msgs.push(`${k}: ${v[0]}`);
    }
    if (msgs.length > 0) return msgs.join("; ");
  }
  return "missing required fields";
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

// Company-specific reference data for the contract form (salary types, cycles, etc.).
salaryRouter.get("/employees/reference", async (_req, res) => {
  try {
    const [salaryTypes, salaryCycles, leaveTypes, productionUnits, departments, positions] = await Promise.all([
      salary.listSalaryTypes(),
      salary.listSalaryCycles(),
      salary.listLeaveTypes(),
      salary.listProductionUnits(),
      salary.listDepartments(),
      salary.listEmploymentPositions("DK"),
    ]);
    res.json({
      salaryTypes: salaryTypes.data ?? [],
      salaryCycles: salaryCycles.data ?? [],
      leaveTypes: leaveTypes.data ?? [],
      productionUnits,
      departments: departments.data ?? [],
      employmentPositions: positions.data ?? [],
    });
  } catch (err) {
    handle(res, err, "reference");
  }
});

salaryRouter.get("/employees/:id", async (req, res) => {
  try {
    res.json(await salary.getEmployee(String(req.params.id)));
  } catch (err) {
    handle(res, err, "get-employee");
  }
});

// The employee's current contract, flattened for the edit form.
salaryRouter.get("/employees/:id/contract", async (req, res) => {
  try {
    const c = await salary.getEmployeeContract(String(req.params.id));
    if (!c) {
      res.json({ hasContract: false });
      return;
    }
    const sal = c.remuneration?.salary?.[0];
    const lv = c.remuneration?.leave?.[0];
    const lunch = c.remuneration?.benefits?.find((b) => b.type === "Lunch" || b.type === "Lunch Daily");
    res.json({
      hasContract: true,
      position: c.position ?? null,
      employmentPositionID: c.employmentPositionID ?? null,
      salaryCycleID: c.salaryCycleID ?? null,
      productionUnitID: c.productionUnitID ?? null,
      weeklyHours: c.workCycleHours?.[0] ?? null,
      workDaysPerWeek: c.weeklyWorkDays ?? null,
      salaryTypeID: sal?.salaryTypeID ?? null,
      monthlySalary: sal?.rate ?? null,
      leaveTypeID: lv?.typeID ?? null,
      vacationDays: lv?.days ?? null,
      lunchAmount: lunch?.amount ?? null,
      lunchType: lunch?.type ?? null,
      validFrom: c.validFrom ?? null,
    });
  } catch (err) {
    handle(res, err, "get-contract");
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

// Create a draft employee AND, if salary terms are supplied, the employment + contract
// (salary, hours, vacation, lunch) in one go. Runs the steps in sequence; if a later
// step fails the employee draft still exists, so we report exactly how far we got.
salaryRouter.post("/employees/full", async (req: AuthedRequest, res) => {
  const actor = req.user!.email;
  const emp = pickEmployeeInput(req.body?.employee ?? {});
  const c = (req.body?.contract ?? {}) as Record<string, unknown>;
  if (!emp.name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  // Carry the department + employment type from the master record onto the contract.
  if (emp.departmentID && !str(c.departmentID)) c.departmentID = emp.departmentID;
  if (!str(c.employmentType)) c.employmentType = emp.affiliationType === "Freelancer" ? "Freelance" : "Ordinary";

  const wantsContract = num(c.monthlySalary) != null || str(c.salaryTypeID) != null || num(c.weeklyHours) != null;

  let employeeId: string | undefined;
  try {
    const created = await salary.createEmployee(emp);
    employeeId = created.id;
    await recordAudit({
      actor, toolName: "salary.employee_create",
      request: { input: emp }, response: { id: created.id, name: created.name }, status: "success",
    });

    if (!wantsContract) {
      res.json({ ok: true, employeeId: created.id });
      return;
    }
    const result = await setupContract(created.id, c, actor);
    res.json({ ok: true, employeeId: created.id, ...result });
  } catch (err) {
    await recordAudit({
      actor, toolName: "salary.employee_full_create",
      request: { employee: emp, contract: c, employeeId },
      response: { error: err instanceof SalaryApiError ? err.body : String(err) }, status: "error",
    });
    if (employeeId) {
      // Employee draft exists but the salary/contract step failed — surface both.
      res.json({
        ok: false,
        employeeId,
        error: err instanceof SalaryApiError ? `Salary.dk rejected the contract (${err.status})` : (err instanceof Error ? err.message : "Failed to set salary"),
        detail: err instanceof SalaryApiError ? err.body : undefined,
      });
    } else {
      handle(res, err, "employee-full-create");
    }
  }
});

// Complete an existing (draft) employee: create the employment + contract via the API.
salaryRouter.post("/employees/:id/contract", async (req: AuthedRequest, res) => {
  const actor = req.user!.email;
  const id = String(req.params.id);
  const c = (req.body?.contract ?? req.body ?? {}) as Record<string, unknown>;
  try {
    const result = await setupContract(id, c, actor);
    res.json({ ok: true, employeeId: id, ...result });
  } catch (err) {
    await recordAudit({
      actor, toolName: "salary.contract_create",
      request: { employeeId: id, contract: c },
      response: { error: err instanceof SalaryApiError ? err.body : String(err) }, status: "error",
    });
    handle(res, err, "setup-contract");
  }
});

// Mark an existing employee ready for payroll (take them out of kladde).
salaryRouter.post("/employees/:id/ready", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  try {
    await salary.markReady(id);
    await recordAudit({
      actor: req.user!.email, toolName: "salary.employee_ready",
      request: { id }, response: { ready: true }, status: "success",
    });
    res.json({ ok: true, ready: true });
  } catch (err) {
    await recordAudit({
      actor: req.user!.email, toolName: "salary.employee_ready",
      request: { id }, response: { error: err instanceof SalaryApiError ? err.body : String(err) }, status: "error",
    });
    if (err instanceof SalaryApiError) {
      res.json({ ok: false, ready: false, readyError: fmtSalaryError(err.body) });
    } else {
      handle(res, err, "mark-ready");
    }
  }
});

// Delete an employee (and orphaned salary parts). Useful for clearing bad drafts.
salaryRouter.delete("/employees/:id", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  try {
    await salary.deleteEmployee(id);
    await recordAudit({
      actor: req.user!.email, toolName: "salary.employee_delete",
      request: { id }, response: { ok: true }, status: "success",
    });
    res.json({ ok: true });
  } catch (err) {
    await recordAudit({
      actor: req.user!.email, toolName: "salary.employee_delete",
      request: { id }, response: { error: err instanceof SalaryApiError ? err.body : String(err) }, status: "error",
    });
    handle(res, err, "delete-employee");
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
