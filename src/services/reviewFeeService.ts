import { normalizeAcademicYear } from "../lib/utils";
import { supabase } from "../lib/supabase";

export const PROGRAMME_FEE_TYPES = [
  "review",
  "registration",
  "annual_audit",
  "periodic",
] as const;

export type ProgrammeFeeType = (typeof PROGRAMME_FEE_TYPES)[number];

export type ProgrammeReviewFeeRow = {
  id: string;
  academic_year: string;
  programme_code: string;
  fee_type: ProgrammeFeeType;
  amount: number;
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

function normalizeFeeType(value: string): ProgrammeFeeType {
  const feeType = String(value ?? "").trim() as ProgrammeFeeType;
  if (!PROGRAMME_FEE_TYPES.includes(feeType)) {
    throw new Error("Invalid fee type.");
  }
  return feeType;
}

function parseAmount(value: number | string, field = "Amount") {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }
  return Math.round(n * 100) / 100;
}

export async function listProgrammeReviewFees(params: {
  academicYear: string;
  feeType?: ProgrammeFeeType;
}) {
  const year = normalizeAcademicYear(params.academicYear);
  let query = supabase
    .from("programme_review_fees")
    .select("*")
    .eq("academic_year", year)
    .order("programme_code");

  if (params.feeType) {
    query = query.eq("fee_type", normalizeFeeType(params.feeType));
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProgrammeReviewFeeRow[];
}

export async function upsertProgrammeReviewFee(params: {
  academicYear: string;
  programmeCode: string;
  feeType: ProgrammeFeeType;
  amount: number | string;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const payload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    programme_code: normalizeProgrammeCode(params.programmeCode),
    fee_type: normalizeFeeType(params.feeType),
    amount: parseAmount(params.amount, "Fee amount"),
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("programme_review_fees")
    .upsert(payload, {
      onConflict: "academic_year,programme_code,fee_type",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as ProgrammeReviewFeeRow;
}

export async function deleteProgrammeReviewFee(id: string) {
  const { error } = await supabase
    .from("programme_review_fees")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
