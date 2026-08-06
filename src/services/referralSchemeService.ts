import { normalizeAcademicYear } from "../lib/utils";
import { supabase } from "../lib/supabase";
import type { ModuleTerm } from "../types";

export type ProgrammeReferralSchemeRow = {
  id: string;
  academic_year: string;
  programme_code: string;
  module_term: ModuleTerm;
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

function normalizeModuleTerm(value: string): ModuleTerm {
  const term = String(value ?? "").trim();
  if (term === "Sep" || term === "Feb" || term === "Jun") return term;
  throw new Error("Term must be Sep, Feb, or Jun.");
}

function parseAmount(value: number | string, field = "Amount") {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }
  return Math.round(n * 100) / 100;
}

export async function listProgrammeReferralScheme(params: {
  academicYear: string;
  moduleTerm?: ModuleTerm | string;
}) {
  const year = normalizeAcademicYear(params.academicYear);
  let query = supabase
    .from("programme_referral_scheme")
    .select("*")
    .eq("academic_year", year)
    .order("programme_code");

  if (params.moduleTerm) {
    query = query.eq(
      "module_term",
      normalizeModuleTerm(String(params.moduleTerm))
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProgrammeReferralSchemeRow[];
}

export async function upsertProgrammeReferralScheme(params: {
  academicYear: string;
  programmeCode: string;
  moduleTerm: ModuleTerm | string;
  amount: number | string;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const payload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    programme_code: normalizeProgrammeCode(params.programmeCode),
    module_term: normalizeModuleTerm(String(params.moduleTerm)),
    amount: parseAmount(params.amount, "Referral scheme amount"),
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("programme_referral_scheme")
    .upsert(payload, {
      onConflict: "academic_year,programme_code,module_term",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as ProgrammeReferralSchemeRow;
}
