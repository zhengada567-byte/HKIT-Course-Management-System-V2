// src/services/loadingService.ts

import {
  isDegreeProgrammeType,
  isHDProgrammeType,
} from "../pages/programme-leader/make-study-plan/helpers";
import { supabase } from "../lib/supabase";
import { isTBC } from "../lib/utils";
import type {
  EmploymentType,
  TeacherRow,
  TeachingAssignmentRow,
  TeacherActualLoadingRow,
  TimetableModuleRow,
} from "../types";
import { getAssignmentConfirmationMonitor } from "./adminAssignmentMonitorService";
import {
  canonicalizeTeacherNameForLoading,
  listTeachers,
  resolveTeacherEmploymentFromCatalog,
} from "./teacherService";
import { listTimetableModuleInstances } from "./timetableModuleInstanceService";
import {
  listScheduledTimetableModuleIds,
  listTimetableSessions,
  type TimetableSessionRow,
} from "./timetableScheduleService";
import { listTimetableModules } from "./timetableService";

interface LoadingResult {
  teacher_name: string;
  academic_year: string;
  module_term: "Sep" | "Feb" | "Jun";
  teaching_status: "FT" | "PT";
  teacher_employment_type: "FT" | "PT" | "" | null;
  actual_loading: number;
  hd_module_count: number;
  degree_module_count: number;
}

export interface UpdateTeacherLoadingParams {
  academicYear: string;
  updatedBy?: string | null;

  /**
   * Optional.
   *
   * If provided, only that confirmed assignment_version will be used.
   * If omitted, all rows with confirmed = true for this academic year will be used.
   */
  sourceConfirmedVersion?: number;
}

