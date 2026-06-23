import { config } from "../config.js";
import { listVouchersWithAttachmentStatus } from "./economicBilag.js";
import { getIgnoredKeys, ignoreKey } from "../db/ignored.js";

/**
 * Dashboard overview. e-conomic exposes draftBalance only per-account (no bulk
 * endpoint), so we fetch each account and aggregate. Results are cached briefly
 * to keep the dashboard snappy without hammering the API on every load.
 *
 * All figures are DRAFT-inclusive (booked + unbooked daybook entries) — for this
 * agreement booked balances are 0; the real numbers live in draftBalance.
 */

function headers(): Record<string, string> {
  return {
    "X-AppSecretToken": config.economic.appSecretToken,
    "X-AgreementGrantToken": config.economic.agreementGrantToken,
    "Content-Type": "application/json",
  };
}

interface AccountFig { number: number; name: string; type: string; draftBalance: number; }

export interface DashboardData {
  liquidity: { accounts: { number: number; name: string; draftBalance: number }[]; total: number };
  result: { revenue: number; costs: number; net: number };
  daybookSaldo: number;
  bilag: { journalName: string; missing: number; total: number };
  topAccounts: { number: number; name: string; type: string; draftBalance: number }[];
  generatedAt: string;
}

// Liquidity accounts (cash/bank): match by common Danish names or the 58xx range.
const LIQUIDITY_RE = /bank|kasse|likvid|giro/i;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${config.economic.baseRest}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`e-conomic ${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function fetchAllAccounts(): Promise<AccountFig[]> {
  const list = await get<{ collection: { accountNumber: number; name?: string; accountType?: string }[] }>(
    `/accounts?pagesize=1000`,
  );
  const accts = list.collection ?? [];
  const out: AccountFig[] = [];
  let i = 0;
  const CONCURRENCY = 8;
  async function worker() {
    while (i < accts.length) {
      const a = accts[i++];
      try {
        const d = await get<{ draftBalance?: number; balance?: number }>(`/accounts/${a.accountNumber}`);
        out.push({
          number: a.accountNumber,
          name: a.name ?? "",
          type: a.accountType ?? "",
          draftBalance: d.draftBalance ?? d.balance ?? 0,
        });
      } catch {
        out.push({ number: a.accountNumber, name: a.name ?? "", type: a.accountType ?? "", draftBalance: 0 });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

let cache: { at: number; data: DashboardData } | null = null;
const TTL_MS = 60_000;

export async function getDashboard(): Promise<DashboardData> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const [accounts, vouchers, ignored] = await Promise.all([
    fetchAllAccounts(),
    listVouchersWithAttachmentStatus(1), // "Daglig" is journal 1
    getIgnoredKeys(),
  ]);

  const postable = accounts.filter((a) => a.type === "profitAndLoss" || a.type === "status");
  const pl = postable.filter((a) => a.type === "profitAndLoss");
  // DK convention: revenue is credit (negative balance), costs are debit (positive).
  const revenue = -pl.filter((a) => a.draftBalance < 0).reduce((s, a) => s + a.draftBalance, 0);
  const costs = pl.filter((a) => a.draftBalance > 0).reduce((s, a) => s + a.draftBalance, 0);

  const liquidityAccts = accounts
    .filter((a) => a.type === "status" && LIQUIDITY_RE.test(a.name))
    .map((a) => ({ number: a.number, name: a.name, draftBalance: a.draftBalance }));

  const missing = vouchers.filter(
    (v) => !v.hasAttachment && !ignored.has(ignoreKey(v.accountingYear, v.voucherNumber)),
  ).length;

  const data: DashboardData = {
    liquidity: {
      accounts: liquidityAccts,
      total: liquidityAccts.reduce((s, a) => s + a.draftBalance, 0),
    },
    result: { revenue, costs, net: revenue - costs },
    daybookSaldo: postable.reduce((s, a) => s + a.draftBalance, 0),
    bilag: { journalName: "Daglig", missing, total: vouchers.length },
    topAccounts: postable
      .filter((a) => a.draftBalance !== 0)
      .sort((a, b) => Math.abs(b.draftBalance) - Math.abs(a.draftBalance))
      .slice(0, 12),
    generatedAt: new Date().toISOString(),
  };

  cache = { at: Date.now(), data };
  return data;
}
