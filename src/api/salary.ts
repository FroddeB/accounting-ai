import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { salary, isConfigured, SalaryNotConfiguredError, SalaryApiError } from "../clients/salary.js";

export const salaryRouter = Router();
salaryRouter.use(requireAuth);

function handle(res: import("express").Response, err: unknown, what: string): void {
  if (err instanceof SalaryNotConfiguredError) {
    res.status(503).json({ error: "Salary.dk is not configured (SALARY_API_KEY missing)" });
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
