import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, FileUp, Loader2, Save, Sparkles, Trash2, Wallet, X } from "lucide-react";

export interface Department { id: string; name?: string }
interface Ref { id: string; name?: string; title?: string; class?: string; active?: boolean; frequency?: string; code?: string }
interface Reference {
  salaryTypes: Ref[]; salaryCycles: Ref[]; leaveTypes: Ref[];
  productionUnits: Ref[]; departments: Department[]; employmentPositions: Ref[];
}

interface Form {
  // master data
  name: string; email: string; phoneNumber: string; address: string;
  postalCode: string; city: string; nationalID: string;
  bankRegistrationNumber: string; bankAccountNumber: string;
  affiliationType: string; language: string; departmentID: string;
  // payslip delivery (TRIN 2 Kommunikation)
  paySlipMitDK: boolean; paySlipEMail: boolean; paySlipEBoks: boolean; paySlipSMS: boolean;
  // contract / salary
  position: string; employmentPositionID: string; startDate: string;
  productionUnitID: string; salaryCycleID: string;
  salaryTypeID: string; monthlySalary: string;
  weeklyHours: string; workDaysPerWeek: string;
  leaveTypeID: string; vacationDays: string;
  lunchAmount: string; lunchType: string; // "Lunch" (per period) | "Lunch Daily" (per day)
  // vacation scheme
  ferieType: string; ferietillæg: string; storeBededagstillæg: boolean;
}

const EMPTY: Form = {
  name: "", email: "", phoneNumber: "", address: "", postalCode: "", city: "",
  nationalID: "", bankRegistrationNumber: "", bankAccountNumber: "",
  affiliationType: "Standard", language: "da", departmentID: "",
  paySlipMitDK: true, paySlipEMail: true, paySlipEBoks: false, paySlipSMS: false,
  position: "", employmentPositionID: "", startDate: "", productionUnitID: "", salaryCycleID: "",
  salaryTypeID: "", monthlySalary: "", weeklyHours: "", workDaysPerWeek: "",
  leaveTypeID: "", vacationDays: "25", lunchAmount: "", lunchType: "Lunch",
  ferieType: "Ferie med løn", ferietillæg: "1", storeBededagstillæg: true,
};

const AFFILIATIONS = ["Standard", "Director", "MajorityShareholder", "Freelancer"];
const discoLabel = (p: Ref) => `${p.title ?? p.id}${p.code ? ` (${p.code})` : ""}`;

// Salary's "not ready" reason is already formatted by the backend.
function fmtReady(e: unknown): string {
  if (typeof e === "string") return e;
  return "missing required fields";
}

