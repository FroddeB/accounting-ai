import { config } from "../config.js";

/**
 * Typed-ish client for the e-conomic REST API.
 *
 * Design notes (see plan §2):
 *  - Auth is two custom headers, NOT OAuth.
 *  - The REST API has NO PATCH: updates are full-document PUTs (fetch → modify → put).
 *  - Collections are cursor-paginated via a `pagination.nextPage` URL — you cannot
 *    jump to an arbitrary page. We expose an async iterator that follows the cursor.
 *
 * The newer OpenAPI host (apis.e-conomic.com) is reachable via `baseOpenApi`; it
 * carries daybook/journal (Kassekladde) endpoints. Same two-token auth applies.
 */

export class EconomicApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "EconomicApiError";
  }
}

interface EconomicCollection<T> {
  collection: T[];
  pagination?: {
    results: number;
    resultsWithoutFilter: number;
    skipPages: number;
    pageSize: number;
    maxPageSizeAllowed: number;
    nextPage?: string;
    firstPage?: string;
    lastPage?: string;
  };
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 4;

function authHeaders(): Record<string, string> {
  return {
    "X-AppSecretToken": config.economic.appSecretToken,
    "X-AgreementGrantToken": config.economic.agreementGrantToken,
    "Content-Type": "application/json",
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Low-level request with retry/backoff on transient failures and rate limits.
 * Accepts either a path (resolved against the REST base) or an absolute URL
 * (used when following a pagination `nextPage` cursor).
 */
async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  pathOrUrl: string,
  body?: unknown,
): Promise<T> {
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${config.economic.baseRest}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;

  let attempt = 0;
  // Retry loop with exponential backoff + Retry-After awareness.
  for (;;) {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (networkErr) {
      if (attempt < MAX_RETRIES) {
        await sleep(2 ** attempt * 250);
        attempt++;
        continue;
      }
      throw new EconomicApiError(
        `Network error calling e-conomic: ${String(networkErr)}`,
        0,
        null,
      );
    }

    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }

    if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** attempt * 250;
      await sleep(wait);
      attempt++;
      continue;
    }

    // Non-retryable (e.g. 400 validation, 401 auth, 404). Surface the body —
    // e-conomic returns an annotated error document mirroring the payload.
    const errBody = await res.text();
    let parsed: unknown = errBody;
    try {
      parsed = JSON.parse(errBody);
    } catch {
      /* leave as text */
    }
    throw new EconomicApiError(
      `e-conomic ${method} ${url} → ${res.status}`,
      res.status,
      parsed,
    );
  }
}

export const economic = {
  /** Raw GET for a single resource or custom endpoint. */
  get: <T>(path: string) => request<T>("GET", path),

  /** Raw POST (create). */
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),

  /** Raw DELETE. */
  delete: <T>(path: string) => request<T>("DELETE", path),

  /**
   * Fetch-modify-PUT helper. The REST API has no PATCH, so updates must send the
   * whole document. `mutate` receives the current entity and returns the full
   * updated entity to PUT back.
   */
  async update<T>(path: string, mutate: (current: T) => T): Promise<T> {
    const current = await request<T>("GET", path);
    const next = mutate(current);
    return request<T>("PUT", path, next);
  },

  /**
   * Async iterator over a cursor-paginated collection. Follows `pagination.nextPage`
   * until exhausted. `firstPath` may include query params (e.g. `/customers?pagesize=100`).
   */
  async *paginate<T>(firstPath: string): AsyncGenerator<T, void, unknown> {
    let next: string | undefined = firstPath;
    while (next) {
      const page: EconomicCollection<T> = await request<EconomicCollection<T>>("GET", next);
      for (const item of page.collection) yield item;
      next = page.pagination?.nextPage;
    }
  },

  /** Collect up to `limit` items from a paginated collection into an array. */
  async collect<T>(firstPath: string, limit = 1000): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this.paginate<T>(firstPath)) {
      out.push(item);
      if (out.length >= limit) break;
    }
    return out;
  },
};
