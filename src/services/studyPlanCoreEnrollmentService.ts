import { supabase } from "../lib/supabase";
import {
  getAcademicYearVariants,
  normalizeAcademicYear,
  offeredTermToStudyTerm,
} from "../lib/utils";
import type { ModuleTerm } from "../types/common";
import {
  offeredTermFromStudyTerm,
  isDegreeProgrammeType,
  isHDProgrammeType,
} from "../pages/programme-leader/make-study-plan/helpers";
import { listProgrammes } from "./programmeService";
import { parseArticulatedDegreeCodes } from "./studyPlanService";
import {
  batchEnrollStudyPlanStudents,
  isSplitModule,
  loadTimetableEnrollmentContext,
  resolveModuleInstances,
} from "./studyPlanEnrollmentService";

/** Study-plan modules with programme-specific allowed timetable instances. */
export const HD_CORE_MODULE_CODES = [
  "HD401",
  "HD402",
  "HD403",
  "HD404",
  "HD405",
  "HD408",
] as const;

export type HdCoreActualCountsByKey = Record<
  string,
  {
    ft: number;
    pt: number;
  }
>;

export type OfferedModule = {
  moduleCode: string;
  moduleName: string | null;
  programmeCodes: string[];
};

export type CoreEnrollmentRule = {
  id?: string;
  academicYear: string;
  moduleTerm: ModuleTerm;
  moduleCode: string;
  programmeCode: string;
  allowedInstanceCodes: string[];
};