export function EmployeeEditor({
  employeeId, departments, aiEnabled, onClose, onSaved,
}: {
  employeeId: string | null; // null = create
  departments: Department[];
  aiEnabled: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = employeeId !== null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [readying, setReadying] = useState(false);
  const [ref, setRef] = useState<Reference | null>(null);
  const [lunchOn, setLunchOn] = useState(false);

  const set = (k: keyof Form) => (v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  // Reference data (salary types, cycles, DISCO-08 positions, …) for the contract form.
  useEffect(() => {
    api.get("/api/salary/employees/reference").then((r: Reference) => {
      setRef(r);
      const cycle = r.salaryCycles.find((c) => c.frequency === "Monthly") ?? r.salaryCycles[0];
      const fixed = r.salaryTypes.find((s) => s.active && s.class === "Fixed") ?? r.salaryTypes.find((s) => s.class === "Fixed");
      const ferie = r.leaveTypes.find((l) => /ferie|vacation/i.test(l.name ?? "")) ?? r.leaveTypes[0];
      const pu = r.productionUnits[0];
      setForm((f) => ({
        ...f,
        salaryCycleID: f.salaryCycleID || cycle?.id || "",
        salaryTypeID: f.salaryTypeID || fixed?.id || "",
        leaveTypeID: f.leaveTypeID || ferie?.id || "",
        productionUnitID: f.productionUnitID || pu?.id || "",
      }));
    }).catch((e) => toast.error(`Couldn't load Salary.dk config: ${(e as ApiError).message}`));
  }, []);

  useEffect(() => {
    if (!isEdit) { setLoading(false); return; }
    // Load master record + current contract together so every field prefills.
    Promise.all([
      api.get(`/api/salary/employees/${employeeId}`),
      api.get(`/api/salary/employees/${employeeId}/contract`).catch(() => ({ hasContract: false })),
    ])
      .then(([e, k]) => {
        if (k.lunchAmount != null) setLunchOn(true);
        setForm((f) => ({
          ...f,
          name: e.name ?? "", email: e.email ?? "", phoneNumber: e.phoneNumber ?? "",
          address: e.address ?? "", postalCode: e.postalCode ?? "", city: e.city ?? "",
          nationalID: e.nationalID ?? "", bankRegistrationNumber: e.bankRegistrationNumber ?? "",
          bankAccountNumber: e.bankAccountNumber ?? "",
          affiliationType: e.affiliationType || "Standard", language: e.language || "da",
          departmentID: e.departmentID ?? "",
          paySlipMitDK: e.paySlipTransportMitDK ?? f.paySlipMitDK,
          paySlipEMail: e.paySlipTransportEMail ?? f.paySlipEMail,
          paySlipEBoks: e.paySlipTransportEBoks ?? f.paySlipEBoks,
          paySlipSMS: e.paySlipTransportSMS ?? f.paySlipSMS,
          // contract (if the employee already has one)
          position: k.position ?? f.position,
          employmentPositionID: k.employmentPositionID ?? f.employmentPositionID,
          startDate: (k.validFrom ?? f.startDate)?.slice(0, 10) ?? "",
          productionUnitID: k.productionUnitID ?? f.productionUnitID,
          salaryCycleID: k.salaryCycleID ?? f.salaryCycleID,
          salaryTypeID: k.salaryTypeID ?? f.salaryTypeID,
          monthlySalary: k.monthlySalary != null ? String(k.monthlySalary) : f.monthlySalary,
          weeklyHours: k.weeklyHours != null ? String(k.weeklyHours) : f.weeklyHours,
          workDaysPerWeek: k.workDaysPerWeek != null ? String(k.workDaysPerWeek) : f.workDaysPerWeek,
          leaveTypeID: k.leaveTypeID ?? f.leaveTypeID,
          vacationDays: k.vacationDays != null ? String(k.vacationDays) : f.vacationDays,
          lunchAmount: k.lunchAmount != null ? String(k.lunchAmount) : f.lunchAmount,
          lunchType: k.lunchType ?? f.lunchType,
          ferieType: k.ferieType ?? f.ferieType,
          ferietillæg: k.ferietillæg != null ? String(k.ferietillæg) : f.ferietillæg,
          storeBededagstillæg: k.storeBededagstillæg != null ? k.storeBededagstillæg : f.storeBededagstillæg,
        }));
      })
      .catch((err) => toast.error((err as ApiError).message))
      .finally(() => setLoading(false));
  }, [employeeId, isEdit]);

  const discoOptions = ref?.employmentPositions ?? [];
  const discoCurrentLabel = useMemo(
    () => discoOptions.find((p) => p.id === form.employmentPositionID),
    [discoOptions, form.employmentPositionID],
  );

  async function onContract(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const { draft } = await api.upload("/api/salary/employees/parse-contract", file);
      const dept = draft.departmentName
        ? departments.find((d) => (d.name ?? "").toLowerCase().includes(String(draft.departmentName).toLowerCase()))
        : undefined;
      const cycleByFreq = draft.payFrequency
        ? ref?.salaryCycles.find((c) => c.frequency === draft.payFrequency)
        : undefined;
      setForm((f) => ({
        ...f,
        name: draft.name ?? f.name,
        email: draft.email ?? f.email,
        phoneNumber: draft.phoneNumber ?? f.phoneNumber,
        address: draft.address ?? f.address,
        postalCode: draft.postalCode ?? f.postalCode,
        city: draft.city ?? f.city,
        nationalID: draft.nationalID ?? f.nationalID,
        bankRegistrationNumber: draft.bankRegistrationNumber ?? f.bankRegistrationNumber,
        bankAccountNumber: draft.bankAccountNumber ?? f.bankAccountNumber,
        affiliationType: draft.affiliationType ?? f.affiliationType,
        language: draft.language ?? f.language,
        departmentID: dept?.id ?? f.departmentID,
        position: draft.jobTitle ?? f.position,
        startDate: draft.startDate ?? f.startDate,
        monthlySalary: draft.monthlySalary != null ? String(draft.monthlySalary) : f.monthlySalary,
        weeklyHours: draft.weeklyHours != null ? String(draft.weeklyHours) : f.weeklyHours,
        workDaysPerWeek: draft.workDaysPerWeek != null ? String(draft.workDaysPerWeek) : f.workDaysPerWeek,
        vacationDays: draft.vacationDaysPerYear != null ? String(draft.vacationDaysPerYear) : f.vacationDays,
        lunchAmount: draft.lunchNetDeductionPerPeriod != null ? String(draft.lunchNetDeductionPerPeriod) : f.lunchAmount,
        salaryCycleID: cycleByFreq?.id ?? f.salaryCycleID,
      }));
      if (draft.hasLunchScheme || draft.lunchNetDeductionPerPeriod != null) setLunchOn(true);
      toast.success("Contract read — review everything below before saving");
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function masterPayload() {
    return {
      name: form.name, email: form.email, phoneNumber: form.phoneNumber, address: form.address,
      postalCode: form.postalCode, city: form.city, nationalID: form.nationalID,
      bankRegistrationNumber: form.bankRegistrationNumber, bankAccountNumber: form.bankAccountNumber,
      affiliationType: form.affiliationType, language: form.language, departmentID: form.departmentID,
      paySlipTransportMitDK: form.paySlipMitDK, paySlipTransportEMail: form.paySlipEMail,
      paySlipTransportEBoks: form.paySlipEBoks, paySlipTransportSMS: form.paySlipSMS,
    };
  }
  function contractPayload() {
    return {
      position: form.position, employmentPositionID: form.employmentPositionID,
      startDate: form.startDate, departmentID: form.departmentID,
      employmentType: form.affiliationType === "Freelancer" ? "Freelance" : "Ordinary",
      productionUnitID: form.productionUnitID, salaryCycleID: form.salaryCycleID,
      salaryTypeID: form.salaryTypeID, monthlySalary: form.monthlySalary,
      weeklyHours: form.weeklyHours, workDaysPerWeek: form.workDaysPerWeek,
      leaveTypeID: form.leaveTypeID, vacationDays: form.vacationDays,
      lunchAmount: lunchOn ? form.lunchAmount : "", lunchType: form.lunchType,
      ferieType: form.ferieType, ferietillæg: form.ferietillæg, storeBededagstillæg: form.storeBededagstillæg,
    };
  }

  // Create: master + contract in one call. Edit: PATCH master only.
  async function save() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/api/salary/employees/${employeeId}`, masterPayload());
        toast.success("Employee details saved ✓");
        onSaved();
        return;
      }
      const res = await api.post("/api/salary/employees/full", { employee: masterPayload(), contract: contractPayload() });
      if (res.ok && res.ready) {
        toast.success("Employee created and marked ready for payroll ✓");
      } else if (res.ok) {
        toast.warning(`Created, but still a draft — Salary needs: ${fmtReady(res.readyError)}`, { duration: 12000 });
      } else {
        const detail = res.detail ? ` — Salary says: ${fmtReady(res.detail)}` : "";
        toast.error(`Employee created, but salary wasn't set: ${res.error}${detail}`, { duration: 12000 });
      }
      onSaved();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!employeeId) return;
    if (!window.confirm(`Delete ${form.name || "this employee"} from Salary.dk? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await api.del(`/api/salary/employees/${employeeId}`);
      toast.success("Employee deleted ✓");
      onSaved();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setDeleting(false);
    }
  }

  // Edit only: create the employment + contract for a draft that has none yet.
  async function setupPayroll() {
    if (!employeeId) return;
    setSettingUp(true);
    try {
      const res = await api.post(`/api/salary/employees/${employeeId}/contract`, { contract: contractPayload() });
      if (res.ready) toast.success("Salary & contract saved — employee is ready for payroll ✓");
      else if (res.ok) toast.warning(`Contract saved, but still a draft — Salary needs: ${fmtReady(res.readyError)}`, { duration: 12000 });
      else {
        const detail = res.detail ? ` — Salary says: ${fmtReady(res.detail)}` : "";
        toast.error(`Contract rejected: ${res.error}${detail}`, { duration: 12000 });
      }
      onSaved();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setSettingUp(false);
    }
  }

  // Edit only: retry taking an already-complete employee out of draft.
  async function markReady() {
    if (!employeeId) return;
    setReadying(true);
    try {
      const res = await api.post(`/api/salary/employees/${employeeId}/ready`);
      if (res.ready) { toast.success("Employee marked ready for payroll ✓"); onSaved(); }
      else toast.warning(`Still a draft — Salary needs: ${fmtReady(res.readyError)}`, { duration: 12000 });
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setReadying(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{isEdit ? "Edit employee" : "New employee"}</CardTitle>
        <Button variant="ghost" size="sm" onClick={onClose}><X className="size-4" /></Button>
      </CardHeader>
      <CardContent className="grid gap-6">
        {loading ? (
          <div className="grid place-items-center py-8 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
        ) : (
          <>
            {aiEnabled && (
              <div>
                <input ref={fileRef} type="file" accept=".pdf,image/*" hidden onChange={onContract} />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={parsing}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-6 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-60"
                >
                  {parsing ? <Loader2 className="size-5 animate-spin" /> : <FileUp className="size-5" />}
                  <span className="text-sm font-medium">
                    {parsing ? "Claude is reading the contract…" : "Upload a contract to auto-fill everything (PDF, JPG, PNG)"}
                  </span>
                </button>
              </div>
            )}

            <Section title="Personal details" icon={<Sparkles className="size-3.5" />}>
              <FieldInput label="Name" value={form.name} onChange={set("name")} required />
              <FieldInput label="Email" value={form.email} onChange={set("email")} type="email" />
              <FieldInput label="Phone" value={form.phoneNumber} onChange={set("phoneNumber")} />
              <FieldInput label="CPR / National ID" value={form.nationalID} onChange={set("nationalID")} />
              <FieldInput label="Address" value={form.address} onChange={set("address")} />
              <div className="grid grid-cols-2 gap-3">
                <FieldInput label="Postal code" value={form.postalCode} onChange={set("postalCode")} />
                <FieldInput label="City" value={form.city} onChange={set("city")} />
              </div>
              <FieldInput label="Bank reg. no." value={form.bankRegistrationNumber} onChange={set("bankRegistrationNumber")} />
              <FieldInput label="Bank account no." value={form.bankAccountNumber} onChange={set("bankAccountNumber")} />
              <FieldSelect label="Affiliation" value={form.affiliationType} onChange={set("affiliationType")}
                options={AFFILIATIONS.map((a) => ({ value: a, label: a }))} />
              <FieldSelect label="Language" value={form.language} onChange={set("language")}
                options={[{ value: "da", label: "Danish" }, { value: "en", label: "English" }]} />
              {departments.length > 0 && (
                <FieldSelect label="Department" value={form.departmentID || "none"}
                  onChange={(v) => set("departmentID")(v === "none" ? "" : v)}
                  options={[{ value: "none", label: "None" }, ...departments.map((d) => ({ value: d.id, label: d.name ?? d.id }))]} />
              )}
            </Section>

            <div className="grid gap-2">
              <div className="text-sm font-medium">Payslip delivery</div>
              <div className="flex flex-wrap gap-4 text-sm">
                <Toggle label="mit.dk" checked={form.paySlipMitDK} onChange={(v) => set("paySlipMitDK")(v)} />
                <Toggle label="e-mail" checked={form.paySlipEMail} onChange={(v) => set("paySlipEMail")(v)} />
                <Toggle label="e-Boks" checked={form.paySlipEBoks} onChange={(v) => set("paySlipEBoks")(v)} />
                <Toggle label="SMS" checked={form.paySlipSMS} onChange={(v) => set("paySlipSMS")(v)} />
              </div>
              <p className="text-xs text-muted-foreground">Foreign account (udenlandsk konto) is off by default.</p>
            </div>

            <Section title="Salary & contract" icon={<Wallet className="size-3.5" />}>
              <FieldInput label="Job title" value={form.position} onChange={set("position")} />
              <div className="grid gap-1.5">
                <Label>Stilling (DISCO-08)</Label>
                <input
                  list="disco-list"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  placeholder="Search occupation code…"
                  defaultValue={discoCurrentLabel ? discoLabel(discoCurrentLabel) : ""}
                  onChange={(e) => {
                    const hit = discoOptions.find((p) => discoLabel(p) === e.target.value);
                    set("employmentPositionID")(hit?.id ?? "");
                  }}
                />
                <datalist id="disco-list">
                  {discoOptions.map((p) => <option key={p.id} value={discoLabel(p)} />)}
                </datalist>
              </div>
              <FieldInput label="Start date" value={form.startDate} onChange={set("startDate")} type="date" />
              <FieldSelect label="Production unit (Arbejdssted)" value={form.productionUnitID} onChange={set("productionUnitID")}
                options={(ref?.productionUnits ?? []).map((p) => ({ value: p.id, label: p.name ?? p.id }))} placeholder="—" />
              <FieldSelect label="Pay frequency (Udbetaling)" value={form.salaryCycleID} onChange={set("salaryCycleID")}
                options={(ref?.salaryCycles ?? []).map((c) => ({ value: c.id, label: c.frequency ?? c.id }))} placeholder="—" />
              <FieldSelect label="Salary type (Løntype)" value={form.salaryTypeID} onChange={set("salaryTypeID")}
                options={(ref?.salaryTypes ?? []).filter((s) => s.active !== false).map((s) => ({ value: s.id, label: s.title ?? s.name ?? s.id }))} placeholder="—" />
              <FieldInput label="Monthly salary (kr.)" value={form.monthlySalary} onChange={set("monthlySalary")} type="number" />
              <div className="grid grid-cols-2 gap-3">
                <FieldInput label="Weekly hours" value={form.weeklyHours} onChange={set("weeklyHours")} type="number" />
                <FieldInput label="Work days/week" value={form.workDaysPerWeek} onChange={set("workDaysPerWeek")} type="number" />
              </div>
              <FieldSelect label="Vacation type (Ferie)" value={form.leaveTypeID} onChange={set("leaveTypeID")}
                options={(ref?.leaveTypes ?? []).map((l) => ({ value: l.id, label: l.name ?? l.id }))} placeholder="—" />
              <FieldInput label="Vacation days/year" value={form.vacationDays} onChange={set("vacationDays")} type="number" />
              <FieldSelect label="Vacation scheme (Ferie type)" value={form.ferieType} onChange={set("ferieType")}
                options={[
                  { value: "Ferie med løn", label: "Ferie med løn (with allowance)" },
                  { value: "Ferie uden løn", label: "Ferie uden løn (unpaid)" },
                  { value: "Direktørløn", label: "Direktørløn (director)" },
                ]} placeholder="—" />
              <FieldInput label="Vacation allowance (%)" value={form.ferietillæg} onChange={set("ferietillæg")} type="number" />
              <div className="grid gap-1.5">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={form.storeBededagstillæg} onChange={(e) => set("storeBededagstillæg")(e.target.checked)} />
                  Store Bededagstillæg (Great Prayer Day supplement)
                </label>
              </div>
              <div className="grid gap-1.5">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={lunchOn} onChange={(e) => setLunchOn(e.target.checked)} />
                  Frokostordning (lunch scheme)
                </label>
                {lunchOn && (
                  <div className="flex gap-2">
                    <Input type="number" placeholder="Net deduction (kr.)"
                      value={form.lunchAmount} onChange={(e) => set("lunchAmount")(e.target.value)} />
                    <Select value={form.lunchType} onValueChange={set("lunchType")}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Lunch">per periode</SelectItem>
                        <SelectItem value="Lunch Daily">per day</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </Section>

            {isEdit ? (
              <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                <b>Save details</b> updates personal/payslip fields. <b>Save salary &amp; contract</b> writes a new
                contract version (salary, hours, vacation, lunch) on the existing employment.
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Created as an onboarding draft (employee → employment → contract). Weekend/holiday supplements and
                pension are handled separately in Salary.dk.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={saving || settingUp}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {isEdit ? "Save details" : "Create draft employee"}
              </Button>
              {isEdit && (
                <Button variant="secondary" onClick={setupPayroll} disabled={saving || settingUp || readying}>
                  {settingUp ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
                  Save salary &amp; contract
                </Button>
              )}
              {isEdit && (
                <Button variant="outline" onClick={markReady} disabled={saving || settingUp || readying}>
                  {readying ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  Mark ready for payroll
                </Button>
              )}
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              {isEdit && (
                <Button variant="ghost" className="ml-auto text-destructive hover:text-destructive"
                  onClick={remove} disabled={deleting || saving || settingUp}>
                  {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  Delete
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">{icon} {title}</div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function FieldInput({
  label, value, onChange, type = "text", required = false,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}{required && <span className="text-destructive"> *</span>}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function FieldSelect({
  label, value, onChange, options, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; placeholder?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
