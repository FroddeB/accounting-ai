import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import { config } from "../config.js";

// ── Password hashing (scrypt, no native deps) ────────────────────────────────

const SCRYPT_N = 16384;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, nStr, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, expected.length, { N: Number(nStr) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ── One-time codes / tokens ──────────────────────────────────────────────────

/** 6-digit numeric code for email 2FA. */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** High-entropy URL-safe token for password-reset links. */
export function generateUrlToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash a code/token for at-rest storage (SHA-256 via HMAC with the session secret). */
export function hashCode(code: string): string {
  return createHmac("sha256", config.sessionSecret).update(code).digest("hex");
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ── Stateless session tokens (compact HMAC-signed JWT-like) ───────────────────

interface SessionPayload {
  sub: string; // user id
  email: string;
  admin: boolean;
  exp: number; // unix seconds
}

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

export function issueSession(user: { id: string; email: string; is_admin: boolean }, nowSec: number): string {
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    admin: user.is_admin,
    exp: nowSec + SESSION_TTL_SECONDS,
  };
  const body = b64url(payload);
  const sig = createHmac("sha256", config.sessionSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined, nowSec: number): SessionPayload | null {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = createHmac("sha256", config.sessionSecret).update(body).digest("base64url");
  if (!timingSafeEqualStr(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (payload.exp < nowSec) return null;
    return payload;
  } catch {
    return null;
  }
}
