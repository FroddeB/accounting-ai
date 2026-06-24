import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Banknote, Loader2, Users } from "lucide-react";

interface Employee {
  id: string; name?: string; email?: string;
  employmentStatus?: string; affiliationType?: string; city?: string; paidOutThisYear?: number;
}
interface PayRoll {
  id: string; status?: string; payRollType?: string; dispositionDate?: string;
  isApproved?: boolean; isReviewed?: boolean; isTentative?: boolean;
  totalPaycheck?: number; totalTransfer?: number; totalHours?: number;
  salaryPeriod?: { start?: string; end?: string; name?: string };
  salaryCycle?: { name?: string };
}

const kr = (n?: number) =>
  n == null ? "—" : n.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function payrollBadge(p: PayRoll) {
  if (p.isApproved) return <Badge variant="outline" className="border-success/30 bg-success/15 text-success">approved</Badge>;
  if (p.isTentative) return <Badge variant="secondary">tentative</Badge>;
  if (p.isReviewed) return <Badge variant="secondary">reviewed</Badge>;
  return <Badge variant="outline">{p.status ?? "draft"}</Badge>;
}

export function Salary() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payrolls, setPayrolls] = useState<PayRoll[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/api/salary/status").then(async (s) => {
      setConfigured(s.configured);
      if (!s.configured) { setLoading(false); return; }
      try {
        const [emp, pr] = await Promise.all([
          api.get("/api/salary/employees"),
          api.get("/api/salary/payrolls"),
        ]);
        setEmployees(emp.data ?? []);
        setPayrolls(pr.data ?? []);
      } catch (e) {
        setErr((e as ApiError).message);
      } finally {
        setLoading(false);
      }
    }).catch((e) => { setErr((e as ApiError).message); setLoading(false); });
  }, []);

  const activeCount = employees.filter((e) => (e.employmentStatus ?? "").toLowerCase().includes("active") || e.employmentStatus === "employed").length;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold"><Banknote className="size-5" /> Salary</h1>
        <p className="text-sm text-muted-foreground">Employees and payroll runs from Salary.dk (read-only).</p>
      </div>

      {configured === false ? (
        <Card><CardContent className="pt-6 text-sm">
          <p className="font-medium">Salary.dk isn't connected yet.</p>
          <p className="mt-1 text-muted-foreground">Generate an API key in Salary → Settings → Company, then set <code>SALARY_API_KEY</code> on the server.</p>
        </CardContent></Card>
      ) : loading ? (
        <div className="grid place-items-center py-16 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
      ) : (
        <>
          {err && <p className="text-sm text-destructive">{err}</p>}

          <div className="grid gap-4 sm:grid-cols-3">
            <Kpi label="Employees" value={employees.length.toString()} sub={`${activeCount} active`} />
            <Kpi label="Payroll runs" value={payrolls.length.toString()} />
            <Kpi label="Latest paycheck total" value={kr(payrolls[0]?.totalPaycheck) + " kr."} sub={payrolls[0]?.salaryPeriod?.name ?? ""} />
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Payroll runs</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead><TableHead>Type</TableHead>
                    <TableHead>Disposition</TableHead>
                    <TableHead className="text-right">Paycheck</TableHead>
                    <TableHead className="text-right">Transfer</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payrolls.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.salaryPeriod?.name ?? `${p.salaryPeriod?.start ?? ""} – ${p.salaryPeriod?.end ?? ""}`}</TableCell>
                      <TableCell className="text-muted-foreground">{p.payRollType ?? p.salaryCycle?.name ?? ""}</TableCell>
                      <TableCell className="text-muted-foreground">{p.dispositionDate ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{kr(p.totalPaycheck)}</TableCell>
                      <TableCell className="text-right tabular-nums">{kr(p.totalTransfer)}</TableCell>
                      <TableCell>{payrollBadge(p)}</TableCell>
                    </TableRow>
                  ))}
                  {payrolls.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No payroll runs.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="size-4" /> Employees</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead><TableHead>Email</TableHead>
                    <TableHead>Status</TableHead><TableHead>City</TableHead>
                    <TableHead className="text-right">Paid out YTD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{e.email ?? "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{e.employmentStatus ?? e.affiliationType ?? "—"}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{e.city ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{kr(e.paidOutThisYear)}</TableCell>
                    </TableRow>
                  ))}
                  {employees.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No employees.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card><CardContent className="pt-6">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </CardContent></Card>
  );
}