export interface UpdateTeacherLoadingResult {
  insertedCount: number;
  sourceConfirmedVersion: number | null;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function isHDProgramme(value: string | null | undefined): boolean {
  return isHDProgrammeType(value);
}

function isDegreeProgramme(value: string | null | undefined): boolean {
  return isDegreeProgrammeType(value);
}

function normalizeTeachingStatus(
  value: string | null | undefined
): "FT" | "PT" {
  const normalized = normalizeText(value).toUpperCase();

  if (normalized === "PT") {
    return "PT";
  }

  return "FT";
}

function normalizeModuleTerm(
  value: string | null | undefined
): "Sep" | "Feb" | "Jun" {
  const normalized = normalizeText(value);

  if (normalized === "Feb") {
    return "Feb";
  }

  if (normalized === "Jun") {
    return "Jun";
  }

  return "Sep";
}

function normalizeEmploymentType(
  value: string | null | undefined
): "FT" | "PT" | "" | null {
  const normalized = normalizeText(value).toUpperCase();

  if (normalized === "FT") {
    return "FT";
  }

  if (normalized === "PT") {
    return "PT";
  }

  if (normalized === "") {
    return null;
  }

  return "";
}

async function enrichAssignmentsWithProgrammeType(
  assignments: TeachingAssignmentRow[]
): Promise<TeachingAssignmentRow[]> {
  if (assignments.length === 0) {
    return [];
  }

  const needsLookup = assignments.some(
    (assignment) => !normalizeText(assignment.programme_type)
  );

  if (!needsLookup) {
    return assignments;
  }

  const moduleIds = [
    ...new Set(assignments.map((assignment) => assignment.timetable_module_id)),
  ];

  const { data: modules, error: modulesError } = await supabase
    .from("timetable_modules")
    .select("id, programme_code")
    .in("id", moduleIds);

  if (modulesError) {
    throw modulesError;
  }

  const programmeCodeByModuleId = new Map(
    (modules ?? []).map((module) => [module.id, module.programme_code])
  );

  const programmeCodes = [
    ...new Set(
      [...programmeCodeByModuleId.values()]
        .map((code) => normalizeText(code))
        .filter(Boolean)
    ),
  ];

  const programmeTypeByCode = new Map<string, string | null>();

  if (programmeCodes.length > 0) {
    const { data: programmes, error: programmesError } = await supabase
      .from("programmes")
      .select("programme_code, programme_type")
      .in("programme_code", programmeCodes);

    if (programmesError) {
      throw programmesError;
    }

    for (const programme of programmes ?? []) {
      programmeTypeByCode.set(
        programme.programme_code,
        programme.programme_type ?? null
      );
    }
  }

  return assignments.map((assignment) => {
    if (normalizeText(assignment.programme_type)) {
      return assignment;
    }

    const programmeCode = programmeCodeByModuleId.get(
      assignment.timetable_module_id
    );
    const programmeType = programmeCode
      ? programmeTypeByCode.get(programmeCode) ?? null
      : null;

    if (!programmeType) {
      return assignment;
    }

    return {
      ...assignment,
      programme_type: programmeType,
    };
  });
}

function buildLoadingGroupKey(row: {
  teacher_name: string;
  academic_year: string;
  module_term: string;
  teaching_status: string;
  teacher_employment_type: string | null;
}) {
  return [
    row.teacher_name,
    row.academic_year,
    row.module_term,
    row.teaching_status,
    row.teacher_employment_type ?? "",
  ].join("|");
}

function getMaxConfirmedVersion(assignments: TeachingAssignmentRow[]) {
  const versions = assignments
    .map((assignment) => Number(assignment.assignment_version ?? 0))
    .filter((version) => Number.isFinite(version) && version > 0);

  if (versions.length === 0) {
    return null;
  }

  return Math.max(...versions);
}

/**
 * 根据 teaching_assignments 计算 actual loading。
 *
 * 保留原本 combine / split 的计算逻辑：
 * - natural_same_module_code / manual combine 会避免重复计算
 * - TBC 不计入 loading
 */
export function calculateActualLoadingFromAssignments(
  assignments: TeachingAssignmentRow[]
) {
  const countedKeys = new Set<string>();
  const loadingMap = new Map<string, LoadingResult>();

  for (const assignment of assignments) {
    if (!assignment.confirmed) continue;

    if (isTBC(assignment.teacher_name)) {
      continue;
    }

    const teacherName = normalizeText(assignment.teacher_name);

    if (!teacherName) {
      continue;
    }

    const moduleTerm = normalizeModuleTerm(assignment.module_term);
    const teachingStatus = normalizeTeachingStatus(assignment.teaching_status);
    const teacherEmploymentType = normalizeEmploymentType(
      assignment.teacher_employment_type
    );

    const isCombined =
      assignment.combine_type === "natural_same_module_code" ||
      assignment.combine_type === "manual";

    const combinedCode = normalizeText(assignment.combined_code);
    const moduleInstanceCode = normalizeText(assignment.module_instance_code);

    const isSplitCombined =
      isCombined &&
      Boolean(combinedCode) &&
      moduleInstanceCode !== combinedCode;

    let countKey: string;

    if (isCombined && !isSplitCombined) {
      countKey = [
        teacherName,
        combinedCode,
        moduleTerm,
        teachingStatus,
      ].join("|");
    } else if (isCombined && isSplitCombined) {
      countKey = [
        teacherName,
        combinedCode,
        moduleInstanceCode,
        moduleTerm,
        teachingStatus,
      ].join("|");
    } else {
      countKey = [
        teacherName,
        moduleInstanceCode,
        moduleTerm,
        teachingStatus,
      ].join("|");
    }

    if (countedKeys.has(countKey)) {
      continue;
    }

    countedKeys.add(countKey);

    const loadingKey = [
      teacherName,
      assignment.academic_year,
      moduleTerm,
      teachingStatus,
      teacherEmploymentType ?? "",
    ].join("|");

    if (!loadingMap.has(loadingKey)) {
      loadingMap.set(loadingKey, {
        teacher_name: teacherName,
        academic_year: assignment.academic_year,
        module_term: moduleTerm,
        teaching_status: teachingStatus,
        teacher_employment_type: teacherEmploymentType,
        actual_loading: 0,
        hd_module_count: 0,
        degree_module_count: 0,
      });
    }

    const row = loadingMap.get(loadingKey)!;

    row.actual_loading += 1;

    if (isHDProgramme(assignment.programme_type)) {
      row.hd_module_count += 1;
    }

    if (isDegreeProgramme(assignment.programme_type)) {
      row.degree_module_count += 1;
    }
  }

  return [...loadingMap.values()];
}

function latestConfirmedAssignmentByModuleId(
  assignments: TeachingAssignmentRow[]
): Map<string, TeachingAssignmentRow> {
  const map = new Map<string, TeachingAssignmentRow>();

  for (const assignment of assignments) {
    if (!assignment.confirmed) {
      continue;
    }

    const moduleId = assignment.timetable_module_id;
    const existing = map.get(moduleId);
    const version = Number(assignment.assignment_version ?? 0);
    const existingVersion = Number(existing?.assignment_version ?? 0);

    if (!existing || version >= existingVersion) {
      map.set(moduleId, assignment);
    }
  }

  return map;
}

function resolveTeacherNameFromTimetable(params: {
  moduleId: string;
  moduleInstanceCode: string;
  sessions: TimetableSessionRow[];
  instanceTeacherByCode: Map<string, string>;
  assignment?: TeachingAssignmentRow;
}): string {
  const moduleSessions = params.sessions.filter(
    (session) =>
      session.timetable_module_id === params.moduleId &&
      session.status !== "cancel"
  );

  for (const session of moduleSessions) {
    const teacherName = normalizeText(session.teacher_name);

    if (teacherName && !isTBC(teacherName)) {
      return teacherName;
    }
  }

  const instanceTeacher = normalizeText(
    params.instanceTeacherByCode.get(params.moduleInstanceCode)
  );

  if (instanceTeacher && !isTBC(instanceTeacher)) {
    return instanceTeacher;
  }

  const assignmentTeacher = normalizeText(params.assignment?.teacher_name);

  if (assignmentTeacher && !isTBC(assignmentTeacher)) {
    return assignmentTeacher;
  }

  return "";
}

function buildLoadingAssignmentFromModule(params: {
  module: TimetableModuleRow;
  teacherName: string;
  assignment?: TeachingAssignmentRow;
  programmeType: string | null;
  teachers: TeacherRow[];
}): TeachingAssignmentRow | null {
  const canonicalName = canonicalizeTeacherNameForLoading(
    params.teacherName,
    params.teachers
  );
  const teacherName = normalizeText(canonicalName);

  if (!teacherName || isTBC(teacherName)) {
    return null;
  }

  const assignment = params.assignment;
  const catalogEmployment = resolveTeacherEmploymentFromCatalog(
    teacherName,
    params.teachers
  );
  const rowEmployment = normalizeEmploymentType(
    assignment?.teacher_employment_type
  );

  return {
    id: assignment?.id ?? "",
    timetable_module_id: params.module.id,
    academic_year: params.module.academic_year,
    teacher_name: teacherName,
    teacher_title: assignment?.teacher_title ?? null,
    teacher_family_name: assignment?.teacher_family_name ?? null,
    teacher_other_name: assignment?.teacher_other_name ?? null,
    teacher_employment_type:
      rowEmployment === "FT" || rowEmployment === "PT"
        ? rowEmployment
        : catalogEmployment,
    teaching_status: assignment?.teaching_status ?? "FT",
    programme_type:
      assignment?.programme_type ?? params.programmeType ?? null,
    combined_code: params.module.combined_code,
    combine_type: params.module.combine_type,
    module_instance_code: params.module.module_instance_code,
    module_term: params.module.module_term,
    assignment_version: assignment?.assignment_version ?? 1,
    confirmed: true,
    confirmed_at: assignment?.confirmed_at ?? null,
    updated_by: assignment?.updated_by ?? null,
    created_at: assignment?.created_at ?? "",
    updated_at: assignment?.updated_at ?? "",
  };
}

function enrichAssignmentForLoading(
  assignment: TeachingAssignmentRow,
  teachers: TeacherRow[]
): TeachingAssignmentRow {
  const canonicalName = canonicalizeTeacherNameForLoading(
    assignment.teacher_name,
    teachers
  );
  const rowEmployment = normalizeEmploymentType(
    assignment.teacher_employment_type
  );
  const catalogEmployment = resolveTeacherEmploymentFromCatalog(
    canonicalName,
    teachers
  );

  return {
    ...assignment,
    teacher_name: canonicalName,
    teacher_employment_type:
      rowEmployment === "FT" || rowEmployment === "PT"
        ? rowEmployment
        : catalogEmployment,
  };
}

async function loadProgrammeTypeByCode(programmeCodes: string[]) {
  const programmeTypeByCode = new Map<string, string | null>();

  if (programmeCodes.length === 0) {
    return programmeTypeByCode;
  }

  const { data: programmes, error: programmesError } = await supabase
    .from("programmes")
    .select("programme_code, programme_type")
    .in("programme_code", programmeCodes);

  if (programmesError) {
    throw programmesError;
  }

  for (const programme of programmes ?? []) {
    programmeTypeByCode.set(
      programme.programme_code,
      programme.programme_type ?? null
    );
  }

  return programmeTypeByCode;
}

/**
 * Hybrid loading source:
 * - Sep/Feb modules with timetable sessions → teacher from timetable
 * - Otherwise (incl. Jun) → confirmed teaching_assignments
 */
async function buildHybridLoadingAssignments(
  academicYear: string
): Promise<TeachingAssignmentRow[]> {
  const [
    { data: assignmentData, error: assignmentError },
    modules,
    scheduledModuleIds,
    sessions,
    instances,
    teachers,
  ] = await Promise.all([
    supabase
      .from("teaching_assignments")
      .select("*")
      .eq("academic_year", academicYear)
      .eq("confirmed", true),
    listTimetableModules({ academicYear }),
    listScheduledTimetableModuleIds({ academicYear }),
    listTimetableSessions({ academicYear }),
    listTimetableModuleInstances({ academicYear }),
    listTeachers(academicYear),
  ]);

  if (assignmentError) {
    throw assignmentError;
  }

  const enrichedAssignments = await enrichAssignmentsWithProgrammeType(
    (assignmentData ?? []) as TeachingAssignmentRow[]
  );

  const assignmentByModuleId =
    latestConfirmedAssignmentByModuleId(enrichedAssignments);

  const programmeCodes = [
    ...new Set(
      modules
        .map((module) => normalizeText(module.programme_code))
        .filter(Boolean)
    ),
  ];

  const programmeTypeByCode = await loadProgrammeTypeByCode(programmeCodes);

  const instanceTeacherByCode = new Map<string, string>();

  for (const instance of instances) {
    const code = normalizeText(instance.module_instance_code);
    const teacher = normalizeText(instance.instance_teacher_name);

    if (code && teacher) {
      instanceTeacherByCode.set(code, teacher);
    }
  }

  const hybridRows: TeachingAssignmentRow[] = [];
  const processedModuleIds = new Set<string>();

  for (const module of modules) {
    const assignment = assignmentByModuleId.get(module.id);
    const useTimetable =
      module.module_term !== "Jun" && scheduledModuleIds.has(module.id);

    if (useTimetable) {
      const teacherName = resolveTeacherNameFromTimetable({
        moduleId: module.id,
        moduleInstanceCode: module.module_instance_code,
        sessions,
        instanceTeacherByCode,
        assignment,
      });

      const row = buildLoadingAssignmentFromModule({
        module,
        teacherName,
        assignment,
        programmeType: programmeTypeByCode.get(module.programme_code) ?? null,
        teachers,
      });

      if (row) {
        hybridRows.push(row);
      }

      processedModuleIds.add(module.id);
      continue;
    }

    if (assignment) {
      hybridRows.push(enrichAssignmentForLoading(assignment, teachers));
      processedModuleIds.add(module.id);
    }
  }

  for (const assignment of enrichedAssignments) {
    if (processedModuleIds.has(assignment.timetable_module_id)) {
      continue;
    }

    hybridRows.push(enrichAssignmentForLoading(assignment, teachers));
  }

  return hybridRows;
}

/**
 * 旧接口保留。
 *
 * 注意：
 * Programme Leader 的 confirmAssignments 不应再调用这个函数。
 * Admin 应通过 updateTeacherLoading() 生成 teacher_actual_loading。
 */
export async function recalculateActualLoading(params: {
  academicYear: string;
  confirmedBy: string | null;
  sourceConfirmedVersion: number;
}) {
  const { data: assignments, error } = await supabase
    .from("teaching_assignments")
    .select("*")
    .eq("academic_year", params.academicYear)
    .eq("confirmed", true)
    .eq("assignment_version", params.sourceConfirmedVersion);

  if (error) throw error;

  const hybridAssignments = await buildHybridLoadingAssignments(
    params.academicYear
  );

  const calculated = calculateActualLoadingFromAssignments(hybridAssignments);

  const { error: deleteError } = await supabase
    .from("teacher_actual_loading")
    .delete()
    .eq("academic_year", params.academicYear);

  if (deleteError) throw deleteError;

  if (calculated.length === 0) {
    return [];
  }

  const now = new Date().toISOString();

  const payload = calculated.map((row) => ({
    teacher_name: row.teacher_name,
    academic_year: row.academic_year,
    module_term: row.module_term,
    teaching_status: row.teaching_status,
    teacher_employment_type: row.teacher_employment_type,
    actual_loading: row.actual_loading,
    hd_module_count: row.hd_module_count,
    degree_module_count: row.degree_module_count,
    source_confirmed_version: params.sourceConfirmedVersion,
    confirmed_by: params.confirmedBy,
    confirmed_at: now,
    updated_at: now,
  }));

  const { data, error: insertError } = await supabase
    .from("teacher_actual_loading")
    .insert(payload)
    .select("*");

  if (insertError) throw insertError;

  const { error: runError } = await supabase
    .from("teacher_loading_runs")
    .insert({
      academic_year: params.academicYear,
      status: "completed",
      generated_by: params.confirmedBy,
      notes: "Teacher actual loading regenerated from confirmed teaching assignments.",
    });

  if (runError) throw runError;

  return (data ?? []) as TeacherActualLoadingRow[];
}

/**
 * Admin Monitor 页面使用的正式生成函数。
 *
 * 业务规则：
 * 1. 必须所有 timetable_modules.assignment_confirmed = true
 * 2. confirmed modules 不能有 TBC / empty teacher
 * 3. 删除当前 academic year 的旧 teacher_actual_loading
 * 4. 根据 confirmed teaching_assignments 重新生成 aggregate loading
 * 5. 插入 teacher_loading_runs
 */
export async function updateTeacherLoading(
  params: UpdateTeacherLoadingParams
): Promise<UpdateTeacherLoadingResult> {
  if (!params.academicYear) {
    throw new Error("Academic year is required.");
  }

  const monitor = await getAssignmentConfirmationMonitor(params.academicYear);

  if (!monitor.summary.allSplitComplete) {
    throw new Error(
      `Cannot update teacher loading. ${monitor.summary.pendingSplitModules} planning module(s) have not completed split yet.`
    );
  }

  if (monitor.summary.modulesWithTbcTeacher > 0) {
    throw new Error(
      `Cannot update teacher loading. ${monitor.summary.modulesWithTbcTeacher} split-confirmed module(s) still have TBC or empty teacher.`
    );
  }

  let query = supabase
    .from("teaching_assignments")
    .select("*")
    .eq("academic_year", params.academicYear)
    .eq("confirmed", true);

  if (typeof params.sourceConfirmedVersion === "number") {
    query = query.eq("assignment_version", params.sourceConfirmedVersion);
  }

  const { data: assignments, error } = await query;

  if (error) throw error;

  const assignmentRows = (assignments ?? []) as TeachingAssignmentRow[];

  if (assignmentRows.length === 0) {
    throw new Error("No confirmed teaching assignments found.");
  }

  const hybridAssignments = await buildHybridLoadingAssignments(
    params.academicYear
  );

  if (hybridAssignments.length === 0) {
    throw new Error("No valid teacher loading rows generated.");
  }

  const sourceConfirmedVersion =
    params.sourceConfirmedVersion ?? getMaxConfirmedVersion(assignmentRows);

  const calculated = calculateActualLoadingFromAssignments(hybridAssignments);

  if (calculated.length === 0) {
    throw new Error("No valid teacher loading rows generated.");
  }

  const normalizedMap = new Map<string, LoadingResult>();

  for (const row of calculated) {
    const normalizedRow: LoadingResult = {
      teacher_name: normalizeText(row.teacher_name),
      academic_year: params.academicYear,
      module_term: normalizeModuleTerm(row.module_term),
      teaching_status: normalizeTeachingStatus(row.teaching_status),
      teacher_employment_type: normalizeEmploymentType(
        row.teacher_employment_type
      ),
      actual_loading: Number(row.actual_loading ?? 0),
      hd_module_count: Number(row.hd_module_count ?? 0),
      degree_module_count: Number(row.degree_module_count ?? 0),
    };

    if (!normalizedRow.teacher_name || isTBC(normalizedRow.teacher_name)) {
      continue;
    }

    const key = buildLoadingGroupKey(normalizedRow);
    const existing = normalizedMap.get(key);

    if (!existing) {
      normalizedMap.set(key, normalizedRow);
    } else {
      existing.actual_loading += normalizedRow.actual_loading;
      existing.hd_module_count += normalizedRow.hd_module_count;
      existing.degree_module_count += normalizedRow.degree_module_count;
    }
  }

  const rowsToInsert = [...normalizedMap.values()];

  if (rowsToInsert.length === 0) {
    throw new Error("No teacher loading rows generated after normalization.");
  }

  const { error: deleteError } = await supabase
    .from("teacher_actual_loading")
    .delete()
    .eq("academic_year", params.academicYear);

  if (deleteError) throw deleteError;

  const now = new Date().toISOString();

  const payload = rowsToInsert.map((row) => ({
    teacher_name: row.teacher_name,
    academic_year: row.academic_year,
    module_term: row.module_term,
    teaching_status: row.teaching_status,
    teacher_employment_type: row.teacher_employment_type,
    actual_loading: row.actual_loading,
    hd_module_count: row.hd_module_count,
    degree_module_count: row.degree_module_count,
    source_confirmed_version: sourceConfirmedVersion,
    confirmed_by: params.updatedBy ?? null,
    confirmed_at: now,
    updated_at: now,
  }));

  const { error: insertError } = await supabase
    .from("teacher_actual_loading")
    .insert(payload);

  if (insertError) throw insertError;

  const { error: runError } = await supabase
    .from("teacher_loading_runs")
    .insert({
      academic_year: params.academicYear,
      status: "completed",
      generated_by: params.updatedBy ?? null,
      notes: "Teacher actual loading regenerated from confirmed teaching assignments.",
    });

  if (runError) throw runError;

  return {
    insertedCount: payload.length,
    sourceConfirmedVersion,
  };
}

export async function hasCompletedTeacherLoadingRun(
  academicYear: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("teacher_loading_runs")
    .select("id")
    .eq("academic_year", academicYear)
    .eq("status", "completed")
    .limit(1);

  if (error) {
    const code = String((error as { code?: string }).code ?? "");
    const message = String(error.message ?? "");

    if (
      code === "42P01" ||
      code === "PGRST205" ||
      message.includes("teacher_loading_runs")
    ) {
      return false;
    }

    throw error;
  }

  return Boolean(data && data.length > 0);
}

export async function listTeacherActualLoading(params: {
  academicYear: string;
  teachingStatus?: "FT" | "PT";
}) {
  let query = supabase
    .from("teacher_actual_loading")
    .select("*")
    .eq("academic_year", params.academicYear)
    .order("teacher_name")
    .order("module_term");

  if (params.teachingStatus) {
    query = query.eq("teaching_status", params.teachingStatus);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []) as TeacherActualLoadingRow[];
}

export interface TeacherLoadingSummaryRow {
  teacher_name: string;
  teacher_employment_type: string | null;
  teaching_status: "FT" | "PT";
  sep_actual_loading: number;
  feb_actual_loading: number;
  jun_actual_loading: number;
  annual_actual_loading: number;
  sep_hd_module_count: number;
  sep_degree_module_count: number;
  feb_hd_module_count: number;
  feb_degree_module_count: number;
  jun_hd_module_count: number;
  jun_degree_module_count: number;
  hd_module_count: number;
  degree_module_count: number;
}

type TeacherLoadingSourceRow = Pick<
  TeacherActualLoadingRow,
  | "teacher_name"
  | "module_term"
  | "teaching_status"
  | "teacher_employment_type"
  | "actual_loading"
  | "hd_module_count"
  | "degree_module_count"
>;

function createEmptyTeacherLoadingSummary(
  teacherName: string,
  row: TeacherLoadingSourceRow,
  employmentType: "FT" | "PT"
): TeacherLoadingSummaryRow {
  return {
    teacher_name: teacherName,
    teacher_employment_type: row.teacher_employment_type ?? employmentType,
    teaching_status: employmentType,
    sep_actual_loading: 0,
    feb_actual_loading: 0,
    jun_actual_loading: 0,
    annual_actual_loading: 0,
    sep_hd_module_count: 0,
    sep_degree_module_count: 0,
    feb_hd_module_count: 0,
    feb_degree_module_count: 0,
    jun_hd_module_count: 0,
    jun_degree_module_count: 0,
    hd_module_count: 0,
    degree_module_count: 0,
  };
}

function recomputeTeacherLoadingTotals(summary: TeacherLoadingSummaryRow) {
  summary.annual_actual_loading =
    summary.sep_actual_loading +
    summary.feb_actual_loading +
    summary.jun_actual_loading;
  summary.hd_module_count =
    summary.sep_hd_module_count +
    summary.feb_hd_module_count +
    summary.jun_hd_module_count;
  summary.degree_module_count =
    summary.sep_degree_module_count +
    summary.feb_degree_module_count +
    summary.jun_degree_module_count;
}

function matchesTeacherEmploymentFilter(
  row: TeacherLoadingSourceRow,
  employmentType: "FT" | "PT",
  teachers: TeacherRow[]
): boolean {
  const catalogEmployment = resolveTeacherEmploymentFromCatalog(
    row.teacher_name,
    teachers
  );

  if (catalogEmployment === "FT" || catalogEmployment === "PT") {
    return catalogEmployment === employmentType;
  }

  const rowEmployment = normalizeEmploymentType(row.teacher_employment_type);

  if (rowEmployment === "FT" || rowEmployment === "PT") {
    return rowEmployment === employmentType;
  }

  return normalizeTeachingStatus(row.teaching_status) === employmentType;
}

function buildTeacherLoadingSummary(
  rows: TeacherLoadingSourceRow[],
  employmentType: "FT" | "PT",
  teachers: TeacherRow[]
): TeacherLoadingSummaryRow[] {
  const map = new Map<string, TeacherLoadingSummaryRow>();

  for (const row of rows) {
    if (isTBC(row.teacher_name)) {
      continue;
    }

    const teacherName = canonicalizeTeacherNameForLoading(
      normalizeText(row.teacher_name),
      teachers
    );

    if (!teacherName) {
      continue;
    }

    if (!matchesTeacherEmploymentFilter(row, employmentType, teachers)) {
      continue;
    }

    if (!map.has(teacherName)) {
      map.set(
        teacherName,
        createEmptyTeacherLoadingSummary(teacherName, row, employmentType)
      );
      const summary = map.get(teacherName)!;
      const catalogEmployment = resolveTeacherEmploymentFromCatalog(
        teacherName,
        teachers
      );
      if (catalogEmployment) {
        summary.teacher_employment_type = catalogEmployment;
      }
    }

    const summary = map.get(teacherName)!;
    const moduleTerm = normalizeModuleTerm(row.module_term);
    const actualLoading = Number(row.actual_loading ?? 0);
    const hdModuleCount = Number(row.hd_module_count ?? 0);
    const degreeModuleCount = Number(row.degree_module_count ?? 0);

    if (moduleTerm === "Sep") {
      summary.sep_actual_loading += actualLoading;
      summary.sep_hd_module_count += hdModuleCount;
      summary.sep_degree_module_count += degreeModuleCount;
    } else if (moduleTerm === "Feb") {
      summary.feb_actual_loading += actualLoading;
      summary.feb_hd_module_count += hdModuleCount;
      summary.feb_degree_module_count += degreeModuleCount;
    } else {
      summary.jun_actual_loading += actualLoading;
      summary.jun_hd_module_count += hdModuleCount;
      summary.jun_degree_module_count += degreeModuleCount;
    }

    recomputeTeacherLoadingTotals(summary);
  }

  return [...map.values()].sort((a, b) =>
    a.teacher_name.localeCompare(b.teacher_name)
  );
}

async function loadTeacherLoadingSourceRows(params: {
  academicYear: string;
}): Promise<TeacherLoadingSourceRow[]> {
  const hybridAssignments = await buildHybridLoadingAssignments(
    params.academicYear
  );

  return calculateActualLoadingFromAssignments(hybridAssignments).map(
    (row) => ({
      teacher_name: row.teacher_name,
      module_term: row.module_term,
      teaching_status: row.teaching_status,
      teacher_employment_type: row.teacher_employment_type,
      actual_loading: row.actual_loading,
      hd_module_count: row.hd_module_count,
      degree_module_count: row.degree_module_count,
    })
  );
}

export async function getTeacherLoadingSummary(params: {
  academicYear: string;
  employmentType: "FT" | "PT";
}) {
  const [rows, teachers] = await Promise.all([
    loadTeacherLoadingSourceRows({
      academicYear: params.academicYear,
    }),
    listTeachers(params.academicYear),
  ]);

  return buildTeacherLoadingSummary(
    rows,
    params.employmentType,
    teachers
  );
}
