import { useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "../api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, FileUp, Loader2, Sparkles, Upload } from "lucide-react";

interface Job {
  id: string;
  status: string;
  filename: string | null;
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  currency: string | null;
  total_amount: string | null;
  match_voucher_id: string | null;
  match_voucher_number: number | null;
  match_confidence: string | null;
  match_reasoning: string | null;
  error: string | null;
}
interface Voucher { voucherId: string; voucherNumber: number; date: string | null; text: string | null; amount: number | null; }

const kr = (n: number | null | string) => {
  const v = typeof n === "string" ? Number(n) : n;
  return v == null || Number.isNaN(v) ? "—" : v.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const confColor: Record<string, string> = {
  high: "bg-success/15 text-success border-success/30",
  medium: "bg-secondary text-foreground",
  low: "bg-warning/15 text-warning border-warning/30",
  none: "bg-muted text-muted-foreground",
};

export function Invoices() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [candidates, setCandidates] = useState<Voucher[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [confirming, setConfirming] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setJob(null);
    try {
      const j: Job = await api.upload("/api/invoices", file);
      setJob(j);
      setSelected(j.match_voucher_id ?? "");
      // Load the missing-bilag vouchers so the user can override the match.
      const d = await api.get("/api/bilag/journals/1/vouchers?missing=true");
      setCandidates(d.vouchers);
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function confirm() {
    if (!job || !selected) return;
    setConfirming(true);
    try {
      const updated: Job = await api.post(`/api/invoices/${job.id}/confirm`, { voucherId: selected });
      setJob(updated);
      toast.success("Bilag attached in e-conomic ✓");
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setConfirming(false);
    }
  }

  async function reject() {
    if (!job) return;
    try {
      await api.post(`/api/invoices/${job.id}/reject`);
      toast.message("Suggestion dismissed");
      setJob(null);
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-5" /> AI Invoice Inbox</h1>
        <p className="text-sm text-muted-foreground">Upload an invoice or receipt — Claude reads it and finds the bank transaction it belongs to.</p>
      </div>

      {/* Upload zone */}
      <Card>
        <CardContent className="pt-6">
          <input ref={fileRef} type="file" accept=".pdf,image/*" hidden onChange={onFile} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-10 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-6 animate-spin" /> : <FileUp className="size-6" />}
            <span className="text-sm font-medium">{busy ? "Claude is reading the document…" : "Click to upload an invoice (PDF, JPG, PNG)"}</span>
          </button>
        </CardContent>
      </Card>

      {/* Result */}
      {job && job.status === "error" && (
        <Card className="border-destructive/40"><CardContent className="pt-6 text-sm text-destructive">Couldn't process this file: {job.error}</CardContent></Card>
      )}

      {job && job.status === "attached" && (
        <Card className="border-success/40">
          <CardContent className="flex items-center gap-2 pt-6 text-success">
            <CheckCircle2 className="size-5" /> Attached to voucher #{job.match_voucher_number} in e-conomic.
          </CardContent>
        </Card>
      )}

      {job && job.status === "suggested" && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Claude's reading of {job.filename}</CardTitle>
            <Badge variant="outline" className={confColor[job.match_confidence ?? "none"]}>
              {job.match_confidence} confidence
            </Badge>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Field label="Supplier" value={job.supplier_name} />
              <Field label="Amount" value={`${kr(job.total_amount)} ${job.currency ?? ""}`} />
              <Field label="Invoice date" value={job.invoice_date} />
              <Field label="Invoice no." value={job.invoice_number} />
            </div>

            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="mb-1 font-medium">Suggested match</div>
              <p className="text-muted-foreground">{job.match_reasoning}</p>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Attach to voucher</label>
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger><SelectValue placeholder="Pick a voucher" /></SelectTrigger>
                <SelectContent>
                  {candidates.map((v) => (
                    <SelectItem key={v.voucherId} value={v.voucherId}>
                      #{v.voucherNumber} · {v.date ?? "?"} · {kr(v.amount)} · {v.text ?? ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button onClick={confirm} disabled={!selected || confirming}>
                {confirming ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                Confirm & attach
              </Button>
              <Button variant="ghost" onClick={reject}>Dismiss</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}
