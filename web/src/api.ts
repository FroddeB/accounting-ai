// Thin fetch wrapper. Always sends cookies (same-origin in prod, proxied in dev).

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

async function parse(res: Response) {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(data.error ?? res.statusText, res.status, data.code);
  return data;
}

export const api = {
  get: (path: string) => fetch(path, { credentials: "include" }).then(parse),
  post: (path: string, body?: unknown) =>
    fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(parse),
  del: (path: string) => fetch(path, { method: "DELETE", credentials: "include" }).then(parse),
  upload: (path: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(path, { method: "POST", credentials: "include", body: fd }).then(parse);
  },
};
