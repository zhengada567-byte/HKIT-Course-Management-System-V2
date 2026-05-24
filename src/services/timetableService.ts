import { supabase } from "../lib/supabase";
import { getAcademicYearVariants, normalizeStream } from "../lib/utils";
import type {
  ModuleAdjustmentRow,
  ModuleRow,
  TimetableModuleRow,
  TimetablePlanningModuleRow,
} from "../types";
import type { ModuleDefaultAssignmentRow } from "./moduleDefaultAssignmentService";
import type { ModuleEnrollmentRow } from "./moduleEnrollmentService";

export interface GeneratePlanningModulesParams {
  academicYear: string;
  programmeCode?: string;
  streamCode?: string;
  createdBy: string;
}

export interface PlanningModuleWithStudentNumber
  extends TimetablePlanningModuleRow {
  expected_student_number?: number | null;
  actual_student_number?: number | null;
  default_teacher_name?: string | null;
  default_teaching_status?: string | null;
  default_mode?: string | null;
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function normalizeCodePart(value: string | null | undefined) {
  return normalizeText(value)
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toUpperCase();
}

function normalizeStreamKey(value: string | null | undefined) {
  return normalizeText(value).toLowerCase();
}

function normalizeStoredStream(value: string | null | undefined) {
  const text = normalizeText(value);

  return text === "" ? "nil" : text;
}

function isCommonStreamModule(streamCode: string | null | undefined) {
  const text = normalizeStreamKey(streamCode);

  return text === "" || text === "nil";
}

function isModuleForSelectedStream(
  moduleStreamCode: string | null | undefined,
  selectedStreamCode: string | null | undefined
) {
  const selected = normalizeStreamKey(normalizeStream(selectedStreamCode ?? ""));

  if (!selected) {
    return true;
  }

  const moduleStream = normalizeStreamKey(
    normalizeStream(moduleStreamCode ?? "")
  );

  return isCommonStreamModule(moduleStream) || moduleStream === selected;
}

function buildSimpleKey(params: {
  academicYear: string;
  moduleCode: string;
  programmeCode: string;
  moduleTerm?: string | null;
}) {
  return [
    normalizeText(params.academicYear).toLowerCase(),
    normalizeCodePart(params.moduleCode),
    normalizeCodePart(params.programmeCode),
    normalizeText(params.moduleTerm).toLowerCase(),
  ].join("|");
}

function getOptionalModuleTerm(row: {
  module_term?: string | null;
  moduleTerm?: string | null;
}) {
  return row.module_term ?? row.moduleTerm ?? null;
}


export async function generateTimetablePlanningModules(
  params: GeneratePlanningModulesParams
) {
  let moduleQuery = supabase
    .from("modules")
    .select("*")
    .order("programme_code")
    .order("stream_code")
    .order("module_code");

  if (params.programmeCode) {
    moduleQuery = moduleQuery.eq("programme_code", params.programmeCode);
  }

  const [
    { data: modules, error: moduleError },
    { data: adjustments, error: adjustmentError },
  ] = await Promise.all([
    moduleQuery,
    supabase
      .from("module_adjustments")
      .select("*")
      .eq("academic_year", params.academicYear),
  ]);

  if (moduleError) throw moduleError;
  if (adjustmentError) throw adjustmentError;

  const adjustmentMap = new Map<string, ModuleAdjustmentRow>();

  for (const adjustment of (adjustments ?? []) as ModuleAdjustmentRow[]) {
    adjustmentMap.set(adjustment.module_id, adjustment);
  }

  /*
    Generate / Load should not filter by selected stream.

    Correct flow:
    - Generate DB records for all streams under the selected programme.
    - Apply stream filtering only when listing/displaying modules.
  */
  const moduleRows = (modules ?? []) as ModuleRow[];

  let deleteQuery = supabase
    .from("timetable_planning_modules")
    .delete()
    .eq("academic_year", params.academicYear);

  if (params.programmeCode) {
    deleteQuery = deleteQuery.eq("programme_code", params.programmeCode);
  }

  const { error: deleteError } = await deleteQuery;

  if (deleteError) throw deleteError;

  const planningPayload = moduleRows.map((module) => {
    const adjustment = adjustmentMap.get(module.id);

    return {
      academic_year: params.academicYear,
      module_id: module.id,
      programme_code: module.programme_code,
      stream_code: normalizeStoredStream(module.stream_code),
      module_code: module.module_code,
      module_name: module.module_name,
      module_year: adjustment?.adjusted_module_year ?? module.module_year,
      module_term: adjustment?.adjusted_module_term ?? module.module_term,
      natural_combine_code: null,
      manual_combine_group_id: null,
      split_status: "not_started",
      assignment_status: "not_started",
      created_by: params.createdBy,
    };
  });

  if (planningPayload.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("timetable_planning_modules")
    .upsert(planningPayload, {
      onConflict: "academic_year,module_id",
    })
    .select("*");

  if (error) throw error;

  return (data ?? []) as TimetablePlanningModuleRow[];
}

export async function ensureTimetablePlanningModules(
  params: GeneratePlanningModulesParams
) {
  let moduleQuery = supabase
    .from("modules")
    .select("*")
    .order("programme_code")
    .order("stream_code")
    .order("module_code");

  if (params.programmeCode) {
    moduleQuery = moduleQuery.eq("programme_code", params.programmeCode);
  }

  const [
    { data: modules, error: moduleError },
    { data: adjustments, error: adjustmentError },
    { data: existingPlanningModules, error: existingError },
  ] = await Promise.all([
    moduleQuery,
    supabase
      .from("module_adjustments")
      .select("*")
      .eq("academic_year", params.academicYear),
    (() => {
      let query = supabase
        .from("timetable_planning_modules")
        .select("*")
        .in("academic_year", getAcademicYearVariants(params.academicYear));

      if (params.programmeCode) {
        query = query.eq("programme_code", params.programmeCode);
      }

      return query;
    })(),
  ]);

  if (moduleError) throw moduleError;
  if (adjustmentError) throw adjustmentError;
  if (existingError) throw existingError;

  const moduleRows = (modules ?? []) as ModuleRow[];
  const existingRows = normalizePlanningRowsToYear(
    (existingPlanningModules ?? []) as TimetablePlanningModuleRow[],
    params.academicYear
  );

  const existingModuleIds = new Set(existingRows.map((row) => row.module_id));

  const adjustmentMap = new Map<string, ModuleAdjustmentRow>();

  for (const adjustment of (adjustments ?? []) as ModuleAdjustmentRow[]) {
    adjustmentMap.set(adjustment.module_id, adjustment);
  }

  const missingModules = moduleRows.filter(
    (module) => !existingModuleIds.has(module.id)
  );

  if (missingModules.length === 0) {
    return existingRows;
  }

  const insertPayload = missingModules.map((module) => {
    const adjustment = adjustmentMap.get(module.id);

    return {
      academic_year: params.academicYear,
      module_id: module.id,
      programme_code: module.programme_code,
      stream_code: normalizeStoredStream(module.stream_code),
      module_code: module.module_code,
      module_name: module.module_name,
      module_year: adjustment?.adjusted_module_year ?? module.module_year,
      module_term: adjustment?.adjusted_module_term ?? module.module_term,
      natural_combine_code: null,
      manual_combine_group_id: null,
      split_status: "not_started",
      assignment_status: "not_started",
      created_by: params.createdBy,
    };
  });

  const { data: insertedRows, error: insertError } = await supabase
    .from("timetable_planning_modules")
    .insert(insertPayload)
    .select("*");

  if (insertError) throw insertError;

  return [
    ...existingRows,
    ...normalizePlanningRowsToYear(
      (insertedRows ?? []) as TimetablePlanningModuleRow[],
      params.academicYear
    ),
  ];
}


function normalizePlanningRowsToYear(
  rows: TimetablePlanningModuleRow[],
  academicYear: string
) {
  return rows.map((row) => ({
    ...row,
    academic_year: academicYear,
  }));
}

export async function listPlanningModules(params: {
  academicYear: string;
  programmeCode?: string;
  streamCode?: string;
}) {
  const yearVariants = getAcademicYearVariants(params.academicYear);

  let query = supabase
    .from("timetable_planning_modules")
    .select("*")
    .in("academic_year", yearVariants)
    .order("programme_code")
    .order("stream_code")
    .order("module_code");

  if (params.programmeCode) {
    query = query.eq("programme_code", params.programmeCode);
  }

  const { data, error } = await query;

  if (error) throw error;

  const rows = normalizePlanningRowsToYear(
    (data ?? []) as TimetablePlanningModuleRow[],
    params.academicYear
  );

  if (!params.streamCode) {
    return rows;
  }

  return rows.filter((module) =>
    isModuleForSelectedStream(module.stream_code, params.streamCode)
  );
}

async function attachStudentNumbersAndDefaults(params: {
  academicYear: string;
  planningModules: TimetablePlanningModuleRow[];
}) {
  const yearVariants = getAcademicYearVariants(params.academicYear);

  const [studentNumbers, enrollmentsResult, defaultsResult] = await Promise.all([
    supabase
      .from("timetable_student_numbers")
      .select("*")
      .in("academic_year", yearVariants),
    supabase
      .from("module_enrollment")
      .select("*")
      .in("academic_year", yearVariants),
    supabase
      .from("module_default_assignments")
      .select("*")
      .in("academic_year", yearVariants),
  ]);

  if (studentNumbers.error) throw studentNumbers.error;
  if (enrollmentsResult.error) throw enrollmentsResult.error;
  if (defaultsResult.error) throw defaultsResult.error;

  const studentNumberMap = new Map<
    string,
    {
      expected_student_number: number;
      actual_student_number: number | null;
    }
  >();

  for (const row of studentNumbers.data ?? []) {
    const key = buildSimpleKey({
      academicYear: params.academicYear,
      moduleCode: row.module_code,
      programmeCode: row.programme_code,
      moduleTerm: getOptionalModuleTerm(row),
    });

    studentNumberMap.set(key, {
      expected_student_number: row.expected_student_number,
      actual_student_number: row.actual_student_number,
    });
  }

  const enrollmentMap = new Map<
    string,
    {
      expected_student_number: number;
      actual_student_number: number | null;
    }
  >();

  for (const row of (enrollmentsResult.data ?? []) as ModuleEnrollmentRow[]) {
    const key = buildSimpleKey({
      academicYear: params.academicYear,
      moduleCode: row.module_code,
      programmeCode: row.programme_code,
      moduleTerm: getOptionalModuleTerm(row),
    });

    enrollmentMap.set(key, {
      expected_student_number: row.expected_student_number,
      actual_student_number: row.actual_student_number,
    });
  }

  const defaultAssignmentMap = new Map<string, ModuleDefaultAssignmentRow>();

  for (const row of (defaultsResult.data ?? []) as ModuleDefaultAssignmentRow[]) {
    const key = buildSimpleKey({
      academicYear: params.academicYear,
      moduleCode: row.module_code,
      programmeCode: row.programme_code,
      moduleTerm: getOptionalModuleTerm(row),
    });

    defaultAssignmentMap.set(key, row);
  }

  return params.planningModules.map<PlanningModuleWithStudentNumber>(
    (module) => {
      const key = buildSimpleKey({
        academicYear: module.academic_year,
        moduleCode: module.module_code,
        programmeCode: module.programme_code,
        moduleTerm: module.module_term,
      });

      const studentNumber = studentNumberMap.get(key);
      const enrollment = enrollmentMap.get(key);
      const defaultAssignment = defaultAssignmentMap.get(key);

      return {
        ...module,
        expected_student_number:
          studentNumber?.expected_student_number ??
          enrollment?.expected_student_number ??
          null,
        actual_student_number:
          studentNumber?.actual_student_number ??
          enrollment?.actual_student_number ??
          null,
        default_teacher_name: defaultAssignment?.teacher_name ?? null,
        default_teaching_status: defaultAssignment?.teaching_status ?? null,
        default_mode: defaultAssignment?.mode ?? "Night",
      };
    }
  );
}

export async function listPlanningModulesWithStudentNumbers(params: {
  academicYear: string;
  programmeCode?: string;
  streamCode?: string;
}) {
  const planningModules = await listPlanningModules(params);

  return attachStudentNumbersAndDefaults({
    academicYear: params.academicYear,
    planningModules,
  });
}

export async function listAllPlanningModulesWithStudentNumbers(params: {
  academicYear: string;
}) {
  const { data, error } = await supabase
    .from("timetable_planning_modules")
    .select("*")
    .eq("academic_year", params.academicYear)
    .order("programme_code")
    .order("stream_code")
    .order("module_code");

  if (error) throw error;

  const planningModules = (data ?? []) as TimetablePlanningModuleRow[];

  return attachStudentNumbersAndDefaults({
    academicYear: params.academicYear,
    planningModules,
  });
}

export async function updatePlanningModuleNaturalCombineCode(params: {
  planningModuleIds: string[];
  naturalCombineCode: string | null;
}) {
  if (params.planningModuleIds.length === 0) return;

  const { error } = await supabase
    .from("timetable_planning_modules")
    .update({
      natural_combine_code: params.naturalCombineCode,
    })
    .in("id", params.planningModuleIds);

  if (error) throw error;
}

export async function updatePlanningModuleManualCombineGroup(params: {
  planningModuleIds: string[];
  manualCombineGroupId: string | null;
}) {
  if (params.planningModuleIds.length === 0) return;

  const { error } = await supabase
    .from("timetable_planning_modules")
    .update({
      manual_combine_group_id: params.manualCombineGroupId,
    })
    .in("id", params.planningModuleIds);

  if (error) throw error;
}

/**
 * List generated timetable modules.
 *
 * Important:
 * This supports programme / stream filtering so Assignment page only shows
 * modules under the currently selected programme / stream.
 */
export async function listTimetableModules(params: {
  academicYear: string;
  programmeCode?: string;
  streamCode?: string;
}) {
  let query = supabase
    .from("timetable_modules")
    .select("*")
    .eq("academic_year", params.academicYear)
    .order("programme_code")
    .order("stream_code")
    .order("module_term")
    .order("module_instance_code");

  if (params.programmeCode) {
    query = query.eq("programme_code", params.programmeCode);
  }

  const { data, error } = await query;

  if (error) throw error;

  const rows = (data ?? []) as TimetableModuleRow[];

  if (!params.streamCode) {
    return rows;
  }

  return rows.filter((module) =>
    isModuleForSelectedStream(module.stream_code, params.streamCode)
  );
}

export async function deleteTimetableModulesByAcademicYear(academicYear: string) {
  const { error } = await supabase
    .from("timetable_modules")
    .delete()
    .eq("academic_year", academicYear);

  if (error) throw error;
}

export function getNaturalCombineCodeForPlanningModule(
  module: TimetablePlanningModuleRow
) {
  return `AUTO_${normalizeCodePart(module.module_code)}_${normalizeCodePart(
    module.module_term
  )}`;
}
