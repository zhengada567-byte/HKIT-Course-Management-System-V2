import { normalizeAcademicYear } from "../lib/utils";
import { supabase } from "../lib/supabase";
import type { ModuleTerm } from "../types";

/** Scholarship-style fixed rate: HK$ per supervised student per academic year. */
export const PT_SUPERVISOR_AMOUNT_PER_STUDENT = 2500;

export type PtSupervisorFeeRow = {
  id: string;
  academic_year: string;
  programme_code: string;
  module_term: ModuleTerm;
  supervisor_name: string;
  student_count: number;
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

function normalizeModuleTerm(value: string): ModuleTerm {
  const term = String(value ?? "").trim();
  if (term === "Sep" || term === "Feb" || term === "Jun") return term;
  throw new Error("Term must be Sep, Feb, or Jun.");
}

function parseCount(value: number | string) {
  const n =
    typeof value === "number" ? value : Number(String(value ?? "").trim() || 0);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Student count must be a non-negative number.");
  }
  return Math.max(0, Math.round(n));
}

export function calculatePtSupervisorTotal(params: {
  studentCount: number;
  amountPerStudent?: number;
}) {
  const count = Math.max(0, Math.round(Number(params.studentCount) || 0));
  const rate =
    params.amountPerStudent != null && Number.isFinite(params.amountPerStudent)
      ? Math.max(0, Number(params.amountPerStudent))
      : PT_SUPERVISOR_AMOUNT_PER_STUDENT;
  return Math.round(count * rate * 100) / 100;
}

export async function listPtSupervisorFees(params: {
  academicYear: string;
  moduleTerm?: ModuleTerm | string;
  programmeCode?: string;
}) {
  const year = normalizeAcademicYear(params.academicYear);
  let query = supabase
    .from("pt_supervisor_fees")
    .select("*")
    .eq("academic_year", year)
    .order("programme_code")
    .order("module_term")
    .order("supervisor_name");

  if (params.moduleTerm) {
    query = query.eq(
      "module_term",
      normalizeModuleTerm(String(params.moduleTerm))
    );
  }
  if (params.programmeCode) {
    query = query.eq(
      "programme_code",
      normalizeProgrammeCode(params.programmeCode)
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as PtSupervisorFeeRow[];
}

export async function upsertPtSupervisorFee(params: {
  id?: string;
  academicYear: string;
  programmeCode: string;
  moduleTerm: ModuleTerm | string;
  supervisorName: string;
  studentCount: number | string;
  amountPerStudent?: number | string;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const supervisorName = String(params.supervisorName ?? "").trim();
  if (!supervisorName) throw new Error("Supervisor name is required.");

  const studentCount = parseCount(params.studentCount);
  const amountPerStudent =
    params.amountPerStudent != null &&
    String(params.amountPerStudent).trim() !== ""
      ? Number(params.amountPerStudent)
      : PT_SUPERVISOR_AMOUNT_PER_STUDENT;
  if (!Number.isFinite(amountPerStudent) || amountPerStudent < 0) {
    throw new Error("Amount per student must be a non-negative number.");
  }
  const rate = Math.round(amountPerStudent * 100) / 100;
  const totalAmount = calculatePtSupervisorTotal({
    studentCount,
    amountPerStudent: rate,
  });

  const payload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    programme_code: normalizeProgrammeCode(params.programmeCode),
    module_term: normalizeModuleTerm(String(params.moduleTerm)),
    supervisor_name: supervisorName,
    student_count: studentCount,
    amount_per_student: rate,
    total_amount: totalAmount,
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  if (params.id) {
    const { data, error } = await supabase
      .from("pt_supervisor_fees")
      .update(payload)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as PtSupervisorFeeRow;
  }

  const { data, error } = await supabase
    .from("pt_supervisor_fees")
    .upsert(payload, {
      onConflict:
        "academic_year,programme_code,module_term,supervisor_name",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as PtSupervisorFeeRow;
}

export async function deletePtSupervisorFee(id: string) {
  const { error } = await supabase
    .from("pt_supervisor_fees")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
