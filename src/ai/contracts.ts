import type Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { getClient, mediaBlock } from "./anthropic.js";

/**
 * Claude-powered employment-contract reading.
 *
 * Given an uploaded employment contract (PDF/image), Claude extracts the fields needed
 * to draft a new Salary.dk employee — both the master record AND the contract terms
 * (salary, hours, vacation, lunch scheme). The human reviews everything, maps the pay
 * components to the company's salary types, and saves. Per-occurrence supplements
 * (e.g. weekend bonus) and pension are intentionally NOT extracted — handled elsewhere.
 */

export interface ContractExtraction {
  name: string | null;
  email: string | null;
  phoneNumber: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  nationalID: string | null; // CPR
  bankRegistrationNumber: string | null;
  bankAccountNumber: string | null;
  affiliationType: "Standard" | "Director" | "MajorityShareholder" | "Freelancer" | null;
  language: "da" | "en" | null;
  jobTitle: string | null;
  departmentName: string | null; // free-text hint; the user maps it to a department
  startDate: string | null;      // ISO 8601 if determinable
  // Contract / remuneration terms
  monthlySalary: number | null;     // base monthly salary (Grundløn), DKK
  payFrequency: "Monthly" | "BiWeekly" | "Weekly" | null;
  weeklyHours: number | null;       // e.g. 37
  workDaysPerWeek: number | null;   // e.g. 5
  isFullTime: boolean | null;       // Fastlønnet (fuldtid)
  vacationDaysPerYear: number | null; // 5 weeks → 25
  hasLunchScheme: boolean;          // frokostordning mentioned
  lunchNetDeductionPerPeriod: number | null; // DKK net deduction per period, if stated
  summary: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: ["string", "null"], description: "Full legal name of the employee" },
    email: { type: ["string", "null"] },
    phoneNumber: { type: ["string", "null"], description: "Digits only if possible" },
    address: { type: ["string", "null"], description: "Street and number" },
    postalCode: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
    nationalID: { type: ["string", "null"], description: "Danish CPR number if present (DDMMYY-XXXX)" },
    bankRegistrationNumber: { type: ["string", "null"], description: "4-digit bank reg. number" },
    bankAccountNumber: { type: ["string", "null"] },
    affiliationType: {
      type: ["string", "null"],
      enum: ["Standard", "Director", "MajorityShareholder", "Freelancer", null],
      description: "Standard for ordinary employees; Director/MajorityShareholder for owners; Freelancer for contractors",
    },
    language: { type: ["string", "null"], enum: ["da", "en", null], description: "Language of the contract" },
    jobTitle: { type: ["string", "null"] },
    departmentName: { type: ["string", "null"], description: "Department/team named in the contract, if any" },
    startDate: { type: ["string", "null"], description: "Employment start date, ISO 8601 (YYYY-MM-DD)" },
    monthlySalary: { type: ["number", "null"], description: "Base monthly gross salary (Grundløn) in DKK, e.g. 50000" },
    payFrequency: { type: ["string", "null"], enum: ["Monthly", "BiWeekly", "Weekly", null], description: "How often salary is paid" },
    weeklyHours: { type: ["number", "null"], description: "Average weekly working hours, e.g. 37" },
    workDaysPerWeek: { type: ["number", "null"], description: "Number of work days in a normal week, e.g. 5" },
    isFullTime: { type: ["boolean", "null"], description: "True if the contract is full-time (fuldtid)" },
    vacationDaysPerYear: { type: ["number", "null"], description: "Paid vacation days per year. Convert weeks to days: 5 weeks = 25 days" },
    hasLunchScheme: { type: "boolean", description: "True if a lunch scheme (frokostordning) is mentioned" },
    lunchNetDeductionPerPeriod: { type: ["number", "null"], description: "Employee net deduction per period for the lunch scheme in DKK, only if explicitly stated" },
    summary: { type: "string", description: "One-line human summary of the contract" },
  },
  required: [
    "name", "email", "phoneNumber", "address", "postalCode", "city", "nationalID",
    "bankRegistrationNumber", "bankAccountNumber", "affiliationType", "language",
    "jobTitle", "departmentName", "startDate", "monthlySalary", "payFrequency",
    "weeklyHours", "workDaysPerWeek", "isFullTime", "vacationDaysPerYear",
    "hasLunchScheme", "lunchNetDeductionPerPeriod", "summary",
  ],
} as const;

const SYSTEM = `You are an HR assistant for a Danish company that runs payroll in Salary.dk.
You receive an employment contract (often in Danish) and must extract the fields needed to
create the employee's master record. Extract exactly what the document states — never invent a
CPR number, bank details or address. Leave a field null if it isn't in the document.
Danish contracts: "Tiltrædelse"/"Startdato" = start date; "Reg.nr." + "Kontonr." = bank reg. +
account number; CPR is the national ID. For pay: "Lønnen udgør … kr. pr. måned" = monthlySalary
and payFrequency Monthly; "37 timer om ugen" = weeklyHours 37; "5 ugers ferie" = vacationDaysPerYear
25 (5 weeks × 5 days); a "frokostordning" sets hasLunchScheme true (only fill
lunchNetDeductionPerPeriod if an explicit kr. amount is given). Do NOT extract weekend/holiday
supplements or pension — those are handled separately.`;

export async function extractEmployeeFromContract(
  bytes: Buffer,
  mimetype: string,
): Promise<ContractExtraction> {
  const anthropic = getClient();
  const res = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 2048,
    system: SYSTEM,
    tools: [
      {
        name: "record_employee",
        description: "Record the employee master-data fields extracted from the contract.",
        input_schema: SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "record_employee" },
    messages: [
      {
        role: "user",
        content: [
          mediaBlock(bytes, mimetype),
          { type: "text", text: "Extract the employee details from this employment contract." },
        ],
      },
    ],
  });

  const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("Claude did not return structured contract data");
  return toolUse.input as ContractExtraction;
}