export type ApplyHdCoreEnrollmentResult = {
  assignedCount: number;
  skippedCount: number;
  warningCount: number;
  warnings: string[];
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function ruleKey(moduleCode: string, programmeCode: string) {
  return `${normalizeText(moduleCode).toUpperCase()}|${normalizeText(programmeCode).toUpperCase()}`;
}

export async function listHdProgrammeCodes(): Promise<string[]> {
  const programmes = await listProgrammes();
  const codes = new Set<string>();

  for (const row of programmes) {
    if (!isHDProgrammeType(row.programme_type)) continue;
    const code = normalizeText(row.programme_code).toUpperCase();
    if (code) codes.add(code);
  }

  return [...codes].sort();
}

function buildArticulatedDegreeCodesByHdProgramme(
  programmes: Awaited<ReturnType<typeof listProgrammes>>
) {
  const validDegreeCodes = new Set(
    programmes
      .filter((row) => isDegreeProgrammeType(row.programme_type))
      .map((row) => normalizeText(row.programme_code).toUpperCase())
      .filter(Boolean)
  );

  const map = new Map<string, Set<string>>();

  for (const row of programmes) {
    if (!isHDProgrammeType(row.programme_type)) continue;

    const hdCode = normalizeText(row.programme_code).toUpperCase();
    if (!hdCode) continue;

    for (const degreeCode of parseArticulatedDegreeCodes(row.articulation)) {
      if (!validDegreeCodes.has(degreeCode)) continue;

      const set = map.get(hdCode) ?? new Set<string>();
      set.add(degreeCode);
      map.set(hdCode, set);
    }
  }

  return map;
}

function expandProgrammeCodesWithArticulation(
  programmeCodes: Set<string>,
  articulatedByHd: Map<string, Set<string>>
) {
  const expanded = new Set(programmeCodes);

  for (const programmeCode of programmeCodes) {
    const degreeCodes = articulatedByHd.get(programmeCode);
    if (!degreeCodes) continue;

    for (const degreeCode of degreeCodes) {
      expanded.add(degreeCode);
    }
  }

  return expanded;
}

export async function listOfferedModulesForEnrollment(params: {
  academicYear: string;
  offeredTerm: ModuleTerm;
}): Promise<OfferedModule[]> {
  const yearVariants = getAcademicYearVariants(normalizeAcademicYear(params.academicYear));

  const { data, error } = await supabase
    .from("timetable_planning_modules")
    .select("module_code, module_name, programme_code")
    .in("academic_year", yearVariants)
    .eq("module_term", params.offeredTerm)
    .eq("offering_status", "active")
    .order("module_code")
    .order("programme_code");

  if (error) throw error;

  const programmes = await listProgrammes();
  const articulatedByHd = buildArticulatedDegreeCodesByHdProgramme(programmes);

  const byModule = new Map<
    string,
    { moduleCode: string; moduleName: string | null; programmeCodes: Set<string> }
  >();

  for (const row of data ?? []) {
    const moduleCode = normalizeText(row.module_code).toUpperCase();
    const programmeCode = normalizeText(row.programme_code).toUpperCase();
    const moduleName = row.module_name ? normalizeText(row.module_name) : null;

    if (!moduleCode || !programmeCode) continue;

    const existing =
      byModule.get(moduleCode) ??
      {
        moduleCode,
        moduleName,
        programmeCodes: new Set<string>(),
      };

    if (!existing.moduleName && moduleName) {
      existing.moduleName = moduleName;
    }

    existing.programmeCodes.add(programmeCode);
    byModule.set(moduleCode, existing);
  }

  for (const module of byModule.values()) {
    module.programmeCodes = expandProgrammeCodesWithArticulation(
      module.programmeCodes,
      articulatedByHd
    );
  }

  const context = await loadTimetableEnrollmentContext(params);

  return [...byModule.values()]
    .filter((row) => {
      const instances = resolveModuleInstances(
        row.moduleCode,
        context.instancesByModuleCode,
        params.offeredTerm
      );
      return isSplitModule(instances);
    })
    .map((row) => ({
      moduleCode: row.moduleCode,
      moduleName: row.moduleName,
      programmeCodes: [...row.programmeCodes].sort(),
    }))
    .sort((a, b) => a.moduleCode.localeCompare(b.moduleCode));
}

export async function loadHdCoreEnrollmentStudentCounts(params: {
  academicYear: string;
  offeredTerm: ModuleTerm;
}): Promise<Record<string, number>> {
  const canonicalYear = normalizeAcademicYear(params.academicYear);
  const canonicalStudyTerm = offeredTermToStudyTerm(
    canonicalYear,
    params.offeredTerm
  );

  const { data, error } = await supabase
    .from("timetable_student_numbers")
    .select(
      "module_code, programme_code, programme_stream, study_term, expected_student_number"
    )
    .in("academic_year", getAcademicYearVariants(params.academicYear))
    .eq("programme_stream", "nil");

  if (error) throw error;

  const counts: Record<string, number> = {};

  for (const row of data ?? []) {
    const moduleCode = normalizeText(row.module_code).toUpperCase();
    const programmeCode = normalizeText(row.programme_code).toUpperCase();

    if (!moduleCode || !programmeCode) {
      continue;
    }

    const studyTerm = normalizeText(row.study_term);

    if (
      !studyTerm ||
      offeredTermFromStudyTerm(studyTerm) !== params.offeredTerm
    ) {
      continue;
    }

    const key = ruleKey(moduleCode, programmeCode);
    const expected = Number(row.expected_student_number ?? 0);

    // Prefer the canonical study term row (e.g. T2026C for Sep 2026/27).
    if (studyTerm === canonicalStudyTerm || counts[key] === undefined) {
      counts[key] = expected;
    }
  }

  return counts;
}

export async function loadHdCoreEnrollmentActualCounts(params: {
  academicYear: string;
  offeredTerm: ModuleTerm;
}): Promise<HdCoreActualCountsByKey> {
  const canonicalYear = normalizeAcademicYear(params.academicYear);

  const { data, error } = await supabase
    .from("study_plan_actual_student_numbers")
    .select("module_code, programme_code, study_term, study_mode, actual_student_number")
    .in("academic_year", getAcademicYearVariants(canonicalYear));

  if (error) throw error;

  const counts: HdCoreActualCountsByKey = {};

  for (const row of data ?? []) {
    const moduleCode = normalizeText(row.module_code).toUpperCase();
    const programmeCode = normalizeText(row.programme_code).toUpperCase();
    const studyTerm = normalizeText(row.study_term);

    if (!moduleCode || !programmeCode) {
      continue;
    }

    if (!studyTerm || offeredTermFromStudyTerm(studyTerm) !== params.offeredTerm) {
      continue;
    }

    const key = ruleKey(moduleCode, programmeCode);
    const mode = normalizeText(row.study_mode).toUpperCase() === "PT" ? "pt" : "ft";
    const actual = Number(row.actual_student_number ?? 0);

    const previous = counts[key] ?? { ft: 0, pt: 0 };
    counts[key] = {
      ...previous,
      [mode]: (previous[mode] ?? 0) + actual,
    };
  }

  return counts;
}

export type ModuleInstanceForEnrollment = {
  moduleInstanceCode: string;
  instanceMode: "Day" | "Night" | "Saturday" | null;
};

export async function listModuleInstancesForEnrollment(params: {
  academicYear: string;
  offeredTerm: ModuleTerm;
  moduleCodes: string[];
}): Promise<Record<string, ModuleInstanceForEnrollment[]>> {
  const context = await loadTimetableEnrollmentContext(params);
  const result: Record<string, ModuleInstanceForEnrollment[]> = {};

  for (const moduleCode of params.moduleCodes) {
    const options = resolveModuleInstances(
      moduleCode,
      context.instancesByModuleCode,
      params.offeredTerm
    );
    const seen = new Set<string>();
    const instances: ModuleInstanceForEnrollment[] = [];

    for (const row of options) {
      const code = normalizeText(row.moduleInstanceCode);
      if (!code || seen.has(code)) continue;

      seen.add(code);
      instances.push({
        moduleInstanceCode: code,
        instanceMode: row.instanceMode,
      });
    }

    result[moduleCode] = instances.sort((a, b) =>
      a.moduleInstanceCode.localeCompare(b.moduleInstanceCode)
    );
  }

  return result;
}

export async function loadEnrollmentRules(params: {
  academicYear: string;
  offeredTerm: ModuleTerm;
}): Promise<CoreEnrollmentRule[]> {
  const canonicalYear = normalizeAcademicYear(params.academicYear);

  const { data, error } = await supabase
    .from("study_plan_enrollment_rules")
    .select(
      "id, academic_year, module_term, module_code, programme_code, allowed_instance_codes"
    )
    .eq("academic_year", canonicalYear)
    .eq("module_term", params.offeredTerm)
    .order("module_code")
    .order("programme_code");

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: String(row.id ?? ""),
    academicYear: normalizeText(row.academic_year),
    moduleTerm: normalizeText(row.module_term) as ModuleTerm,
    moduleCode: normalizeText(row.module_code).toUpperCase(),
    programmeCode: normalizeText(row.programme_code).toUpperCase(),
    allowedInstanceCodes: (row.allowed_instance_codes ?? [])
      .map((code: string) => normalizeText(code))
      .filter(Boolean),
  }));
}

