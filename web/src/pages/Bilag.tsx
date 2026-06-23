import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CheckCircle2, Loader2, Paperclip, RefreshCw, Upload } from "lucide-react";

interface Journal { journalNumber: number; name: string; }
interface Voucher {
  journalNumber: number;
  voucherId: string;
  accountingYear: string;
  voucherNumber: number;
  date: string | null;
  text: string | null;
  amount: number | null;
  hasAttachment: boolean;
}

const kr = (n: number | null) =>
  n == null ? "" : n.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function Bilag() {
  const { user, logout } = useAuth();
  const [journals, setJournals] = useState<Journal[]>([]);
  const [journal, setJournal] = useState<number | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [counts, setCounts] = useState({ total: 0, missing: 0 });
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get("/api/bilag/journals")
      .then((d) => {
        setJournals(d.journals);
        setJournal(d.journals[0]?.journalNumber ?? null);
      })
      .catch((e) => toast.error((e as ApiError).message));
  }, []);

  async function load(j: number) {
    setLoading(true);
    try {
      const d = await api.get(`/api/bilag/journals/${j}/vouchers`);
      setVouchers(d.vouchers);
      setCounts({ total: d.total, missing: d.missing });
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (journal != null) load(journal); }, [journal]);

  const shown = onlyMissing ? vouchers.filter((v) => !v.hasAttachment) : vouchers;

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-3">
          <Paperclip className="size-5" />
          <strong className="text-sm">Projekt Y — Bilag</strong>
          <div className="flex-1" />
          <span className="text-sm text-muted-foreground">{user?.email}</span>
          <Button variant="ghost" size="sm" onClick={logout}>Log out</Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <Select value={journal?.toString() ?? ""} onValueChange={(v) => setJournal(Number(v))}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Select journal" /></SelectTrigger>
            <SelectContent>
              {journals.map((j) => (
                <SelectItem key={j.journalNumber} value={j.journalNumber.toString()}>{j.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={onlyMissing} onCheckedChange={(c) => setOnlyMissing(c === true)} />
            Only missing bilag
          </label>

          <div className="flex-1" />
          <Badge variant="outline" className="border-warning/40 bg-warning/10 text-foreground">
            {counts.missing} missing
          </Badge>
          <Badge variant="secondary">{counts.total} total</Badge>
          <Button variant="ghost" size="sm" disabled={journal == null || loading}
            onClick={() => journal != null && load(journal)}>
            <RefreshCw className={loading ? "animate-spin" : ""} /> Refresh
          </Button>
        </div>

        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">#</TableHead>
                <TableHead className="w-28">Date</TableHead>
                <TableHead>Text</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-44">Bilag</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="mr-2 inline size-4 animate-spin" /> Loading vouchers…
                </TableCell></TableRow>
              ) : shown.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  {onlyMissing ? "No vouchers are missing a bilag 🎉" : "No vouchers."}
                </TableCell></TableRow>
              ) : (
                shown.map((v) => (
                  <Row key={`${v.accountingYear}:${v.voucherNumber}`} v={v}
                    onChanged={() => journal != null && load(journal)} />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </main>
    </div>
  );
}

function Row({ v, onChanged }: { v: Voucher; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await api.upload(`/api/bilag/journals/${v.journalNumber}/vouchers/${v.voucherId}/attachment`, file);
      toast.success(`Bilag added to voucher #${v.voucherNumber}`);
      onChanged();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <TableRow className={v.hasAttachment ? "" : "bg-warning/5"}>
      <TableCell className="font-medium">{v.voucherNumber}</TableCell>
      <TableCell className="text-muted-foreground">{v.date ?? ""}</TableCell>
      <TableCell>{v.text ?? <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell className="text-right tabular-nums">{kr(v.amount)}</TableCell>
      <TableCell>
        {v.hasAttachment ? (
          <span className="inline-flex items-center gap-1 text-sm text-success">
            <CheckCircle2 className="size-4" /> Attached
          </span>
        ) : (
          <>
            <input ref={fileRef} type="file" accept=".pdf,image/*" hidden onChange={onPick} />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {busy ? "Uploading…" : "Add bilag"}
            </Button>
          </>
        )}
      </TableCell>
    </TableRow>
  );
}
