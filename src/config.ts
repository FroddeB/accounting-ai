import "dotenv/config";

/**
 * Centralised, validated environment configuration.
 * Fails fast at boot if anything required is missing.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

export const config = {
  port: Number(optional("PORT", "3000")),

  mcpAuthToken: required("MCP_AUTH_TOKEN"),

  databaseUrl: required("DATABASE_URL"),

  economic: {
    appSecretToken: required("ECONOMIC_APP_SECRET_TOKEN"),
    agreementGrantToken: required("ECONOMIC_AGREEMENT_GRANT_TOKEN"),
    baseRest: optional("ECONOMIC_API_BASE_REST", "https://restapi.e-conomic.com"),
    baseOpenApi: optional("ECONOMIC_API_BASE_OPENAPI", "https://apis.e-conomic.com"),
  },

  salary: {
    apiKey: process.env.SALARY_API_KEY ?? "",
    base: optional("SALARY_API_BASE", "https://api.salary.dk"),
  },

  /** When true, write tools simulate and record a dry_run audit entry instead of mutating. */
  dryRunDefault: bool("DRY_RUN_DEFAULT", true),

  /** Secret used to sign session tokens (HMAC). Falls back to MCP_AUTH_TOKEN if unset. */
  sessionSecret: optional("SESSION_SECRET", process.env.MCP_AUTH_TOKEN ?? "dev-session-secret"),

  /** Public base URL of the app, used to build password-reset links in emails. */
  appBaseUrl: optional("APP_BASE_URL", "http://localhost:3000"),

  /** First admin account, bootstrapped with no password (must use forgot-password). */
  adminEmail: optional("ADMIN_EMAIL", "fb@y.dk"),

  brevo: {
    apiKey: process.env.BREVO_API_KEY ?? "",
    senderEmail: optional("BREVO_SENDER_EMAIL", "noreply@y.dk"),
    senderName: optional("BREVO_SENDER_NAME", "Projekt Y Accounting"),
  },
} as const;

export type Config = typeof config;
