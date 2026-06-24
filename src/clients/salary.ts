import { config } from "../config.js";

/**
 * Salary.dk API client (https://api.salary.dk, spec at /swagger.json).
 *
 * Auth: a single account API key passed as `Authorization: <token>` (NO "Bearer"
 * prefix — confirmed from the swagger securityDefinitions). Generate the key in
 * Salary → Settings → Company. All endpoints live under `/v2`; list endpoints
 * return `{ data, pagination }`.
 *
 * This client is READ-ONLY for now. Payroll/employee writes (which can move money)
 * are deliberately not exposed until they're built behind an explicit approval flow.
 */

export class SalaryNotConfiguredError extends Error {
  constructor() {
    super("Salary.dk is not configured — set SALARY_API_KEY.");
    this.name = "SalaryNotConfiguredError";
  }
}

export class SalaryApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = "SalaryApiError";
  }
}

export function isConfigured(): boolean {
  return Boolean(config.salary.apiKey);
}

function assertConfigured(): void {
  if (!config.salary.apiKey) throw new SalaryNotConfiguredError();
}

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  assertConfigured();
  // companyID is accepted by most list endpoints; include it when configured.
  if (config.salary.companyId && params.companyID === undefined) params.companyID = config.salary.companyId;
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${config.salary.base}${path}${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    headers: { Authorization: config.salary.apiKey, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    throw new SalaryApiError(`Salary.dk GET ${path} → ${res.status}`, res.status, body);
  }
  return (await res.json()) as T;
}

interface Page<T> { data: T[]; pagination?: { total?: number; limit?: number; offset?: number }; }

export interface SalaryEmployee {
  id: string;
  name?: string;
  email?: string;
  employmentStatus?: string;
  affiliationType?: string;
  departmentID?: string;
  city?: string;
  paidOutThisYear?: number;
}

export interface SalaryPayRoll {
  id: string;
  status?: string;
  payRollType?: string;
  dispositionDate?: string;
  isApproved?: boolean;
  isReviewed?: boolean;
  isTentative?: boolean;
  totalPaycheck?: number;
  totalTransfer?: number;
  totalHours?: number;
  salaryPeriod?: { start?: string; end?: string; name?: string };
  salaryCycle?: { name?: string };
}

export const salary = {
  isConfigured,

  listEmployees: (limit = 200, offset = 0) =>
    get<Page<SalaryEmployee>>("/v2/employees", { limit, offset, includeRemuneration: "true" }),

  listPayrolls: (limit = 50, offset = 0) =>
    get<Page<SalaryPayRoll>>("/v2/payRolls", { limit, offset }),

  getPayroll: (id: string) => get<SalaryPayRoll>(`/v2/payRolls/${encodeURIComponent(id)}`),

  listDepartments: () => get<Page<{ id: string; name?: string }>>("/v2/departments"),
};
