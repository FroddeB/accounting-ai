import type { Request, Response, NextFunction } from "express";
import { verifySession } from "./crypto.js";

export const SESSION_COOKIE = "session";

export interface AuthedRequest extends Request {
  user?: { id: string; email: string; admin: boolean };
}

/** Parse a cookie value out of the raw Cookie header. */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** Populate req.user from the session cookie if present and valid. */
export function loadUser(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const token = readCookie(req, SESSION_COOKIE);
  const payload = verifySession(token, Math.floor(Date.now() / 1000));
  if (payload) req.user = { id: payload.sub, email: payload.email, admin: payload.admin };
  next();
}

/** Reject the request unless a valid session is present. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}
