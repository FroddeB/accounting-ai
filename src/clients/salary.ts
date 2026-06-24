import { config } from "../config.js";

/**
 * Salary.dk API client (https://api.salary.dk, spec at /swagger.json).
 *
 * Auth is a TWO-STEP exchange (confirmed against the live API):
 *   POST /v2/auth { apiClientID, apiClientSecret, apiKey } → { data: { accessToken } }
 * The returned access token is then sent as `Authorization: <accessToken>` (no
 * "Bearer") on every request. apiClientID/Secret identify your integration
 * (register via dev@salary.dk); apiKey (Settings → Company) scopes it to a company.
 * Access tokens are short-lived — we cache one and re-authenticate on 401.
 *
 * READ-ONLY for now. Payroll/employee writes (which move money) are not exposed
 * until built behind an explicit approval flow.
 */

export class SalaryNotConfiguredError extends Error {
  constructor() {
    super("Salary.dk is not configured — set SALARY_API_CLIENT_ID, SALARY_API_CLIENT_SECRET and SALARY_API_KEY.");
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
  return Boolean(config.salary.apiClientId && config.salary.apiClientSecret && config.salary.apiKey);
}

function assertConfigured(): void {
  if (!isConfigured()) throw new SalaryNotConfiguredError();
}

// Cached access token. Re-auth on 401 or once the soft TTL passes.
let cachedToken: string | null = null;
let cachedAt = 0;
const TOKEN_TTL_MS = 25 * 60 * 1000;

async function authenticate(): Promise<string> {
  const res = await fetch(`${config.salary.base}/v2/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiClientID: config.salary.apiClientId,
      apiClientSecret: config.salary.apiClientSecret,
      apiKey: config.salary.apiKey,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    throw new SalaryApiError(`Salary.dk auth → ${res.status}`, res.status, body);
  }
  const data = JSON.parse(text) as { data?: { accessToken?: string } };
  const token = data.data?.accessToken;
  if (!token) throw new SalaryApiError("Salary.dk auth returned no accessToken", 500, data);
  cachedToken = token;
  cachedAt = Date.now();
  return token;
}

async function token(force = false): Promise<string> {
  if (!force && cachedToken && Date.now() - cachedAt < TOKEN_TTL_MS) return cachedToken;
  return authenticate();
}

async function rawGet<T>(path: string, qs: string, accessToken: string): Promise<{ ok: true; data: T } | { ok: false; status: number; body: unknown }> {
  const res = await fetch(`${config.salary.base}${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: accessToken, "Content-Type": "application/json" },
  });
  if (res.ok) return { ok: true, data: (await res.json()) as T };
  const t = await res.text();
  let body: unknown = t;
  try { body = JSON.parse(t); } catch { /* keep text */ }
  return { ok: false, status: res.status, body };
}

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  assertConfigured();
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

  let res = await rawGet<T>(path, qs, await token());
  if (!res.ok && res.status === 401) {
    // Token likely expired — re-authenticate once and retry.
    res = await rawGet<T>(path, qs, await token(true));
  }
  if (!res.ok) throw new SalaryApiError(`Salary.dk GET ${path} → ${res.status}`, res.status, res.body);
  return res.data;
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
