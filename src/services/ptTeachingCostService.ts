import { normalizeProgrammeYear } from "../lib/programmeYear";
import {
  listProgrammeHourlyRates,
  listTeacherHourlyRates,
  type ProgrammeHourlyRateRow,
  type TeacherHourlyRateRow,
} from "./hourlyRateService";
import {
  getTeacherContactHoursSummary,
  type TeacherContactHoursTermFilter,
} from "./teacherContactHoursService";
import type { ModuleTerm } from "../types";

export type PtTeachingCostLine = {
  teacher_name: string;
  teacher_employment_type: string | null;
  teaching_status: "FT" | "PT";
  programme_code: string;
  module_code: string;
  module_instance_code: string;
  module_name: string | null;
  module_year: string | null;
  module_term: ModuleTerm;
  contact_hours: number;
  hourly_rate: number | null;
  rate_source: "teacher" | "programme" | "missing";
  cost: number | null;
};

function normalizeTeacherKey(name: string) {
  return String(name ?? "").trim().toLowerCase();
}

export function resolvePtHourlyRate(params: {
  teacherName: string;
  programmeCode: string;
  moduleYear: string | null | undefined;
  teacherRates: TeacherHourlyRateRow[];
  programmeRates: ProgrammeHourlyRateRow[];
}): { rate: number | null; source: "teacher" | "programme" | "missing" } {
  const teacherKey = normalizeTeacherKey(params.teacherName);
  const teacherRate = params.teacherRates.find(
    (row) => normalizeTeacherKey(row.teacher_name) === teacherKey
  );
  if (teacherRate != null) {
    return { rate: Number(teacherRate.hourly_rate), source: "teacher" };
  }

  const programmeCode = String(params.programmeCode ?? "")
    .trim()
    .toUpperCase();
  const year =
    normalizeProgrammeYear(params.moduleYear) ??
    String(params.moduleYear ?? "").trim().toUpperCase();

  if (programmeCode && year) {
    const programmeRate = params.programmeRates.find(
      (row) =>
        String(row.programme_code).trim().toUpperCase() === programmeCode &&
        String(row.programme_year).trim().toUpperCase() === year
    );
    if (programmeRate != null) {
      return { rate: Number(programmeRate.hourly_rate), source: "programme" };
    }
  }

  return { rate: null, source: "missing" };
}

/**
 * PT teaching cost from daily L/T contact hours where the class instance's
 * 此科教學身份 = PT (timetable assignment, else 基本科目设定 default).
 * Same source as Teacher Loading → Contact hours → PT.
 */
export async function calculatePtTeachingCosts(params: {
  academicYear: string;
  term?: TeacherContactHoursTermFilter;
  programmeCode?: string;
}): Promise<{
  lines: PtTeachingCostLine[];
  totalCost: number;
  missingRateCount: number;
}> {
  const term = params.term ?? "All";
  const programmeFilter = String(params.programmeCode ?? "")
    .trim()
    .toUpperCase();

  const [hoursRows, teacherRates, programmeRates] = await Promise.all([
    getTeacherContactHoursSummary({
      academicYear: params.academicYear,
      teachingStatus: "PT",
      term,
    }),
    listTeacherHourlyRates(params.academicYear),
    listProgrammeHourlyRates(params.academicYear),
  ]);

  const lines: PtTeachingCostLine[] = [];
  let totalCost = 0;
  let missingRateCount = 0;

  for (const teacher of hoursRows) {
    for (const module of teacher.modules) {
      const programmeCode = String(module.programme_code ?? "")
        .trim()
        .toUpperCase();
      if (programmeFilter && programmeCode !== programmeFilter) continue;

      const { rate, source } = resolvePtHourlyRate({
        teacherName: teacher.teacher_name,
        programmeCode,
        moduleYear: module.module_year,
        teacherRates,
        programmeRates,
      });

      const hours = Number(module.total_hours) || 0;
      const cost =
        rate != null ? Math.round(hours * rate * 100) / 100 : null;
      if (cost != null) totalCost += cost;
      if (rate == null) missingRateCount += 1;

      lines.push({
        teacher_name: teacher.teacher_name,
        teacher_employment_type: teacher.teacher_employment_type,
        teaching_status: "PT",
        programme_code: programmeCode,
        module_code: module.module_code,
        module_instance_code: module.module_instance_code,
        module_name: module.module_name,
        module_year: module.module_year,
        module_term: module.module_term,
        contact_hours: hours,
        hourly_rate: rate,
        rate_source: source,
        cost,
      });
    }
  }

  lines.sort((a, b) => {
    const byTeacher = a.teacher_name.localeCompare(b.teacher_name);
    if (byTeacher !== 0) return byTeacher;
    const byProg = a.programme_code.localeCompare(b.programme_code);
    if (byProg !== 0) return byProg;
    return a.module_instance_code.localeCompare(b.module_instance_code);
  });

  return {
    lines,
    totalCost: Math.round(totalCost * 100) / 100,
    missingRateCount,
  };
}
