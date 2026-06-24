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
 * Reads are unrestricted. Employee writes (create/update of the master record) are
 * exposed but always go through a human review step in the UI before they're called,
 * and new employees are created as onboarding DRAFTS so nothing enters a payroll run
 * by accident. Payroll/remuneration writes (which move money) remain unexposed.
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

async function rawSend<T>(
  method: string,
  path: string,
  body: unknown,
  accessToken: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; body: unknown }> {
  const res = await fetch(`${config.salary.base}${path}`, {
    method,
    headers: { Authorization: accessToken, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) {
    const t = await res.text();
    return { ok: true, data: (t ? JSON.parse(t) : {}) as T };
  }
  const t = await res.text();
  let b: unknown = t;
  try { b = JSON.parse(t); } catch { /* keep text */ }
  return { ok: false, status: res.status, body: b };
}

/** POST/PATCH/PUT with the same auth + single 401-retry behaviour as get(). */
async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  assertConfigured();
  let res = await rawSend<T>(method, path, body, await token());
  if (!res.ok && res.status === 401) {
    res = await rawSend<T>(method, path, body, await token(true));
  }
  if (!res.ok) throw new SalaryApiError(`Salary.dk ${method} ${path} → ${res.status}`, res.status, res.body);
  return res.data;
}

/** Drop undefined / empty-string fields so we never overwrite with blanks. */
function clean(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));
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
  // Returned by GET /v2/employees/{id}; used to prefill the edit form.
  address?: string;
  postalCode?: string;
  phoneNumber?: string;
  phoneNumberCountryCode?: string;
  language?: string;
  nationalID?: string;
  bankRegistrationNumber?: string;
  bankAccountNumber?: string;
  onboardingState?: string;
}

/** Editable master-data fields we accept from the UI (no salary/remuneration). */
export interface SalaryEmployeeInput {
  name?: string;
  email?: string;
  phoneNumber?: string;
  phoneNumberCountryCode?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  affiliationType?: string; // Standard | Director | MajorityShareholder | Freelancer
  language?: string;        // da | en
  departmentID?: string;
  nationalID?: string;
  bankRegistrationNumber?: string;
  bankAccountNumber?: string;
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

export interface SalaryCompany { id: string; name?: string; city?: string; address?: string; }

// The API-client token isn't bound to a user, so list endpoints need an explicit
// companyID. Pin it via SALARY_COMPANY_ID, else auto-resolve the first accessible company.
let cachedCompanyId: string | null = null;
async function companyId(): Promise<string> {
  if (config.salary.companyId) return config.salary.companyId;
  if (cachedCompanyId) return cachedCompanyId;
  const r = await get<Page<SalaryCompany>>("/v2/companies");
  const id = r.data?.[0]?.id;
  if (!id) throw new SalaryApiError("No company is accessible for this Salary API key", 404, r);
  cachedCompanyId = id;
  return id;
}

export const salary = {
  isConfigured,

  listCompanies: () => get<Page<SalaryCompany>>("/v2/companies"),

  listEmployees: async (limit = 200, offset = 0) =>
    get<Page<SalaryEmployee>>("/v2/employees", { companyID: await companyId(), limit, offset, includeRemuneration: "true" }),

  // /v2/payRolls requires a from/to window; default to last year → end of next year.
  listPayrolls: async (opts: { from?: string; to?: string; limit?: number; offset?: number } = {}) => {
    const y = new Date().getUTCFullYear();
    return get<Page<SalaryPayRoll>>("/v2/payRolls", {
      companyID: await companyId(),
      from: opts.from ?? `${y - 1}-01-01`,
      to: opts.to ?? `${y + 1}-12-31`,
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
    });
  },

  getPayroll: (id: string) => get<SalaryPayRoll>(`/v2/payRolls/${encodeURIComponent(id)}`),

  listDepartments: async () =>
    get<Page<{ id: string; name?: string }>>("/v2/departments", { companyID: await companyId() }),

  getEmployee: async (id: string) =>
    (await get<{ data: SalaryEmployee }>(`/v2/employees/${encodeURIComponent(id)}`)).data,

  /**
   * Create an employee as an onboarding DRAFT — it shows up in Salary.dk but isn't
   * finalised, so it can't enter a payroll run until someone completes onboarding there.
   * language + affiliationType are required by the API; companyID is injected.
   */
  createEmployee: async (input: SalaryEmployeeInput) => {
    const body = clean({
      ...input,
      companyID: await companyId(),
      onboardingState: "Draft",
      language: input.language || "da",
      affiliationType: input.affiliationType || "Standard",
    });
    return (await send<{ data: SalaryEmployee }>("POST", "/v2/employees", body)).data;
  },

  // PATCH uses the lowercase `nationalId` (create uses `nationalID`); map it across.
  updateEmployee: async (id: string, input: SalaryEmployeeInput) => {
    const { nationalID, ...rest } = input;
    const patch = clean({ ...rest, nationalId: nationalID });
    return (await send<{ data: SalaryEmployee }>(
      "PATCH",
      `/v2/employees/${encodeURIComponent(id)}`,
      patch,
    )).data;
  },
};
