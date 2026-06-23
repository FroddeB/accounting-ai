import { Router } from "express";
import { issueSession } from "../auth/crypto.js";
import {
  startLogin,
  verifyTwoFactor,
  startPasswordReset,
  completePasswordReset,
  AuthError,
} from "../auth/service.js";
import {
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  type AuthedRequest,
} from "../auth/middleware.js";

export const authRouter = Router();

function handle(res: import("express").Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ error: err.message, code: err.code });
  } else {
    console.error("[auth] error:", err);
    res.status(500).json({ error: "Internal error" });
  }
}

// Step 1: email + password → emails a 2FA code.
authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }
    const { tokenId } = await startLogin(email, password);
    res.json({ twofa: true, tokenId });
  } catch (err) {
    handle(res, err);
  }
});

// Step 2: 2FA code → sets session cookie.
authRouter.post("/verify-2fa", async (req, res) => {
  try {
    const { tokenId, code } = req.body ?? {};
    if (!tokenId || !code) {
      res.status(400).json({ error: "tokenId and code are required" });
      return;
    }
    const user = await verifyTwoFactor(tokenId, String(code));
    const token = issueSession(user, Math.floor(Date.now() / 1000));
    setSessionCookie(res, token);
    res.json({ user: { id: user.id, email: user.email, admin: user.is_admin, name: user.display_name } });
  } catch (err) {
    handle(res, err);
  }
});

// Forgot password → emails a reset link (always 200, no account enumeration).
authRouter.post("/forgot", async (req, res) => {
  try {
    const { email } = req.body ?? {};
    if (email) await startPasswordReset(String(email));
    res.json({ ok: true });
  } catch (err) {
    handle(res, err);
  }
});

// Reset password using the emailed id + token.
authRouter.post("/reset", async (req, res) => {
  try {
    const { id, token, password } = req.body ?? {};
    if (!id || !token || !password) {
      res.status(400).json({ error: "id, token and password are required" });
      return;
    }
    await completePasswordReset(String(id), String(token), String(password));
    res.json({ ok: true });
  } catch (err) {
    handle(res, err);
  }
});

authRouter.get("/me", requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
