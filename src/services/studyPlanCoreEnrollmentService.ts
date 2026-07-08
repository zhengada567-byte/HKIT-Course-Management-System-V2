import { supabase } from "../lib/supabase";
import {
  getAcademicYearVariants,
  normalizeAcademicYear,
  offeredTermToStudyTerm,
} from "../lib/utils";
import type { ModuleTerm } from "../types/common";
import { offeredTermFromStudyTerm, isHDProgrammeType } from "../pages/programme-leader/make-study-plan/helpers";
import { listProgrammes } from "./programmeService";
import {
  allocateEnrollmentGroup,
  isSplitModule,
  loadStudyPlanEnrollmentRows,
  loadTimetableEnrollmentContext,
  resolveModuleInstances,
  type EnrollmentInstanceOption,
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

function buildAllocationGroupKey(params: {
  academicYear: string;
  programmeCode: string;
  moduleCode: string;
  studyTerm: string;
}) {
  return [
    normalizeAcademicYear(params.academicYear),
    params.programmeCode,
    params.moduleCode,
    params.studyTerm,
  ].join("|");
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
  const hdProgrammeCodes = new Set(await listHdProgrammeCodes());
  const coreCodeSet = new Set<string>(HD_CORE_MODULE_CODES);

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

    if (!coreCodeSet.has(moduleCode) || !hdProgrammeCodes.has(programmeCode)) {
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
  const hdProgrammeCodes = new Set(await listHdProgrammeCodes());
  const coreCodeSet = new Set<string>(HD_CORE_MODULE_CODES);

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

    if (!studyTerm || offeredTermFromStudyTerm(studyTerm) !== params.offeredTerm) {
      continue;
    }

    if (!coreCodeSet.has(moduleCode) || !hdProgrammeCodes.has(programmeCode)) {
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

export async function listModuleInstanceCodes(params: {
  academicYear: string;
  offeredTerm: ModuleTerm;
  moduleCodes: string[];
}): Promise<Record<string, string[]>> {
  const context = await loadTimetableEnrollmentContext(params);
  const result: Record<string, string[]> = {};

  for (const moduleCode of params.moduleCodes) {
    const options = resolveModuleInstances(
      moduleCode,
      context.instancesByModuleCode,
      params.offeredTerm
    );
    result[moduleCode] = [
      ...new Set(
        options
          .map((row) => normalizeText(row.moduleInstanceCode))
          .filter(Boolean)
      ),
    ].sort();
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

function filterInstancesByAllowedCodes(
  instances: EnrollmentInstanceOption[],
  allowedCodes: Set<string>
) {
  return instances.filter((row) =>
    allowedCodes.has(normalizeText(row.moduleInstanceCode).toUpperCase())
  );
}

export async function applyHdCoreEnrollmentRules(params: {
  academicYear: string;
  offeredTerm: ModuleTerm;
}): Promise<ApplyHdCoreEnrollmentResult> {
  const rules = await loadEnrollmentRules(params);
  const rulesByKey = new Map(
    rules.map((rule) => [
      ruleKey(rule.moduleCode, rule.programmeCode),
      new Set(
        rule.allowedInstanceCodes.map((code) => normalizeText(code).toUpperCase())
      ),
    ])
  );

  const moduleCodeSet = new Set(
    rules.map((rule) => normalizeText(rule.moduleCode).toUpperCase()).filter(Boolean)
  );
  const programmeCodeSet = new Set(
    rules.map((rule) => normalizeText(rule.programmeCode).toUpperCase()).filter(Boolean)
  );

  const rows = (await loadStudyPlanEnrollmentRows(params)).filter((row) => {
    const moduleCode = normalizeText(row.module_code).toUpperCase();
    const programmeCode = normalizeText(row.programme_code).toUpperCase();
    return moduleCodeSet.has(moduleCode) && programmeCodeSet.has(programmeCode);
  });

  const context = await loadTimetableEnrollmentContext(params);
  const warnings: string[] = [];
  const updates = new Map<string, string>();

  const groups = new Map<string, typeof rows>();

  for (const row of rows) {
    const key = buildAllocationGroupKey({
      academicYear: params.academicYear,
      programmeCode: row.programme_code,
      moduleCode: row.module_code,
      studyTerm: row.study_term,
    });
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  for (const [, groupRows] of groups) {
    const sample = groupRows[0]!;
    const groupLabel = `${sample.programme_code} / ${sample.module_code} / ${sample.study_term}`;
    const allowedCodes = rulesByKey.get(
      ruleKey(sample.module_code, sample.programme_code)
    );

    if (!allowedCodes || allowedCodes.size === 0) {
      for (const row of groupRows) {
        warnings.push(
          `${groupLabel}: no HD core enrollment rule for ${row.student_id} / ${row.module_code}.`
        );
      }
      continue;
    }

    const allInstances = resolveModuleInstances(
      sample.module_code,
      context.instancesByModuleCode,
      params.offeredTerm
    );
    const instances = filterInstancesByAllowedCodes(allInstances, allowedCodes);

    if (instances.length === 0) {
      for (const row of groupRows) {
        warnings.push(
          `${groupLabel}: allowed instance list does not match any timetable class for ${row.student_id} / ${row.module_code}.`
        );
      }
      continue;
    }

    const assignments = allocateEnrollmentGroup({
      rows: groupRows,
      instances,
      warnings,
      groupLabel,
    });

    for (const [rowId, code] of assignments) {
      updates.set(rowId, code);
    }
  }

  let assignedCount = 0;

  for (const [rowId, code] of updates) {
    const { error } = await supabase
      .from("study_plan_modules")
      .update({
        enrolled_module_instance_code: code,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rowId);

    if (error) throw error;
    assignedCount += 1;
  }

  return {
    assignedCount,
    warningCount: warnings.length,
    warnings,
  };
}
