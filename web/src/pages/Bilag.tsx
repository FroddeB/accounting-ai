import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "../api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft, ChevronRight, EyeOff, Loader2, RefreshCw, RotateCcw, Search, Upload, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  ignored: boolean;
}

type View = "missing" | "all" | "ignored";
const PAGE_SIZES = [25, 50, 100];
const vkey = (v: Voucher) => `${v.accountingYear}:${v.voucherNumber}`;
const kr = (n: number | null) =>
  n == null ? "" : n.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function Bilag() {
  const [journals, setJournals] = useState<Journal[]>([]);
  const [journal, setJournal] = useState<number | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [counts, setCounts] = useState({ total: 0, missing: 0, ignored: 0 });
  const [view, setView] = useState<View>("missing");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    api.get("/api/bilag/journals")
      .then((d) => { setJournals(d.journals); setJournal(d.journals[0]?.journalNumber ?? null); })
      .catch((e) => toast.error((e as ApiError).message));
  }, []);

  async function load(j: number) {
    setLoading(true);
    try {
      const d = await api.get(`/api/bilag/journals/${j}/vouchers`);
      setVouchers(d.vouchers);
      setCounts({ total: d.total, missing: d.missing, ignored: d.ignored });
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (journal != null) load(journal); }, [journal]);
  // Clear selection / reset paging when the working set changes.
  useEffect(() => { setSelected(new Set()); setPage(1); }, [journal, view]);
  useEffect(() => { setPage(1); }, [search, pageSize]);

  const filtered = useMemo(() => {
    let list = vouchers.filter((v) =>
      view === "ignored" ? v.ignored : view === "missing" ? !v.hasAttachment && !v.ignored : !v.ignored,
    );
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((v) =>
        String(v.voucherNumber).includes(q) ||
        (v.text ?? "").toLowerCase().includes(q) ||
        (v.date ?? "").includes(q) ||
        (v.amount != null && (String(v.amount).includes(q) || kr(v.amount).toLowerCase().includes(q))),
      );
    }
    return list;
  }, [vouchers, view, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const shown = filtered.slice(start, start + pageSize);

  const allFilteredSelected = filtered.length > 0 && filtered.every((v) => selected.has(vkey(v)));
  const someSelected = selected.size > 0;

  function toggleAll() {
    setSelected(allFilteredSelected ? new Set() : new Set(filtered.map(vkey)));
  }
  function toggleOne(v: Voucher) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(vkey(v)) ? next.delete(vkey(v)) : next.add(vkey(v));
      return next;
    });
  }

  const selectedVouchers = () => filtered.filter((v) => selected.has(vkey(v)));

  async function ignoreVouchers(vs: Voucher[]) {
    if (vs.length === 0) return;
    setBulkBusy(true);
    try {
      await api.post("/api/bilag/ignore", {
        vouchers: vs.map((v) => ({
          journalNumber: v.journalNumber, voucherId: v.voucherId,
          voucherNumber: v.voucherNumber, accountingYear: v.accountingYear,
        })),
      });
      toast.success(`Ignored ${vs.length} voucher${vs.length === 1 ? "" : "s"}`);
      setSelected(new Set());
      if (journal != null) await load(journal);
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally { setBulkBusy(false); }
  }

  async function restoreVouchers(vs: Voucher[]) {
    if (vs.length === 0) return;
    setBulkBusy(true);
    try {
      await api.post("/api/bilag/unignore", {
        vouchers: vs.map((v) => ({ accountingYear: v.accountingYear, voucherNumber: v.voucherNumber })),
      });
      toast.success(`Restored ${vs.length} voucher${vs.length === 1 ? "" : "s"}`);
      setSelected(new Set());
      if (journal != null) await load(journal);
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally { setBulkBusy(false); }
  }

  const viewBtn = (v: View, label: string, n: number) => (
    <Button variant={view === v ? "secondary" : "ghost"} size="sm" onClick={() => setView(v)}>
      {label} <Badge variant="outline" className="ml-1.5">{n}</Badge>
    </Button>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={journal?.toString() ?? ""} onValueChange={(v) => setJournal(Number(v))}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Journal" /></SelectTrigger>
          <SelectContent>
            {journals.map((j) => <SelectItem key={j.journalNumber} value={j.journalNumber.toString()}>{j.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 rounded-md border bg-background p-0.5">
          {viewBtn("missing", "Missing", counts.missing)}
          {viewBtn("all", "All", counts.total)}
          {viewBtn("ignored", "Ignored", counts.ignored)}
        </div>
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8 pr-8" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch("")} aria-label="Clear"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button variant="ghost" size="sm" disabled={journal == null || loading} onClick={() => journal != null && load(journal)}>
          <RefreshCw className={loading ? "animate-spin" : ""} /> Refresh
        </Button>
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 rounded-md border bg-secondary/50 px-3 py-2 text-sm">
          <strong>{selected.size} selected</strong>
          <div className="flex-1" />
          {view === "ignored" ? (
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => restoreVouchers(selectedVouchers())}>
              {bulkBusy ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Restore
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => ignoreVouchers(selectedVouchers())}>
              {bulkBusy ? <Loader2 className="size-4 animate-spin" /> : <EyeOff className="size-4" />} Ignore selected
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allFilteredSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead className="w-14">#</TableHead>
              <TableHead className="w-28">Date</TableHead>
              <TableHead>Text</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-40">Bilag</TableHead>
              <TableHead className="w-28">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                <Loader2 className="mr-2 inline size-4 animate-spin" /> Loading vouchers…
              </TableCell></TableRow>
            ) : shown.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                {search ? `No vouchers match “${search}”.`
                  : view === "missing" ? "Nothing missing a bilag 🎉"
                  : view === "ignored" ? "No ignored vouchers." : "No vouchers."}
              </TableCell></TableRow>
            ) : (
              shown.map((v) => (
                <Row key={vkey(v)} v={v} view={view}
                  selected={selected.has(vkey(v))} onToggle={() => toggleOne(v)}
                  onIgnore={() => ignoreVouchers([v])} onRestore={() => restoreVouchers([v])}
                  onUploaded={() => journal != null && load(journal)} />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination footer */}
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>{filtered.length === 0 ? "0" : `${start + 1}–${Math.min(start + pageSize, filtered.length)}`} of {filtered.length}</span>
        <div className="flex items-center gap-1">
          <span>Rows:</span>
          <Select value={pageSize.toString()} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-[72px]"><SelectValue /></SelectTrigger>
            <SelectContent>{PAGE_SIZES.map((n) => <SelectItem key={n} value={n.toString()}>{n}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex-1" />
        <span>Page {safePage} of {pageCount}</span>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" className="size-8" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon" className="size-8" disabled={safePage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ v, view, selected, onToggle, onIgnore, onRestore, onUploaded }: {
  v: Voucher; view: View; selected: boolean;
  onToggle: () => void; onIgnore: () => void; onRestore: () => void; onUploaded: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await api.upload(`/api/bilag/journals/${v.journalNumber}/vouchers/${v.voucherId}/attachment`, file);
      toast.success(`Bilag added to voucher #${v.voucherNumber}`);
      onUploaded();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <TableRow className={cn(!v.hasAttachment && !v.ignored && "bg-warning/5", selected && "bg-secondary/40")}>
      <TableCell><Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Select voucher ${v.voucherNumber}`} /></TableCell>
      <TableCell className="font-medium">{v.voucherNumber}</TableCell>
      <TableCell className="text-muted-foreground">{v.date ?? ""}</TableCell>
      <TableCell>{v.text ?? <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell className="text-right tabular-nums">{kr(v.amount)}</TableCell>
      <TableCell>
        {v.hasAttachment ? (
          <span className="text-sm text-success">✓ Attached</span>
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
      <TableCell>
        {view === "ignored" || v.ignored ? (
          <Button size="sm" variant="ghost" onClick={onRestore}><RotateCcw className="size-4" /> Restore</Button>
        ) : (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onIgnore}>
            <EyeOff className="size-4" /> Ignore
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
