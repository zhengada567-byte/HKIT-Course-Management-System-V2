import { supabase } from "../lib/supabase";
import { normalizeAcademicYear } from "../lib/utils";

export type TeacherAvailabilityPeriod = "AM" | "PM" | "EVENING";

export interface TimetableTeacherNotAvailableRow {
  id: string;
  academic_year: string;
  teacher_name: string;
  weekday: number; // 1..6 (Mon..Sat)
  period: TeacherAvailabilityPeriod;
  created_at: string;
  updated_at: string;
}

export interface TimetableTeacherAvailabilitySavedRow {
  academic_year: string;
  teacher_name: string;
  saved_at: string;
  updated_at: string;
}

function isMissingAvailabilityTableError(error: { status?: number }) {
  return error?.status === 404;
}

export async function listTeacherNotAvailable(params: {
  academicYear: string;
  teacherName: string;
}): Promise<TimetableTeacherNotAvailableRow[]> {
  const { data, error } = await supabase
    .from("timetable_teacher_not_available")
    .select("*")
    .eq("academic_year", params.academicYear)
    .eq("teacher_name", params.teacherName)
    .order("weekday", { ascending: true })
    .order("period", { ascending: true });

  // If migration 016 isn't applied yet, PostgREST returns 404.
  // Treat it as "no availability data yet" so the page can still load.
  if (error) {
    if (isMissingAvailabilityTableError(error as { status?: number })) return [];
    throw error;
  }
  return (data ?? []) as TimetableTeacherNotAvailableRow[];
}

export async function listTeacherNotAvailableForTeachers(params: {
  academicYear: string;
  teacherNames: string[];
}): Promise<TimetableTeacherNotAvailableRow[]> {
  const names = params.teacherNames.map((t) => String(t ?? "").trim()).filter(Boolean);
  if (names.length === 0) return [];

  const { data, error } = await supabase
    .from("timetable_teacher_not_available")
    .select("*")
    .eq("academic_year", params.academicYear)
    .in("teacher_name", names);

  if (error) {
    if (isMissingAvailabilityTableError(error as { status?: number })) return [];
    throw error;
  }
  return (data ?? []) as TimetableTeacherNotAvailableRow[];
}

export async function listTeacherAvailabilitySaved(params: {
  academicYear: string;
  teacherNames: string[];
}): Promise<TimetableTeacherAvailabilitySavedRow[]> {
  const names = params.teacherNames.map((t) => String(t ?? "").trim()).filter(Boolean);
  if (names.length === 0) return [];

  const year = normalizeAcademicYear(params.academicYear);
  const { data, error } = await supabase
    .from("timetable_teacher_availability_saved")
    .select("academic_year, teacher_name, saved_at, updated_at")
    .eq("academic_year", year)
    .in("teacher_name", names);

  if (error) {
    if (isMissingAvailabilityTableError(error as { status?: number })) return [];
    throw error;
  }

  return (data ?? []) as TimetableTeacherAvailabilitySavedRow[];
}

export async function acknowledgeTeacherAvailabilitySaved(params: {
  academicYear: string;
  teacherName: string;
}) {
  const teacherName = String(params.teacherName ?? "").trim();
  if (!teacherName) return;

  const now = new Date().toISOString();
  const { error } = await supabase.from("timetable_teacher_availability_saved").upsert(
    {
      academic_year: normalizeAcademicYear(params.academicYear),
      teacher_name: teacherName,
      saved_at: now,
      updated_at: now,
    },
    { onConflict: "academic_year,teacher_name" }
  );

  if (error) {
    if (isMissingAvailabilityTableError(error as { status?: number })) return;
    throw error;
  }
}

export async function setTeacherNotAvailable(params: {
  academicYear: string;
  teacherName: string;
  weekday: 1 | 2 | 3 | 4 | 5 | 6;
  period: TeacherAvailabilityPeriod;
  notAvailable: boolean;
}) {
  if (params.notAvailable) {
    const { error } = await supabase
      .from("timetable_teacher_not_available")
      .upsert(
        {
          academic_year: params.academicYear,
          teacher_name: params.teacherName,
          weekday: params.weekday,
          period: params.period,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "academic_year,teacher_name,weekday,period" }
      );
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("timetable_teacher_not_available")
    .delete()
    .eq("academic_year", params.academicYear)
    .eq("teacher_name", params.teacherName)
    .eq("weekday", params.weekday)
    .eq("period", params.period);

  if (error) throw error;
}

