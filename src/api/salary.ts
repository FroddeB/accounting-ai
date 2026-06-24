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
  const employeeNumber = await salary.nextEmployeeNumber();
  const employment = await salary.createEmployment({
    employeeID: employeeId,
    employeeNumber,
    startDate,
    incomeType: str(c.incomeType) || "DKSalaryIncome",
  });

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
  const vacationDays = num(c.vacationDays);
  const lunchAmount = num(c.lunchAmount);

  const contract = await salary.createEmployeeContract({
    employmentID: employment.id,
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
    benefits: lunchAmount != null ? [{ type: "Lunch", amount: lunchAmount, title: "Frokostordning" }] : [],
  });

  await recordAudit({
    actor, toolName: "salary.contract_create",
    request: { employeeId, contract: c },
    response: { employmentID: employment.id, contractID: contract.id }, status: "success",
  });
  return { employmentID: employment.id, contractID: contract.id };
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
