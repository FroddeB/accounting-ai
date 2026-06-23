import { config } from "../config.js";

/**
 * Bilag (voucher + attachment) helpers spanning both e-conomic APIs:
 *  - REST (restapi.e-conomic.com): journals and their draft vouchers/entries.
 *  - OpenAPI (apis.e-conomic.com): the Documents API, which authoritatively lists
 *    which vouchers HAVE an attached document. A draft voucher whose number is not
 *    in that list is "missing a bilag".
 *
 * Both APIs use the same two-token auth.
 */

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "X-AppSecretToken": config.economic.appSecretToken,
    "X-AgreementGrantToken": config.economic.agreementGrantToken,
    ...extra,
  };
}

async function restGet<T>(path: string): Promise<T> {
  const res = await fetch(`${config.economic.baseRest}${path}`, {
    headers: headers({ "Content-Type": "application/json" }),
  });
  if (!res.ok) throw new Error(`e-conomic REST ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export interface JournalSummary {
  journalNumber: number;
  name: string;
}

export interface VoucherSummary {
  journalNumber: number;
  /** e-conomic's own voucher id segment, e.g. "2025_6_2026-1" (year-encoded + number). */
  voucherId: string;
  accountingYear: string;
  voucherNumber: number;
  date: string | null;
  text: string | null;
  amount: number | null;
  hasAttachment: boolean;
}

/** Extract e-conomic's voucher id ("2025_6_2026-1") from a voucher self/attachment URL. */
function voucherIdFromUrl(url: string | undefined): string {
  if (!url) return "";
  const m = url.match(/\/vouchers\/([^/]+)/);
  return m ? m[1] : "";
}

export async function listJournals(): Promise<JournalSummary[]> {
  const j = await restGet<{ collection: any[] }>(`/journals?pagesize=100`);
  return (j.collection ?? []).map((x) => ({ journalNumber: x.journalNumber, name: x.name }));
}

/**
 * Upload a bilag (receipt/invoice) to a voucher. POSTs the raw file bytes to the
 * voucher's attachment/file endpoint. e-conomic accepts the file with its own
 * mime type (application/pdf, image/jpeg, image/png, ...).
 */
export async function uploadVoucherAttachment(
  journalNumber: number,
  voucherId: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const url = `${config.economic.baseRest}/journals/${journalNumber}/vouchers/${voucherId}/attachment/file`;
  const res = await fetch(url, {
    method: "POST",
    headers: headers({ "Content-Type": contentType }),
    body: bytes,
  });
  if (!res.ok) throw new Error(`Attachment upload → ${res.status}: ${await res.text()}`);
}

/** Remove a voucher's attachment (used to undo / replace). */
export async function deleteVoucherAttachment(journalNumber: number, voucherId: string): Promise<void> {
  const url = `${config.economic.baseRest}/journals/${journalNumber}/vouchers/${voucherId}/attachment/file`;
  const res = await fetch(url, { method: "DELETE", headers: headers() });
  if (!res.ok && res.status !== 404) throw new Error(`Attachment delete → ${res.status}: ${await res.text()}`);
}

/** All draft vouchers in a journal, with a derived date/text/amount per voucher. */
async function listVouchersRaw(journalNumber: number): Promise<Omit<VoucherSummary, "hasAttachment">[]> {
  const out: Omit<VoucherSummary, "hasAttachment">[] = [];
  let next: string | undefined = `/journals/${journalNumber}/vouchers?pagesize=1000`;
  while (next) {
    const page: { collection: any[]; pagination?: { nextPage?: string } } = await restGet(next);
    for (const v of page.collection ?? []) {
      // A voucher bundles entries across several arrays (financeVouchers, etc.).
      const entries: any[] = Object.values(v.entries ?? {}).flatMap((a) => (Array.isArray(a) ? a : []));
      const dates = entries.map((e) => e.date).filter(Boolean).sort();
      const text = entries.find((e) => e.text)?.text ?? null;
      // Show the largest-magnitude line amount as the headline figure.
      const amount = entries.reduce<number | null>(
        (acc, e) => (typeof e.amount === "number" && (acc === null || Math.abs(e.amount) > Math.abs(acc)) ? e.amount : acc),
        null,
      );
      out.push({
        journalNumber,
        voucherId: voucherIdFromUrl(v.self ?? v.attachment),
        accountingYear: v.accountingYear?.year ?? "",
        voucherNumber: v.voucherNumber,
        date: dates[0] ?? null,
        text,
        amount,
      });
    }
    next = page.pagination?.nextPage;
  }
  return out;
}

/** Set of "{accountingYear}:{voucherNumber}" keys that already have an attached document. */
async function attachedVoucherKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  let skip = 0;
  const pageSize = 1000;
  for (;;) {
    const url = `${config.economic.baseOpenApi}/documentsapi/v1.0.0/AttachedDocuments?skippages=${skip}&pagesize=${pageSize}`;
    const res = await fetch(url, { headers: headers({ "Content-Type": "application/json" }) });
    if (!res.ok) throw new Error(`Documents API → ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { items?: any[] };
    const items = data.items ?? [];
    for (const d of items) keys.add(`${d.accountingYear}:${d.voucherNumber}`);
    if (items.length < pageSize) break;
    skip += 1;
  }
  return keys;
}

/** List a journal's vouchers, each flagged with whether it has an attachment. */
export async function listVouchersWithAttachmentStatus(journalNumber: number): Promise<VoucherSummary[]> {
  const [vouchers, attached] = await Promise.all([
    listVouchersRaw(journalNumber),
    attachedVoucherKeys(),
  ]);
  return vouchers
    .map((v) => ({ ...v, hasAttachment: attached.has(`${v.accountingYear}:${v.voucherNumber}`) }))
    .sort((a, b) => b.voucherNumber - a.voucherNumber);
}
