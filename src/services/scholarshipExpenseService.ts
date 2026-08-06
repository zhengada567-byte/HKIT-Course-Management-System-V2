import { normalizeAcademicYear } from "../lib/utils";
import { supabase } from "../lib/supabase";

/** Programmes currently eligible for HKIT DAE → HD scholarship. */
export const SCHOLARSHIP_PROGRAMME_CODES = ["HDBA", "HDHC", "HDC"] as const;

export type ScholarshipProgrammeCode =
  (typeof SCHOLARSHIP_PROGRAMME_CODES)[number];

/** HK$ per HKIT DAE student per academic year. */
export const SCHOLARSHIP_AMOUNT_PER_STUDENT = 10000;

export type ProgrammeScholarshipExpenseRow = {
  id: string;
  academic_year: string;
  programme_code: string;
  y1_count: number;
  y2_count: number;
  amount_per_student: number;
  total_amount: number;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

function normalizeProgrammeCode(value: string) {
  const code = String(value ?? "").trim().toUpperCase();
  if (!code) throw new Error("Programme code is required.");
  return code;
}

function parseCount(value: number | string, field: string) {
  const n =
    typeof value === "number" ? value : Number(String(value ?? "").trim() || 0);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }
  return Math.max(0, Math.round(n));
}

export function isScholarshipProgramme(programmeCode: string) {
  const code = String(programmeCode ?? "").trim().toUpperCase();
  return (SCHOLARSHIP_PROGRAMME_CODES as readonly string[]).includes(code);
}

export function calculateScholarshipTotal(params: {
  y1Count: number;
  y2Count: number;
  amountPerStudent?: number;
}) {
  const y1 = Math.max(0, Math.round(Number(params.y1Count) || 0));
  const y2 = Math.max(0, Math.round(Number(params.y2Count) || 0));
  const rate =
    params.amountPerStudent != null && Number.isFinite(params.amountPerStudent)
      ? Math.max(0, Number(params.amountPerStudent))
      : SCHOLARSHIP_AMOUNT_PER_STUDENT;
  return Math.round((y1 + y2) * rate * 100) / 100;
}

export async function listProgrammeScholarshipExpenses(academicYear: string) {
  const year = normalizeAcademicYear(academicYear);
  const { data, error } = await supabase
    .from("programme_scholarship_expenses")
    .select("*")
    .eq("academic_year", year)
    .order("programme_code");

  if (error) throw error;
  return (data ?? []) as ProgrammeScholarshipExpenseRow[];
}

export async function upsertProgrammeScholarshipExpense(params: {
  academicYear: string;
  programmeCode: string;
  y1Count: number | string;
  y2Count: number | string;
  amountPerStudent?: number | string;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const programmeCode = normalizeProgrammeCode(params.programmeCode);
  if (!isScholarshipProgramme(programmeCode)) {
    throw new Error(
      `Scholarship expenses currently apply to ${SCHOLARSHIP_PROGRAMME_CODES.join(", ")} only.`
    );
  }

  const y1Count = parseCount(params.y1Count, "Y1 count");
  const y2Count = parseCount(params.y2Count, "Y2 count");
  const amountPerStudent =
    params.amountPerStudent != null && String(params.amountPerStudent).trim() !== ""
      ? Number(params.amountPerStudent)
      : SCHOLARSHIP_AMOUNT_PER_STUDENT;
  if (!Number.isFinite(amountPerStudent) || amountPerStudent < 0) {
    throw new Error("Amount per student must be a non-negative number.");
  }
  const rate = Math.round(amountPerStudent * 100) / 100;
  const totalAmount = calculateScholarshipTotal({
    y1Count,
    y2Count,
    amountPerStudent: rate,
  });

  const payload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    programme_code: programmeCode,
    y1_count: y1Count,
    y2_count: y2Count,
    amount_per_student: rate,
    total_amount: totalAmount,
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("programme_scholarship_expenses")
    .upsert(payload, { onConflict: "academic_year,programme_code" })
    .select("*")
    .single();

  if (error) throw error;
  return data as ProgrammeScholarshipExpenseRow;
}
