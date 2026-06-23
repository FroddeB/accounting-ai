import { config } from "../config.js";

/**
 * Salary.dk client — STUB.
 *
 * Blocked on confirming the API shape (plan §2, §6): REST vs GraphQL, the exact
 * endpoint paths, and the auth header format. Public docs at https://api.salary.dk/docs
 * are thin. Do NOT assume endpoint shapes — finalize once a key + spec are in hand.
 *
 * Current assumption (to verify): REST + JSON, auth via `Authorization: <API_KEY>`.
 */

export class SalaryNotConfiguredError extends Error {
  constructor() {
    super(
      "Salary.dk client is not configured. Set SALARY_API_KEY and confirm the API spec before enabling salary tools.",
    );
    this.name = "SalaryNotConfiguredError";
  }
}

function assertConfigured(): void {
  if (!config.salary.apiKey) throw new SalaryNotConfiguredError();
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  assertConfigured();
  const res = await fetch(`${config.salary.base}${path}`, {
    method,
    headers: {
      // TODO(verify): confirm header format — `Authorization: <key>` vs `Bearer <key>` vs `X-Api-Key`.
      Authorization: config.salary.apiKey,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Salary.dk ${method} ${path} → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export const salary = {
  isConfigured: () => Boolean(config.salary.apiKey),
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
};
