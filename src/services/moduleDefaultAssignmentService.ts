import { supabase } from "../lib/supabase";
import type {
  ModuleDefaultAssignmentRow,
  TeachingMode,
  TeachingStatus,
} from "../types";

export interface ModuleDefaultAssignmentInput {
  academic_year: string;
  module_code: string;
  module_term: string;
  programme_code: string;
  stream_code: string;
  teacher_name: string | null;
  teacher_title: string | null;
  teacher_family_name: string | null;
  teacher_other_name: string | null;
  teaching_status: TeachingStatus | null;
  mode: TeachingMode;
}

export function normalizeDefaultAssignmentStream(
  value: string | null | undefined
) {
  const text = String(value ?? "").trim();

  return text === "" ? "nil" : text;
}

export function normalizeTeachingStatus(value: string | null | undefined) {
  const text = String(value ?? "").trim().toUpperCase();

  if (text === "FT" || text === "PT") return text as TeachingStatus;

  return null;
}

export function parseTeacherName(rawName: string | null | undefined) {
  const teacherName = String(rawName ?? "").trim();

  if (!teacherName || teacherName.toLowerCase() === "tbc") {
    return {
      teacher_name: teacherName || "TBC",
      teacher_title: null,
      teacher_family_name: null,
      teacher_other_name: null,
    };
  }

  const parts = teacherName.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return {
      teacher_name: teacherName,
      teacher_title: null,
      teacher_family_name: parts[0],
      teacher_other_name: null,
    };
  }

  const title = parts[0].replace(/\./g, "");
  const familyName = parts[parts.length - 1];
  const otherName = parts.slice(1, -1).join(" ") || null;

  return {
    teacher_name: teacherName,
    teacher_title: title,
    teacher_family_name: familyName,
    teacher_other_name: otherName,
  };
}

export async function upsertModuleDefaultAssignments(
  rows: ModuleDefaultAssignmentInput[]
) {
  if (rows.length === 0) return [];

  const payload = rows.map((row) => ({
    ...row,
    stream_code: normalizeDefaultAssignmentStream(row.stream_code),
    mode: row.mode || "Night",
  }));

  const { data, error } = await supabase
    .from("module_default_assignments")
    .upsert(payload, {
      onConflict: "academic_year,module_code,programme_code,stream_code",
    })
    .select("*");

  if (error) throw error;

  return (data ?? []) as ModuleDefaultAssignmentRow[];
}

export async function listModuleDefaultAssignments(params: {
  academicYear: string;
  programmeCode?: string;
}) {
  let query = supabase
    .from("module_default_assignments")
    .select("*")
    .eq("academic_year", params.academicYear)
    .order("module_term")
    .order("module_code");

  if (params.programmeCode) {
    query = query.eq("programme_code", params.programmeCode);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []) as ModuleDefaultAssignmentRow[];
}
