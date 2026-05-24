import { supabase } from "../lib/supabase";
import { buildTeacherName } from "../lib/utils";
import type { ApprovedLoadingRow } from "../types";

export interface ApprovedLoadingInput {
  teacher_title?: string | null;
  teacher_family_name: string;
  teacher_other_name?: string | null;
  academic_year: string;
  sep_term_approved_max_loading?: number | null;
  feb_term_approved_max_loading?: number | null;
  jun_term_approved_max_loading?: number | null;
  updated_by?: string | null;
}

export async function listApprovedLoading(academicYear: string) {
  const { data, error } = await supabase
    .from("approved_loading")
    .select("*")
    .eq("academic_year", academicYear)
    .order("teacher_name");

  if (error) throw error;

  return (data ?? []) as ApprovedLoadingRow[];
}

export async function upsertApprovedLoading(input: ApprovedLoadingInput) {
  const teacherName = buildTeacherName(
    input.teacher_title,
    input.teacher_family_name,
    input.teacher_other_name
  );

  if (!teacherName) {
    throw new Error("Teacher name is required.");
  }

  const payload = {
    teacher_title: input.teacher_title?.trim() || null,
    teacher_family_name: input.teacher_family_name.trim(),
    teacher_other_name: input.teacher_other_name?.trim() || null,
    teacher_name: teacherName,
    academic_year: input.academic_year,
    sep_term_approved_max_loading:
      input.sep_term_approved_max_loading ?? 0,
    feb_term_approved_max_loading:
      input.feb_term_approved_max_loading ?? 0,
    jun_term_approved_max_loading:
      input.jun_term_approved_max_loading ?? 0,
    confirmed: false,
    confirmed_at: null,
    updated_by: input.updated_by ?? null,
  };

  const { data, error } = await supabase
    .from("approved_loading")
    .upsert(payload, {
      onConflict: "teacher_name,academic_year",
    })
    .select("*")
    .single();

  if (error) throw error;

  return data as ApprovedLoadingRow;
}

export async function updateApprovedLoadingValues(params: {
  id: string;
  sep: number;
  feb: number;
  jun: number;
  updatedBy: string;
}) {
  const { data, error } = await supabase
    .from("approved_loading")
    .update({
      sep_term_approved_max_loading: params.sep,
      feb_term_approved_max_loading: params.feb,
      jun_term_approved_max_loading: params.jun,
      confirmed: false,
      confirmed_at: null,
      updated_by: params.updatedBy,
    })
    .eq("id", params.id)
    .select("*")
    .single();

  if (error) throw error;

  return data as ApprovedLoadingRow;
}

export async function confirmApprovedLoading(params: {
  academicYear: string;
  updatedBy: string;
}) {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("approved_loading")
    .update({
      confirmed: true,
      confirmed_at: now,
      updated_by: params.updatedBy,
    })
    .eq("academic_year", params.academicYear)
    .select("*");

  if (error) throw error;

  return (data ?? []) as ApprovedLoadingRow[];
}

export function calculateAnnualApprovedLoading(row: ApprovedLoadingRow) {
  return (
    Number(row.sep_term_approved_max_loading ?? 0) +
    Number(row.feb_term_approved_max_loading ?? 0) +
    Number(row.jun_term_approved_max_loading ?? 0)
  );
}

export function isApprovedLoadingConfirmed(rows: ApprovedLoadingRow[]) {
  return rows.length > 0 && rows.every((row) => row.confirmed);
}
