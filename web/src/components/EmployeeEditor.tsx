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

interface Form {
  name: string;
  email: string;
  phoneNumber: string;
  address: string;
  postalCode: string;
  city: string;
  nationalID: string;
  bankRegistrationNumber: string;
  bankAccountNumber: string;
  affiliationType: string;
  language: string;
  departmentID: string;
}

const EMPTY: Form = {
  name: "", email: "", phoneNumber: "", address: "", postalCode: "", city: "",
  nationalID: "", bankRegistrationNumber: "", bankAccountNumber: "",
  affiliationType: "Standard", language: "da", departmentID: "",
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
  // Fields Claude reads but we don't write — shown for reference.
  const [hint, setHint] = useState<{ jobTitle?: string | null; startDate?: string | null; salary?: string | null; summary?: string } | null>(null);

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!isEdit) return;
    api.get(`/api/salary/employees/${employeeId}`)
      .then((e) => setForm({
        name: e.name ?? "", email: e.email ?? "", phoneNumber: e.phoneNumber ?? "",
        address: e.address ?? "", postalCode: e.postalCode ?? "", city: e.city ?? "",
        nationalID: e.nationalID ?? "", bankRegistrationNumber: e.bankRegistrationNumber ?? "",
        bankAccountNumber: e.bankAccountNumber ?? "",
        affiliationType: e.affiliationType || "Standard", language: e.language || "da",
        departmentID: e.departmentID ?? "",
      }))
      .catch((err) => toast.error((err as ApiError).message))
      .finally(() => setLoading(false));
  }, [employeeId, isEdit]);

  async function onContract(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const { draft } = await api.upload("/api/salary/employees/parse-contract", file);
      // Match the contract's department name to a known department, if possible.
      const dept = draft.departmentName
        ? departments.find((d) => (d.name ?? "").toLowerCase().includes(String(draft.departmentName).toLowerCase()))
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
      }));
      setHint({ jobTitle: draft.jobTitle, startDate: draft.startDate, salary: draft.salaryDescription, summary: draft.summary });
      toast.success("Contract read — review the fields below before saving");
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
      if (isEdit) await api.patch(`/api/salary/employees/${employeeId}`, form);
      else await api.post("/api/salary/employees", form);
      toast.success(isEdit ? "Employee updated ✓" : "Draft employee created in Salary.dk ✓");
      onSaved();
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
      <CardContent className="grid gap-5">
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
                    {parsing ? "Claude is reading the contract…" : "Upload a contract to auto-fill (PDF, JPG, PNG)"}
                  </span>
                </button>
              </div>
            )}

            {hint && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="mb-1 flex items-center gap-1.5 font-medium"><Sparkles className="size-3.5" /> From the contract</div>
                <p className="text-muted-foreground">{hint.summary}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                  {hint.jobTitle && <span><b className="font-medium text-foreground">Title:</b> {hint.jobTitle}</span>}
                  {hint.startDate && <span><b className="font-medium text-foreground">Start:</b> {hint.startDate}</span>}
                  {hint.salary && <span><b className="font-medium text-foreground">Pay:</b> {hint.salary} <i>(set in Salary.dk)</i></span>}
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
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

              <div className="grid gap-1.5">
                <Label>Affiliation</Label>
                <Select value={form.affiliationType} onValueChange={set("affiliationType")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AFFILIATIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label>Language</Label>
                <Select value={form.language} onValueChange={set("language")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="da">Danish</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {departments.length > 0 && (
                <div className="grid gap-1.5">
                  <Label>Department</Label>
                  <Select value={form.departmentID || "none"} onValueChange={(v) => set("departmentID")(v === "none" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name ?? d.id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {!isEdit && (
              <p className="text-xs text-muted-foreground">
                New employees are created as an <b>onboarding draft</b> in Salary.dk — they won't enter a
                payroll run until onboarding is completed there.
              </p>
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
