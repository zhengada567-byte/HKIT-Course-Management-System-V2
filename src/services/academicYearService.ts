import { supabase } from "../lib/supabase";
import { formatAcademicYear } from "../lib/utils";

const CURRENT_ACADEMIC_YEAR_KEY = "current_academic_year";

export async function getCurrentAcademicYear() {
  const { data, error } = await supabase
    .from("app_settings")
    .select("setting_value")
    .eq("setting_key", CURRENT_ACADEMIC_YEAR_KEY)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.setting_value || "2026/2027";
}

export async function setCurrentAcademicYearByStartYear(
  startYear: number,
  updatedBy: string
) {
  const academicYear = formatAcademicYear(startYear);

  const { error } = await supabase.from("app_settings").upsert(
    {
      setting_key: CURRENT_ACADEMIC_YEAR_KEY,
      setting_value: academicYear,
      updated_by: updatedBy,
    },
    {
      onConflict: "setting_key",
    }
  );

  if (error) {
    throw error;
  }

  return academicYear;
}

export async function setCurrentAcademicYearValue(params: {
  academicYear: string;
  updatedBy: string;
}) {
  const { error } = await supabase.from("app_settings").upsert(
    {
      setting_key: CURRENT_ACADEMIC_YEAR_KEY,
      setting_value: params.academicYear,
      updated_by: params.updatedBy,
    },
    {
      onConflict: "setting_key",
    }
  );

  if (error) {
    throw error;
  }
}