export async function saveEnrollmentRules(params: {
  academicYear: string;
  offeredTerm: ModuleTerm;
  rules: CoreEnrollmentRule[];
}): Promise<void> {
  const canonicalYear = normalizeAcademicYear(params.academicYear);
  const now = new Date().toISOString();

  const payload = params.rules
    .map((rule) => ({
      academic_year: canonicalYear,
      module_term: params.offeredTerm,
      module_code: normalizeText(rule.moduleCode).toUpperCase(),
      programme_code: normalizeText(rule.programmeCode).toUpperCase(),
      allowed_instance_codes: [
        ...new Set(
          rule.allowedInstanceCodes
            .map((code) => normalizeText(code))
            .filter(Boolean)
        ),
      ],
      updated_at: now,
    }))
    .filter((row) => row.module_code && row.programme_code);

  const { error: deleteError } = await supabase
    .from("study_plan_enrollment_rules")
    .delete()
    .eq("academic_year", canonicalYear)
    .eq("module_term", params.offeredTerm);

  if (deleteError) throw deleteError;

  if (payload.length === 0) return;

  const { error: insertError } = await supabase
    .from("study_plan_enrollment_rules")
    .insert(payload);

  if (insertError) throw insertError;
}

export async function applyHdCoreEnrollmentRules(params: {
  academicYear: string;
  offeredTerm: ModuleTerm;
  /** When true (default), skip rows that already have an enrolled class. */
  onlyEmpty?: boolean;
}): Promise<ApplyHdCoreEnrollmentResult> {
  return batchEnrollStudyPlanStudents(params);
}
