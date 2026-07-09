import { supabase } from "../lib/supabase";
import {
  buildTeacherName,
  isTBC,
  resolveTeacherNameToCatalog,
  teacherDisplayNameFromRow,
} from "../lib/utils";
import type { EmploymentType, TeacherRow } from "../types";

export interface TeacherInput {
  id?: string;
  title?: string | null;
  family_name: string;
  other_name?: string | null;
  employment_type?: EmploymentType | null;
  academic_year: string;
}

export async function listTeachers(academicYear: string) {
  const { data, error } = await supabase
    .from("teachers")
    .select("*")
    .eq("academic_year", academicYear)
    .order("teacher_name");

  if (error) throw error;

  return (data ?? []) as TeacherRow[];
}

function normalizeTeacherEmployment(
  value: EmploymentType | string | null | undefined
): EmploymentType | null {
  const normalized = String(value ?? "").trim().toUpperCase();

  if (normalized === "FT" || normalized === "PT") {
    return normalized as EmploymentType;
  }

  return null;
}

/**
 * Lookup map for teacher_name / display name → catalogue employment (FT/PT).
 */
export function buildTeacherEmploymentLookup(
  teachers: TeacherRow[]
): Map<string, EmploymentType | null> {
  const lookup = new Map<string, EmploymentType | null>();

  for (const teacher of teachers) {
    const employment = normalizeTeacherEmployment(teacher.employment_type);
    const keys = new Set(
      [teacher.teacher_name, teacherDisplayNameFromRow(teacher)]
        .map((name) => String(name ?? "").trim())
        .filter(Boolean)
    );

    for (const key of keys) {
      lookup.set(key, employment);
    }
  }

  return lookup;
}

/**
 * Resolve a teacher's catalogue employment (FT/PT) by name.
 * teaching_status on a module (e.g. night class = PT) is unrelated.
 */
export function resolveTeacherEmploymentFromCatalog(
  teacherName: string,
  teachers: TeacherRow[]
): EmploymentType | null {
  const raw = String(teacherName ?? "").trim();

  if (!raw || isTBC(raw)) {
    return null;
  }

  const lookup = buildTeacherEmploymentLookup(teachers);
  const direct = lookup.get(raw);

  if (direct === "FT" || direct === "PT") {
    return direct;
  }

  const canonical = resolveTeacherNameToCatalog(raw, teachers);

  if (!canonical) {
    return direct ?? null;
  }

  return lookup.get(canonical) ?? null;
}

export async function resolveTeacherEmploymentForYear(params: {
  academicYear: string;
  teacherName: string;
  explicitEmployment?: EmploymentType | null;
}): Promise<EmploymentType | null> {
  const explicit = normalizeTeacherEmployment(params.explicitEmployment);

  if (explicit) {
    return explicit;
  }

  const teachers = await listTeachers(params.academicYear);

  return resolveTeacherEmploymentFromCatalog(params.teacherName, teachers);
}

export function canonicalizeTeacherNameForLoading(
  teacherName: string,
  teachers: TeacherRow[]
): string {
  const trimmed = String(teacherName ?? "").trim();

  if (!trimmed || isTBC(trimmed)) {
    return trimmed;
  }

  return resolveTeacherNameToCatalog(trimmed, teachers) ?? trimmed;
}

export function getTeacherCatalogDisplayName(teacher: TeacherRow): string {
  return teacherDisplayNameFromRow(teacher);
}

export async function canonicalizeTeacherNameForAcademicYear(params: {
  academicYear: string;
  teacherName: string | null | undefined;
  teachers?: TeacherRow[];
}): Promise<string | null> {
  const raw = String(params.teacherName ?? "").trim();

  if (!raw || isTBC(raw)) {
    return raw || null;
  }

  const teachers =
    params.teachers ?? (await listTeachers(params.academicYear));

  return canonicalizeTeacherNameForLoading(raw, teachers);
}

export async function upsertTeacher(input: TeacherInput) {
  const teacherName = buildTeacherName(
    input.title,
    input.family_name,
    input.other_name
  );

  if (!teacherName) {
    throw new Error("Teacher name is required");
  }

  if (isTBC(teacherName)) {
    throw new Error("TBC must not be stored in teachers table");
  }

  const payload = {
    title: input.title?.trim() || null,
    family_name: input.family_name.trim(),
    other_name: input.other_name?.trim() || null,
    teacher_name: teacherName,
    employment_type: input.employment_type || null,
    academic_year: input.academic_year,
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("teachers")
      .update(payload)
      .eq("id", input.id)
      .select()
      .single();

    if (error) throw error;

    return data as TeacherRow;
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("teachers")
    .select("*")
    .eq("academic_year", payload.academic_year)
    .eq("family_name", payload.family_name);

  if (existingError) {
    throw existingError;
  }

  const normalizedOtherName = payload.other_name ?? "";
  const existing = (existingRows ?? []).find((row) => {
    const rowOtherName = String(row.other_name ?? "").trim();
    return rowOtherName === normalizedOtherName;
  }) as TeacherRow | undefined;

  if (existing?.id) {
    const { data, error } = await supabase
      .from("teachers")
      .update(payload)
      .eq("id", existing.id)
      .select()
      .single();

    if (error) throw error;

    return data as TeacherRow;
  }

  const { data, error } = await supabase
    .from("teachers")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;

  return data as TeacherRow;
}

export async function deleteTeacher(id: string) {
  const { error } = await supabase.from("teachers").delete().eq("id", id);

  if (error) throw error;
}
