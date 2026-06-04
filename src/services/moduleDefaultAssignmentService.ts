import { buildTeacherName } from "../lib/utils";
import { supabase } from "../lib/supabase";
import { listModules } from "./moduleService";
import type {
  ModuleDefaultAssignmentRow,
  ModuleRow,
  TeacherRow,
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

export function moduleDefaultAssignmentKey(
  moduleCode: string,
  streamCode: string | null | undefined
) {
  return `${moduleCode}|${normalizeDefaultAssignmentStream(streamCode)}`;
}

export function buildModuleDefaultAssignmentInput(params: {
  academicYear: string;
  module: Pick<
    ModuleRow,
    "module_code" | "module_term" | "programme_code" | "stream_code"
  >;
  teacherName: string;
  teachingStatus: TeachingStatus | null;
  teachers: TeacherRow[];
  mode?: TeachingMode;
}): ModuleDefaultAssignmentInput {
  const trimmedName = String(params.teacherName ?? "").trim() || "TBC";
  const catalogTeacher = params.teachers.find(
    (teacher) => teacher.teacher_name === trimmedName
  );

  if (catalogTeacher) {
    const employment = normalizeTeachingStatus(
      catalogTeacher.employment_type ?? undefined
    );

    return {
      academic_year: params.academicYear,
      module_code: params.module.module_code,
      module_term: params.module.module_term,
      programme_code: params.module.programme_code,
      stream_code: params.module.stream_code,
      teacher_name: catalogTeacher.teacher_name,
      teacher_title: catalogTeacher.title,
      teacher_family_name: catalogTeacher.family_name,
      teacher_other_name: catalogTeacher.other_name,
      teaching_status: params.teachingStatus ?? employment ?? "PT",
      mode: params.mode ?? "Night",
    };
  }

  const parsed = parseTeacherName(trimmedName);

  return {
    academic_year: params.academicYear,
    module_code: params.module.module_code,
    module_term: params.module.module_term,
    programme_code: params.module.programme_code,
    stream_code: params.module.stream_code,
    teacher_name: parsed.teacher_name,
    teacher_title: parsed.teacher_title,
    teacher_family_name: parsed.teacher_family_name,
    teacher_other_name: parsed.teacher_other_name,
    teaching_status: params.teachingStatus ?? "PT",
    mode: params.mode ?? "Night",
  };
}

export interface ProgrammeModuleTeacherRow {
  module: ModuleRow;
  assignment: ModuleDefaultAssignmentRow | null;
}

export async function listProgrammeModuleTeacherRows(params: {
  academicYear: string;
  programmeCode: string;
  streamCode?: string;
}): Promise<ProgrammeModuleTeacherRow[]> {
  const [modules, assignments] = await Promise.all([
    listModules({
      programme_code: params.programmeCode,
      stream_code: params.streamCode || undefined,
    }),
    listModuleDefaultAssignments({
      academicYear: params.academicYear,
      programmeCode: params.programmeCode,
    }),
  ]);

  const assignmentByKey = new Map(
    assignments.map((row) => [
      moduleDefaultAssignmentKey(row.module_code, row.stream_code),
      row,
    ])
  );

  const filteredModules = params.streamCode
    ? modules.filter(
        (module) =>
          normalizeDefaultAssignmentStream(module.stream_code) ===
          normalizeDefaultAssignmentStream(params.streamCode)
      )
    : modules;

  return filteredModules.map((module) => ({
    module,
    assignment:
      assignmentByKey.get(
        moduleDefaultAssignmentKey(module.module_code, module.stream_code)
      ) ?? null,
  }));
}

export function teacherNameFromAssignment(
  assignment: ModuleDefaultAssignmentRow | null
) {
  if (!assignment) return "TBC";

  const built = buildTeacherName(
    assignment.teacher_title,
    assignment.teacher_family_name,
    assignment.teacher_other_name
  );

  return String(assignment.teacher_name ?? built ?? "").trim() || "TBC";
}
