import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Banknote, Loader2, TrendingUp, Wallet } from "lucide-react";

interface DashboardData {
  liquidity: { accounts: { number: number; name: string; draftBalance: number }[]; total: number };
  result: { revenue: number; costs: number; net: number };
  daybookSaldo: number;
  bilag: { journalName: string; missing: number; total: number };
  topAccounts: { number: number; name: string; type: string; draftBalance: number }[];
  generatedAt: string;
}

const kr = (n: number) =>
  n.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " kr.";

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get("/api/dashboard").then(setData).catch((e) => setErr((e as ApiError).message));
  }, []);

  if (err) return <p className="text-sm text-destructive">{err}</p>;
  if (!data) {
    return (
      <div className="grid place-items-center py-20 text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Building overview from e-conomic…
        </span>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<Banknote className="size-4" />} label="Liquidity (bank & cash)" value={kr(data.liquidity.total)} accent />
        <Kpi icon={<TrendingUp className="size-4" />} label="Result year-to-date"
          value={kr(data.result.net)} sub={`Revenue ${kr(data.result.revenue)} · Costs ${kr(data.result.costs)}`} />
        <Kpi icon={<Wallet className="size-4" />} label="Daybook saldo (to book)" value={kr(data.daybookSaldo)} />
        <Link to="/bilag">
          <Kpi icon={<AlertTriangle className="size-4" />} label="Vouchers missing a bilag"
            value={data.bilag.missing.toString()} sub={`of ${data.bilag.total} in ${data.bilag.journalName}`}
            warn={data.bilag.missing > 0} />
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Bank & cash accounts</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {data.liquidity.accounts.map((a) => (
                  <TableRow key={a.number}>
                    <TableCell className="text-muted-foreground">{a.number}</TableCell>
                    <TableCell>{a.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{kr(a.draftBalance)}</TableCell>
                  </TableRow>
                ))}
                {data.liquidity.accounts.length === 0 && (
                  <TableRow><TableCell className="text-muted-foreground">No liquidity accounts found.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Largest balances</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead className="w-16">#</TableHead><TableHead>Account</TableHead><TableHead className="text-right">Draft balance</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {data.topAccounts.map((a) => (
                  <TableRow key={a.number}>
                    <TableCell className="text-muted-foreground">{a.number}</TableCell>
                    <TableCell>{a.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{kr(a.draftBalance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Draft-inclusive figures (booked + unbooked daybook). Updated {new Date(data.generatedAt).toLocaleTimeString("da-DK")}.
      </p>
    </div>
  );
}

function Kpi({ icon, label, value, sub, accent, warn }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent?: boolean; warn?: boolean;
}) {
  return (
    <Card className={warn ? "border-warning/40" : ""}>
      <CardContent className="pt-6">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">{icon}{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent ? "text-success" : ""} ${warn ? "text-warning" : ""}`}>
          {value}
        </div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
