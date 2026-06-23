import { query } from "./pool.js";

/**
 * "Ignored" vouchers — flagged only in our DB (never in e-conomic). Keyed by
 * (accounting_year, voucher_number), matching the attachment cross-reference.
 */

export interface IgnoreInput {
  journalNumber: number;
  voucherId: string;
  voucherNumber: number;
  accountingYear: string;
}

export const ignoreKey = (accountingYear: string, voucherNumber: number) =>
  `${accountingYear}:${voucherNumber}`;

/** Set of "year:number" keys currently ignored. */
export async function getIgnoredKeys(): Promise<Set<string>> {
  const r = await query<{ accounting_year: string; voucher_number: number }>(
    `SELECT accounting_year, voucher_number FROM ignored_vouchers`,
  );
  return new Set(r.rows.map((x) => ignoreKey(x.accounting_year, x.voucher_number)));
}

/** Ignore one or more vouchers (idempotent). Returns the number newly ignored. */
export async function addIgnored(vouchers: IgnoreInput[], actor: string, reason?: string): Promise<number> {
  let added = 0;
  for (const v of vouchers) {
    const r = await query(
      `INSERT INTO ignored_vouchers
         (accounting_year, voucher_number, journal_number, voucher_id, ignored_by, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (accounting_year, voucher_number) DO NOTHING`,
      [v.accountingYear, v.voucherNumber, v.journalNumber, v.voucherId, actor, reason ?? null],
    );
    added += r.rowCount ?? 0;
  }
  return added;
}

/** Un-ignore one or more vouchers by (year, number). Returns the number removed. */
export async function removeIgnored(
  vouchers: { accountingYear: string; voucherNumber: number }[],
): Promise<number> {
  let removed = 0;
  for (const v of vouchers) {
    const r = await query(
      `DELETE FROM ignored_vouchers WHERE accounting_year = $1 AND voucher_number = $2`,
      [v.accountingYear, v.voucherNumber],
    );
    removed += r.rowCount ?? 0;
  }
  return removed;
}
