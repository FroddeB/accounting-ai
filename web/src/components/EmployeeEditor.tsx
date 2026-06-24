import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FileUp, Loader2, Save, Sparkles, X } from "lucide-react";

export interface Department { id: string; name?: string }
interface Ref { id: string; name?: string; title?: string; class?: string; active?: boolean; frequency?: string }
interface Reference {
  salaryTypes: Ref[]; salaryCycles: Ref[]; leaveTypes: Ref[];
  productionUnits: Ref[]; departments: Department[];
}

interface Form {
  // master data
  name: string; email: string; phoneNumber: string; address: string;
  postalCode: string; city: string; nationalID: string;
  bankRegistrationNumber: string; bankAccountNumber: string;
  affiliationType: string; language: string; departmentID: string;
  // contract / salary (create only)
  position: string; startDate: string;
  productionUnitID: string; salaryCycleID: string;
  salaryTypeID: string; monthlySalary: string;
  weeklyHours: string; workDaysPerWeek: string;
  leaveTypeID: string; vacationDays: string;
  lunchAmount: string;
}

const EMPTY: Form = {
  name: "", email: "", phoneNumber: "", address: "", postalCode: "", city: "",
  nationalID: "", bankRegistrationNumber: "", bankAccountNumber: "",
  affiliationType: "Standard", language: "da", departmentID: "",
  position: "", startDate: "", productionUnitID: "", salaryCycleID: "",
  salaryTypeID: "", monthlySalary: "", weeklyHours: "", workDaysPerWeek: "",
  leaveTypeID: "", vacationDays: "", lunchAmount: "",
};

const AFFILIATIONS = ["Standard", "Director", "MajorityShareholder", "Freelancer"];

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
  const [loading, setLoading] = useState(isEdit);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ref, setRef] = useState<Reference | null>(null);
  const [lunchOn, setLunchOn] = useState(false);

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Load reference data (salary types, cycles, etc.) for the contract form (create only).
  useEffect(() => {
    if (isEdit) return;
    api.get("/api/salary/employees/reference").then((r: Reference) => {
      setRef(r);
      // Pre-select sensible defaults.
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
  }, [isEdit]);

  useEffect(() => {
    if (!isEdit) return;
    api.get(`/api/salary/employees/${employeeId}`)
      .then((e) => setForm((f) => ({
        ...f,
        name: e.name ?? "", email: e.email ?? "", phoneNumber: e.phoneNumber ?? "",
        address: e.address ?? "", postalCode: e.postalCode ?? "", city: e.city ?? "",
        nationalID: e.nationalID ?? "", bankRegistrationNumber: e.bankRegistrationNumber ?? "",
        bankAccountNumber: e.bankAccountNumber ?? "",
        affiliationType: e.affiliationType || "Standard", language: e.language || "da",
        departmentID: e.departmentID ?? "",
      })))
      .catch((err) => toast.error((err as ApiError).message))
      .finally(() => setLoading(false));
  }, [employeeId, isEdit]);

  async function onContract(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const { draft } = await api.upload("/api/salary/employees/parse-contract", file);
      const dept = draft.departmentName
        ? departments.find((d) => (d.name ?? "").toLowerCase().includes(String(draft.departmentName).toLowerCase()))
        : undefined;
      // Re-pick the monthly cycle if the contract specifies a different frequency.
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
        // contract terms
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

  async function save() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const master = {
        name: form.name, email: form.email, phoneNumber: form.phoneNumber, address: form.address,
        postalCode: form.postalCode, city: form.city, nationalID: form.nationalID,
        bankRegistrationNumber: form.bankRegistrationNumber, bankAccountNumber: form.bankAccountNumber,
        affiliationType: form.affiliationType, language: form.language, departmentID: form.departmentID,
      };
      if (isEdit) {
        await api.patch(`/api/salary/employees/${employeeId}`, master);
        toast.success("Employee updated ✓");
        onSaved();
        return;
      }
      const res = await api.post("/api/salary/employees/full", {
        employee: master,
        contract: {
          position: form.position, startDate: form.startDate,
          productionUnitID: form.productionUnitID, salaryCycleID: form.salaryCycleID,
          salaryTypeID: form.salaryTypeID, monthlySalary: form.monthlySalary,
          weeklyHours: form.weeklyHours, workDaysPerWeek: form.workDaysPerWeek,
          leaveTypeID: form.leaveTypeID, vacationDays: form.vacationDays,
          lunchAmount: lunchOn ? form.lunchAmount : "",
        },
      });
      if (res.ok) {
        toast.success("Draft employee created in Salary.dk ✓");
        onSaved();
      } else {
        // Employee created, but the salary/contract step failed.
        toast.error(`Employee created as a draft, but salary wasn't set: ${res.error}`);
        onSaved();
      }
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setSaving(false);
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
            {aiEnabled && !isEdit && (
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

            <Section title="Personal details">
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

            {!isEdit && (
              <Section title="Salary & contract">
                <FieldInput label="Position" value={form.position} onChange={set("position")} />
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

                <div className="grid gap-1.5">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={lunchOn} onChange={(e) => setLunchOn(e.target.checked)} />
                    Frokostordning (lunch scheme)
                  </label>
                  {lunchOn && (
                    <Input type="number" placeholder="Net deduction per period (kr.)"
                      value={form.lunchAmount} onChange={(e) => set("lunchAmount")(e.target.value)} />
                  )}
                </div>
              </Section>
            )}

            {!isEdit ? (
              <p className="text-xs text-muted-foreground">
                Created as an <b>onboarding draft</b> in Salary.dk (employee → employment → contract).
                Weekend/holiday supplements and pension are handled separately in Salary.dk.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Salary, hours and benefits are edited in Salary.dk.</p>
            )}

            <div className="flex gap-2">
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {isEdit ? "Save changes" : "Create draft employee"}
              </Button>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Sparkles className="size-3.5" /> {title}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
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
