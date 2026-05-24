import { supabase } from "../lib/supabase";
import { formatAcademicYear } from "../lib/utils";
import { inferCurrentStudyTermFromDate } from "../pages/programme-leader/make-study-plan/helpers";

const CURRENT_ACADEMIC_YEAR_KEY = "current_academic_year";
const CURRENT_STUDY_TERM_KEY = "current_study_term";

async function syncStudyPlanSettings(params: {
  currentAcademicYear: string;
  currentStudyTerm: string;
}) {
  const rows = [
    {
      setting_key: "current_academic_year",
      setting_value: params.currentAcademicYear,
      updated_at: new Date().toISOString(),
    },
    {
      setting_key: "current_study_term",
      setting_value: params.currentStudyTerm,
      updated_at: new Date().toISOString(),
    },
  ];

  const { error } = await supabase
    .from("study_plan_settings")
    .upsert(rows, {
      onConflict: "setting_key",
    });

  if (error) {
    throw error;
  }
}

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

export async function getCurrentStudyTerm() {
  const { data, error } = await supabase
    .from("app_settings")
    .select("setting_value")
    .eq("setting_key", CURRENT_STUDY_TERM_KEY)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const stored = String(data?.setting_value ?? "").trim();

  if (stored) {
    return stored;
  }

  return inferCurrentStudyTermFromDate();
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

export async function setCurrentStudyTermValue(params: {
  studyTerm: string;
  updatedBy: string;
}) {
  const studyTerm = String(params.studyTerm ?? "").trim().toUpperCase();

  if (!/^T\d{4}[ABC]$/.test(studyTerm)) {
    throw new Error("Invalid study term format. Expected TYYYYA/B/C.");
  }

  const { error } = await supabase.from("app_settings").upsert(
    {
      setting_key: CURRENT_STUDY_TERM_KEY,
      setting_value: studyTerm,
      updated_by: params.updatedBy,
    },
    {
      onConflict: "setting_key",
    }
  );

  if (error) {
    throw error;
  }

  return studyTerm;
}

export async function saveAcademicYearAndTermSettings(params: {
  startYear: number;
  studyTerm: string;
  updatedBy: string;
}) {
  const academicYear = await setCurrentAcademicYearByStartYear(
    params.startYear,
    params.updatedBy
  );

  const studyTerm = await setCurrentStudyTermValue({
    studyTerm: params.studyTerm,
    updatedBy: params.updatedBy,
  });

  await syncStudyPlanSettings({
    currentAcademicYear: academicYear,
    currentStudyTerm: studyTerm,
  });

  return {
    academicYear,
    studyTerm,
  };
}
