import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Clock, Loader2 } from "lucide-react";

interface Job {
  id: string;
  created_at: string;
  source: string;
  created_by: string;
  filename: string | null;
  supplier_name: string | null;
  total_amount: string | null;
  currency: string | null;
  status: string;
  match_voucher_number: number | null;
  match_confidence: string | null;
  attached_voucher_id: string | null;
}

const statusBadge: Record<string, string> = {
  attached: "bg-success/15 text-success border-success/30",
  suggested: "bg-secondary text-foreground",
  rejected: "bg-muted text-muted-foreground",
  error: "bg-destructive/15 text-destructive border-destructive/30",
  processing: "bg-muted text-muted-foreground",
};

const kr = (n: string | null, c: string | null) => {
  if (n == null) return "—";
  const v = Number(n);
  return Number.isNaN(v) ? "—" : `${v.toLocaleString("da-DK", { minimumFractionDigits: 2 })} ${c ?? ""}`;
};

export function History() {
  const [jobs, setJobs] = useState<Job[] | null>(null);

  useEffect(() => {
    api.get("/api/invoices").then((d) => setJobs(d.jobs)).catch((e) => { setJobs([]); console.error((e as ApiError).message); });
  }, []);

  return (
    <div className="grid gap-4">
      <h1 className="flex items-center gap-2 text-lg font-semibold"><Clock className="size-5" /> AI History</h1>
      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">When</TableHead>
              <TableHead>Document</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs === null ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                <Loader2 className="mr-2 inline size-4 animate-spin" /> Loading…
              </TableCell></TableRow>
            ) : jobs.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No AI activity yet.</TableCell></TableRow>
            ) : (
              jobs.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="text-muted-foreground">{new Date(j.created_at).toLocaleString("da-DK")}</TableCell>
                  <TableCell>
                    {j.filename ?? "—"}
                    {j.source === "email" && <Badge variant="outline" className="ml-1.5">email</Badge>}
                  </TableCell>
                  <TableCell>{j.supplier_name ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{kr(j.total_amount, j.currency)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadge[j.status]}>{j.status}</Badge>
                    {j.status === "attached" && j.match_voucher_number != null && (
                      <span className="ml-1.5 text-xs text-muted-foreground">→ #{j.match_voucher_number}</span>
                    )}
                    {j.status === "suggested" && j.match_confidence && (
                      <span className="ml-1.5 text-xs text-muted-foreground">{j.match_confidence}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{j.created_by}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
