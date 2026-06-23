import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

/**
 * Claude-powered invoice understanding + voucher matching.
 *
 * Given an uploaded invoice/receipt and the list of draft bank vouchers that are
 * missing a bilag, Claude (claude-opus-4-8) extracts the invoice fields AND picks
 * the voucher the document most likely belongs to — in one structured call. The
 * amount is the strongest signal (an invoice total should match the bank payment,
 * which is usually negative), with date proximity and supplier/text as tiebreakers.
 */

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!config.anthropic.apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — AI invoice matching is unavailable.");
  }
  if (!client) client = new Anthropic({ apiKey: config.anthropic.apiKey });
  return client;
}

export interface VoucherCandidate {
  voucherId: string;
  voucherNumber: number;
  date: string | null;
  text: string | null;
  amount: number | null;
}

export interface InvoiceExtraction {
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  currency: string | null;
  totalAmount: number | null;
  documentType: "invoice" | "receipt" | "credit_note" | "other";
  summary: string;
}

export interface MatchResult {
  invoice: InvoiceExtraction;
  match: {
    voucherId: string | null;
    voucherNumber: number | null;
    confidence: "high" | "medium" | "low" | "none";
    reasoning: string;
  };
  alternates: { voucherId: string; voucherNumber: number; why: string }[];
}

// JSON Schema for structured output (basic types only — no min/max constraints).
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    invoice: {
      type: "object",
      additionalProperties: false,
      properties: {
        supplierName: { type: ["string", "null"] },
        invoiceNumber: { type: ["string", "null"] },
        invoiceDate: { type: ["string", "null"], description: "ISO 8601 date (YYYY-MM-DD) if determinable" },
        currency: { type: ["string", "null"], description: "ISO currency code, e.g. DKK" },
        totalAmount: { type: ["number", "null"], description: "Gross total incl. VAT, positive number" },
        documentType: { type: "string", enum: ["invoice", "receipt", "credit_note", "other"] },
        summary: { type: "string", description: "One-line human summary of the document" },
      },
      required: ["supplierName", "invoiceNumber", "invoiceDate", "currency", "totalAmount", "documentType", "summary"],
    },
    match: {
      type: "object",
      additionalProperties: false,
      properties: {
        voucherId: { type: ["string", "null"], description: "voucherId of the best matching voucher, or null if none fits" },
        voucherNumber: { type: ["integer", "null"] },
        confidence: { type: "string", enum: ["high", "medium", "low", "none"] },
        reasoning: { type: "string", description: "Why this voucher (or why no match)" },
      },
      required: ["voucherId", "voucherNumber", "confidence", "reasoning"],
    },
    alternates: {
      type: "array",
      description: "Up to 3 other plausible vouchers, best first",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          voucherId: { type: "string" },
          voucherNumber: { type: "integer" },
          why: { type: "string" },
        },
        required: ["voucherId", "voucherNumber", "why"],
      },
    },
  },
  required: ["invoice", "match", "alternates"],
} as const;

const SYSTEM = `You are an accounting assistant for a Danish company using e-conomic.
You receive a scanned invoice or receipt and a list of draft bank-transaction vouchers
that are missing their supporting document (bilag). Your job:
1. Extract the invoice's key fields.
2. Decide which voucher the document belongs to. The voucher's amount should correspond
   to the invoice total — bank payments are typically recorded as a NEGATIVE amount, so an
   invoice of 1.250,00 DKK usually matches a voucher with amount -1250. Use date proximity
   (the bank entry is on/after the invoice date) and the supplier name vs. the voucher text
   as tiebreakers. Only claim "high" confidence on a clear amount match. If nothing fits,
   set voucherId null and confidence "none". Never guess a voucher whose amount is clearly different.
Danish number format uses '.' for thousands and ',' for decimals.`;

function mediaBlock(bytes: Buffer, mimetype: string): Anthropic.ContentBlockParam {
  const data = bytes.toString("base64");
  if (mimetype === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  // images: image/jpeg | image/png | image/gif | image/webp
  return {
    type: "image",
    source: { type: "base64", media_type: mimetype as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data },
  };
}

export async function extractAndMatch(
  bytes: Buffer,
  mimetype: string,
  candidates: VoucherCandidate[],
): Promise<MatchResult> {
  const anthropic = getClient();
  const candidateText =
    candidates.length === 0
      ? "(no candidate vouchers are missing a bilag)"
      : candidates
          .map((c) => `- voucherId=${c.voucherId} #${c.voucherNumber} date=${c.date ?? "?"} amount=${c.amount ?? "?"} text=${JSON.stringify(c.text ?? "")}`)
          .join("\n");

  // Force Claude to return structured data by calling a single tool whose input
  // schema is our result shape (strict = guaranteed-valid input).
  const res = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 4096,
    system: SYSTEM,
    tools: [
      {
        name: "record_invoice_match",
        description: "Record the extracted invoice fields and the matched voucher.",
        input_schema: SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "record_invoice_match" },
    messages: [
      {
        role: "user",
        content: [
          mediaBlock(bytes, mimetype),
          {
            type: "text",
            text:
              `Here are the draft vouchers currently missing a bilag:\n${candidateText}\n\n` +
              `Extract the document and choose the best matching voucher.`,
          },
        ],
      },
    ],
  });

  const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("Claude did not return a structured match");
  const out = toolUse.input as MatchResult;
  if (!out?.invoice || !out?.match) throw new Error("Claude returned an unexpected shape");
  if (!Array.isArray(out.alternates)) out.alternates = [];
  return out;
}

export function isConfigured(): boolean {
  return Boolean(config.anthropic.apiKey);
}
