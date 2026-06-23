import { config } from "../config.js";

/**
 * Minimal Brevo (Sendinblue) transactional email client.
 * Uses the REST API directly — no SDK needed.
 *
 * Requires BREVO_API_KEY and a *verified* sender (BREVO_SENDER_EMAIL) in your
 * Brevo account, otherwise sends are rejected.
 */

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail({ to, subject, html, text }: SendArgs): Promise<void> {
  if (!config.brevo.apiKey) {
    // In local/dev without a key, log instead of failing the flow.
    console.warn(`[email] BREVO_API_KEY not set — would send to ${to}: "${subject}"`);
    console.warn(`[email] body:\n${text ?? html}`);
    return;
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": config.brevo.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: config.brevo.senderEmail, name: config.brevo.senderName },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text ?? html.replace(/<[^>]+>/g, " "),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo send failed (${res.status}): ${body}`);
  }
}

// ── Templated messages ───────────────────────────────────────────────────────

export function twoFactorEmail(code: string): { subject: string; html: string; text: string } {
  return {
    subject: `Your login code: ${code}`,
    text: `Your verification code is ${code}. It expires in 10 minutes.`,
    html: `<div style="font-family:sans-serif">
      <h2>Verify your login</h2>
      <p>Your verification code is:</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p>
      <p style="color:#666">This code expires in 10 minutes. If you didn't try to sign in, ignore this email.</p>
    </div>`,
  };
}

export function passwordResetEmail(link: string): { subject: string; html: string; text: string } {
  return {
    subject: "Set your password",
    text: `Open this link to set your password (valid 1 hour): ${link}`,
    html: `<div style="font-family:sans-serif">
      <h2>Set your password</h2>
      <p>Click the button below to set a new password. The link is valid for 1 hour.</p>
      <p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">Set password</a></p>
      <p style="color:#666">If you didn't request this, you can ignore this email.</p>
      <p style="color:#999;font-size:12px">${link}</p>
    </div>`,
  };
}
