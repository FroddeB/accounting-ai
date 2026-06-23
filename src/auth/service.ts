import { query } from "../db/pool.js";
import { config } from "../config.js";
import {
  hashPassword,
  verifyPassword,
  generateOtp,
  generateUrlToken,
  hashCode,
  timingSafeEqualStr,
} from "./crypto.js";
import {
  sendEmail,
  twoFactorEmail,
  passwordResetEmail,
} from "../email/brevo.js";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string | null;
  is_admin: boolean;
}

const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

export class AuthError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message);
  }
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  const r = await query<UserRow>(
    `SELECT id, email, password_hash, display_name, is_admin
       FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
  return r.rows[0] ?? null;
}

/** Insert the bootstrap admin (no password) if it doesn't already exist. */
export async function ensureAdmin(): Promise<void> {
  await query(
    `INSERT INTO users (email, is_admin, role, display_name)
     VALUES ($1, true, 'admin', 'Admin')
     ON CONFLICT (email) DO UPDATE SET is_admin = true, role = 'admin'`,
    [config.adminEmail],
  );
}

export interface TeamMember {
  id: string;
  email: string;
  role: string;
  is_admin: boolean;
  created_at: string;
  last_login_at: string | null;
  has_password: boolean;
}

export async function listTeam(): Promise<TeamMember[]> {
  const r = await query<TeamMember>(
    `SELECT id, email, role, is_admin, created_at, last_login_at,
            (password_hash IS NOT NULL) AS has_password
       FROM users ORDER BY is_admin DESC, created_at`,
  );
  return r.rows;
}

/**
 * Invite a team member: create a password-less account and email them a link to
 * set their password (the same flow as forgot-password). Idempotent on email.
 */
export async function inviteMember(email: string): Promise<{ created: boolean }> {
  const existing = await findUserByEmail(email);
  if (existing) {
    // Re-send the set-password email so an un-onboarded invite can be resumed.
    await startPasswordReset(email);
    return { created: false };
  }
  await query(
    `INSERT INTO users (email, is_admin, role) VALUES ($1, false, 'member')`,
    [email],
  );
  await startPasswordReset(email);
  return { created: true };
}

/**
 * Step 1 of login: validate the password and, on success, email a 2FA code.
 * Returns the id of the challenge the client must answer in step 2.
 */
export async function startLogin(email: string, password: string): Promise<{ tokenId: string }> {
  const user = await findUserByEmail(email);
  // Uniform error to avoid leaking which emails exist...
  if (!user) throw new AuthError("Invalid email or password", "invalid_credentials", 401);
  // ...except: an account that exists but has no password yet must be guided to set one.
  if (!user.password_hash) {
    throw new AuthError(
      "This account has no password yet. Use 'Forgot password' to set one.",
      "no_password",
      409,
    );
  }
  if (!verifyPassword(password, user.password_hash)) {
    throw new AuthError("Invalid email or password", "invalid_credentials", 401);
  }

  const code = generateOtp();
  const r = await query<{ id: string }>(
    `INSERT INTO email_tokens (user_id, purpose, code_hash, expires_at)
     VALUES ($1, 'twofa', $2, $3) RETURNING id`,
    [user.id, hashCode(code), new Date(Date.now() + OTP_TTL_MS).toISOString()],
  );
  const mail = twoFactorEmail(code);
  await sendEmail({ to: user.email, ...mail });
  return { tokenId: r.rows[0].id };
}

/** Step 2 of login: verify the 2FA code. Returns the authenticated user. */
export async function verifyTwoFactor(tokenId: string, code: string): Promise<UserRow> {
  const r = await query<{
    id: string;
    user_id: string;
    code_hash: string;
    expires_at: string;
    consumed_at: string | null;
    attempts: number;
  }>(
    `SELECT id, user_id, code_hash, expires_at, consumed_at, attempts
       FROM email_tokens WHERE id = $1 AND purpose = 'twofa'`,
    [tokenId],
  );
  const tok = r.rows[0];
  if (!tok || tok.consumed_at) throw new AuthError("Invalid or used code", "invalid_code", 400);
  if (new Date(tok.expires_at).getTime() < Date.now())
    throw new AuthError("Code expired", "expired_code", 400);
  if (tok.attempts >= MAX_OTP_ATTEMPTS)
    throw new AuthError("Too many attempts", "too_many_attempts", 429);

  if (!timingSafeEqualStr(tok.code_hash, hashCode(code))) {
    await query(`UPDATE email_tokens SET attempts = attempts + 1 WHERE id = $1`, [tokenId]);
    throw new AuthError("Invalid code", "invalid_code", 400);
  }

  await query(`UPDATE email_tokens SET consumed_at = now() WHERE id = $1`, [tokenId]);
  const ur = await query<UserRow>(
    `UPDATE users SET last_login_at = now() WHERE id = $1
     RETURNING id, email, password_hash, display_name, is_admin`,
    [tok.user_id],
  );
  return ur.rows[0];
}

/** Begin a password reset. Always succeeds silently (no account enumeration). */
export async function startPasswordReset(email: string): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user) return; // silent

  const token = generateUrlToken();
  const r = await query<{ id: string }>(
    `INSERT INTO email_tokens (user_id, purpose, code_hash, expires_at)
     VALUES ($1, 'password_reset', $2, $3) RETURNING id`,
    [user.id, hashCode(token), new Date(Date.now() + RESET_TTL_MS).toISOString()],
  );
  const link = `${config.appBaseUrl}/reset?id=${r.rows[0].id}&token=${token}`;
  const mail = passwordResetEmail(link);
  await sendEmail({ to: user.email, ...mail });
}

/** Complete a password reset using the emailed link's id + token. */
export async function completePasswordReset(
  id: string,
  token: string,
  newPassword: string,
): Promise<void> {
  if (newPassword.length < 8)
    throw new AuthError("Password must be at least 8 characters", "weak_password", 400);

  const r = await query<{
    id: string;
    user_id: string;
    code_hash: string;
    expires_at: string;
    consumed_at: string | null;
  }>(
    `SELECT id, user_id, code_hash, expires_at, consumed_at
       FROM email_tokens WHERE id = $1 AND purpose = 'password_reset'`,
    [id],
  );
  const tok = r.rows[0];
  if (!tok || tok.consumed_at) throw new AuthError("Invalid or used reset link", "invalid_token", 400);
  if (new Date(tok.expires_at).getTime() < Date.now())
    throw new AuthError("Reset link expired", "expired_token", 400);
  if (!timingSafeEqualStr(tok.code_hash, hashCode(token)))
    throw new AuthError("Invalid reset link", "invalid_token", 400);

  await query(
    `UPDATE users SET password_hash = $2 WHERE id = $1`,
    [tok.user_id, hashPassword(newPassword)],
  );
  await query(`UPDATE email_tokens SET consumed_at = now() WHERE id = $1`, [id]);
  // Invalidate any other outstanding reset tokens for this user.
  await query(
    `UPDATE email_tokens SET consumed_at = now()
       WHERE user_id = $1 AND purpose = 'password_reset' AND consumed_at IS NULL`,
    [tok.user_id],
  );
}
