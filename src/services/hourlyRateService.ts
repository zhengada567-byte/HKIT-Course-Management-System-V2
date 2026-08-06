import { normalizeAcademicYear } from "../lib/utils";
import { normalizeProgrammeYear } from "../lib/programmeYear";
import { supabase } from "../lib/supabase";
import type { EmploymentType } from "../types";

export type ProgrammeHourlyRateRow = {
  id: string;
  academic_year: string;
  programme_code: string;
  programme_year: string;
  hourly_rate: number;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SpecialHourlyRateRow = {
  id: string;
  academic_year: string;
  rate_name: string;
  programme_code: string | null;
  hourly_rate: number;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TeacherHourlyRateRow = {
  id: string;
  academic_year: string;
  teacher_name: string;
  employment_type: string | null;
  hourly_rate: number;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

function parseRate(value: number | string) {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Hourly rate must be a non-negative number.");
  }
  return Math.round(n * 100) / 100;
}

export async function listProgrammeHourlyRates(academicYear: string) {
  const year = normalizeAcademicYear(academicYear);
  const { data, error } = await supabase
    .from("programme_hourly_rates")
    .select("*")
    .eq("academic_year", year)
    .order("programme_code")
    .order("programme_year");

  if (error) throw error;
  return (data ?? []) as ProgrammeHourlyRateRow[];
}

export async function upsertProgrammeHourlyRate(params: {
  id?: string;
  academicYear: string;
  programmeCode: string;
  programmeYear: string;
  hourlyRate: number | string;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const programmeYear =
    normalizeProgrammeYear(params.programmeYear) ??
    String(params.programmeYear ?? "").trim().toUpperCase();

  if (!["Y1", "Y2", "Y3", "Y4"].includes(programmeYear)) {
    throw new Error("Programme year must be Y1, Y2, Y3, or Y4.");
  }

  const payload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    programme_code: String(params.programmeCode ?? "").trim().toUpperCase(),
    programme_year: programmeYear,
    hourly_rate: parseRate(params.hourlyRate),
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  if (!payload.programme_code) {
    throw new Error("Programme code is required.");
  }

  if (params.id) {
    const { data, error } = await supabase
      .from("programme_hourly_rates")
      .update(payload)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as ProgrammeHourlyRateRow;
  }

  const { data, error } = await supabase
    .from("programme_hourly_rates")
    .upsert(payload, {
      onConflict: "academic_year,programme_code,programme_year",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as ProgrammeHourlyRateRow;
}

export async function deleteProgrammeHourlyRate(id: string) {
  const { error } = await supabase
    .from("programme_hourly_rates")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function listSpecialHourlyRates(academicYear: string) {
  const year = normalizeAcademicYear(academicYear);
  const { data, error } = await supabase
    .from("special_hourly_rates")
    .select("*")
    .eq("academic_year", year)
    .order("rate_name");

  if (error) throw error;
  return (data ?? []) as SpecialHourlyRateRow[];
}

export async function upsertSpecialHourlyRate(params: {
  id?: string;
  academicYear: string;
  rateName: string;
  programmeCode?: string | null;
  hourlyRate: number | string;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const rateName = String(params.rateName ?? "").trim();
  if (!rateName) throw new Error("Special rate name is required.");

  const payload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    rate_name: rateName,
    programme_code:
      String(params.programmeCode ?? "").trim().toUpperCase() || null,
    hourly_rate: parseRate(params.hourlyRate),
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  if (params.id) {
    const { data, error } = await supabase
      .from("special_hourly_rates")
      .update(payload)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as SpecialHourlyRateRow;
  }

  const { data, error } = await supabase
    .from("special_hourly_rates")
    .upsert(payload, { onConflict: "academic_year,rate_name" })
    .select("*")
    .single();

  if (error) throw error;
  return data as SpecialHourlyRateRow;
}

export async function deleteSpecialHourlyRate(id: string) {
  const { error } = await supabase
    .from("special_hourly_rates")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function listTeacherHourlyRates(academicYear: string) {
  const year = normalizeAcademicYear(academicYear);
  const { data, error } = await supabase
    .from("teacher_hourly_rates")
    .select("*")
    .eq("academic_year", year)
    .order("teacher_name");

  if (error) throw error;
  return (data ?? []) as TeacherHourlyRateRow[];
}

export async function upsertTeacherHourlyRate(params: {
  id?: string;
  academicYear: string;
  teacherName: string;
  employmentType?: EmploymentType | string | null;
  hourlyRate: number | string;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const teacherName = String(params.teacherName ?? "").trim();
  if (!teacherName) throw new Error("Teacher name is required.");

  const employment = String(params.employmentType ?? "")
    .trim()
    .toUpperCase();

  const payload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    teacher_name: teacherName,
    employment_type: employment === "FT" || employment === "PT" ? employment : null,
    hourly_rate: parseRate(params.hourlyRate),
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  if (params.id) {
    const { data, error } = await supabase
      .from("teacher_hourly_rates")
      .update(payload)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as TeacherHourlyRateRow;
  }

  const { data, error } = await supabase
    .from("teacher_hourly_rates")
    .upsert(payload, { onConflict: "academic_year,teacher_name" })
    .select("*")
    .single();

  if (error) throw error;
  return data as TeacherHourlyRateRow;
}

export async function deleteTeacherHourlyRate(id: string) {
  const { error } = await supabase
    .from("teacher_hourly_rates")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
