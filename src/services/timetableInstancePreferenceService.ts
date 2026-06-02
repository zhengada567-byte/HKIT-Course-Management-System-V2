import { supabase } from "../lib/supabase";

export interface TimetableInstancePreferenceRow {
  id: string;
  academic_year: string;
  module_instance_code: string;
  preferred_start_time: string | null; // HH:MM:SS
  created_at: string;
  updated_at: string;
}

export async function listInstancePreferences(params: {
  academicYear: string;
  moduleInstanceCodes: string[];
}): Promise<TimetableInstancePreferenceRow[]> {
  if (params.moduleInstanceCodes.length === 0) return [];

  const { data, error } = await supabase
    .from("timetable_instance_preferences")
    .select("*")
    .eq("academic_year", params.academicYear)
    .in("module_instance_code", params.moduleInstanceCodes);

  // If migration 017 isn't applied yet, PostgREST returns 404.
  if (error) {
    if ((error as any)?.status === 404) return [];
    throw error;
  }
  return (data ?? []) as TimetableInstancePreferenceRow[];
}

export async function upsertInstancePreferences(params: {
  academicYear: string;
  rows: Array<{
    module_instance_code: string;
    preferred_start_time: string | null; // HH:MM
  }>;
}) {
  if (params.rows.length === 0) return;

  const payload = params.rows.map((row) => ({
    academic_year: params.academicYear,
    module_instance_code: row.module_instance_code,
    preferred_start_time: row.preferred_start_time,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("timetable_instance_preferences")
    .upsert(payload, { onConflict: "academic_year,module_instance_code" });

  if (error) throw error;
}

