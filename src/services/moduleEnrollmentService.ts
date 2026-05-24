import { supabase } from "../lib/supabase";
import type { ModuleEnrollmentRow } from "../types";

export type { ModuleEnrollmentRow };

export interface ModuleEnrollmentInput {
  academic_year: string;
  module_code: string;
  module_term: string;
  programme_code: string;
  stream_code: string;
  expected_student_number: number;
  actual_student_number: number | null;
}

export function normalizeEnrollmentStream(value: string | null | undefined) {
  const text = String(value ?? "").trim();

  return text === "" ? "nil" : text;
}

export async function upsertModuleEnrollments(rows: ModuleEnrollmentInput[]) {
  if (rows.length === 0) return [];

  const payload = rows.map((row) => ({
    ...row,
    stream_code: normalizeEnrollmentStream(row.stream_code),
    expected_student_number: row.expected_student_number ?? 0,
    actual_student_number: row.actual_student_number ?? null,
  }));

  const { data, error } = await supabase
    .from("module_enrollment")
    .upsert(payload, {
      onConflict: "academic_year,module_code,programme_code,stream_code",
    })
    .select("*");

  if (error) throw error;

  return (data ?? []) as ModuleEnrollmentRow[];
}

export async function listModuleEnrollments(params: {
  academicYear: string;
  programmeCode?: string;
}) {
  let query = supabase
    .from("module_enrollment")
    .select("*")
    .eq("academic_year", params.academicYear)
    .order("module_term")
    .order("module_code");

  if (params.programmeCode) {
    query = query.eq("programme_code", params.programmeCode);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []) as ModuleEnrollmentRow[];
}
