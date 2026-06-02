import { isTBC } from "./utils";
import { buildModuleIdentityKey } from "../services/timetableService";
import type { ModuleDefaultAssignmentRow } from "../types";
import type { TimetablePlanningModuleRow } from "../types";

type PlanningModuleWithDefault = TimetablePlanningModuleRow & {
  default_teacher_name?: string | null;
  teacher_name?: string | null;
};

function normalizeCodePart(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toUpperCase();
}

/** Same aggregation as splitClassService.getCombinedDefaults (teacher names only). */
export function resolveCombinedDefaultTeacherFromPlanningModules(
  modules: PlanningModuleWithDefault[]
) {
  const teacherNames = Array.from(
    new Set(
      modules
        .map(
          (module) =>
            module.default_teacher_name ?? module.teacher_name ?? null
        )
        .filter((value): value is string => {
          if (!value) return false;
          const text = String(value).trim();
          return text !== "" && !isTBC(text);
        })
    )
  ).sort((a, b) => a.localeCompare(b));

  return teacherNames.length > 0 ? teacherNames.join("; ") : "TBC";
}

export function resolveCombinedDefaultTeacherForGroupDetails(
  details: Array<{ planning_module_id: string }>,
  planningModules: PlanningModuleWithDefault[]
) {
  const byId = new Map(planningModules.map((module) => [module.id, module]));

  const members = details
    .map((detail) => byId.get(detail.planning_module_id))
    .filter((module): module is PlanningModuleWithDefault => Boolean(module));

  return resolveCombinedDefaultTeacherFromPlanningModules(members);
}

export function findMatchingModuleDefaultAssignment(params: {
  academicYear: string;
  moduleCode: string;
  programmeCode: string;
  streamCode: string | null | undefined;
  rows: ModuleDefaultAssignmentRow[];
}) {
  const exactKey = buildModuleIdentityKey({
    academicYear: params.academicYear,
    moduleCode: params.moduleCode,
    programmeCode: params.programmeCode,
    programmeStream: params.streamCode,
  });

  const exact = params.rows.find((row) => {
    return (
      buildModuleIdentityKey({
        academicYear: row.academic_year,
        moduleCode: row.module_code,
        programmeCode: row.programme_code,
        programmeStream: row.stream_code,
      }) === exactKey
    );
  });

  if (exact) return exact;

  const moduleKey = normalizeCodePart(params.moduleCode);
  const programmeKey = normalizeCodePart(params.programmeCode);

  const byProgramme = params.rows.filter((row) => {
    return (
      normalizeCodePart(row.module_code) === moduleKey &&
      normalizeCodePart(row.programme_code) === programmeKey
    );
  });

  if (byProgramme.length === 1) return byProgramme[0];

  const streamKey =
    String(params.streamCode ?? "")
      .trim()
      .toLowerCase() || "nil";

  const byStream = byProgramme.filter((row) => {
    const rowStream =
      String(row.stream_code ?? "")
        .trim()
        .toLowerCase() || "nil";
    return rowStream === streamKey;
  });

  if (byStream.length === 1) return byStream[0];

  return null;
}
