// src/services/loadingService.ts

import { supabase } from "../lib/supabase";
import { isTBC } from "../lib/utils";
import type {
  TeachingAssignmentRow,
  TeacherActualLoadingRow,
} from "../types";
import { getAssignmentConfirmationMonitor } from "./adminAssignmentMonitorService";

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

function normalizeProgrammeType(value: string | null | undefined): string {
  return normalizeText(value).toUpperCase();
}

function isHDProgramme(value: string | null | undefined): boolean {
  const normalized = normalizeProgrammeType(value);
  return normalized === "HD" || normalized === "HIGHER DIPLOMA";
}

function isDegreeProgramme(value: string | null | undefined): boolean {
  const normalized = normalizeProgrammeType(value);

  return (
    normalized === "DEGREE" ||
    normalized === "UG" ||
    normalized === "UNDERGRADUATE"
  );
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

  const assignmentRows = (assignments ?? []) as TeachingAssignmentRow[];

  const calculated = calculateActualLoadingFromAssignments(assignmentRows);

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

  const sourceConfirmedVersion =
    params.sourceConfirmedVersion ?? getMaxConfirmedVersion(assignmentRows);

  const calculated = calculateActualLoadingFromAssignments(assignmentRows);

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
  previous_year_annual_actual_loading: number;
  hd_module_count: number;
  degree_module_count: number;
  sep_approved_loading?: number;
  feb_approved_loading?: number;
  jun_approved_loading?: number;
  annual_approved_loading?: number;
}

export async function getTeacherLoadingSummary(params: {
  academicYear: string;
  previousAcademicYear: string;
  teachingStatus: "FT" | "PT";
}) {
  const [
    { data: currentData, error: currentError },
    { data: previousData, error: previousError },
    { data: approvedData, error: approvedError },
  ] = await Promise.all([
    supabase
      .from("teacher_actual_loading")
      .select("*")
      .eq("academic_year", params.academicYear)
      .eq("teaching_status", params.teachingStatus),
    supabase
      .from("teacher_actual_loading")
      .select("*")
      .eq("academic_year", params.previousAcademicYear)
      .eq("teaching_status", params.teachingStatus),
    supabase
      .from("approved_loadings")
      .select("*")
      .eq("academic_year", params.academicYear),
  ]);

  if (currentError) throw currentError;
  if (previousError) throw previousError;
  if (approvedError) throw approvedError;

  const currentRows = (currentData ?? []) as TeacherActualLoadingRow[];
  const previousRows = (previousData ?? []) as TeacherActualLoadingRow[];

  const map = new Map<string, TeacherLoadingSummaryRow>();

  for (const row of currentRows) {
    if (!map.has(row.teacher_name)) {
      map.set(row.teacher_name, {
        teacher_name: row.teacher_name,
        teacher_employment_type: row.teacher_employment_type,
        teaching_status: row.teaching_status,
        sep_actual_loading: 0,
        feb_actual_loading: 0,
        jun_actual_loading: 0,
        annual_actual_loading: 0,
        previous_year_annual_actual_loading: 0,
        hd_module_count: 0,
        degree_module_count: 0,
      });
    }

    const summary = map.get(row.teacher_name)!;

    if (row.module_term === "Sep") {
      summary.sep_actual_loading += Number(row.actual_loading);
    }

    if (row.module_term === "Feb") {
      summary.feb_actual_loading += Number(row.actual_loading);
    }

    if (row.module_term === "Jun") {
      summary.jun_actual_loading += Number(row.actual_loading);
    }

    summary.annual_actual_loading =
      summary.sep_actual_loading +
      summary.feb_actual_loading +
      summary.jun_actual_loading;

    summary.hd_module_count += Number(row.hd_module_count ?? 0);
    summary.degree_module_count += Number(row.degree_module_count ?? 0);
  }

  for (const row of previousRows) {
    if (!map.has(row.teacher_name)) {
      continue;
    }

    const summary = map.get(row.teacher_name)!;

    summary.previous_year_annual_actual_loading += Number(row.actual_loading);
  }

  if (params.teachingStatus === "FT") {
    for (const row of approvedData ?? []) {
      const summary = map.get(row.teacher_name);

      if (!summary) continue;

      summary.sep_approved_loading = Number(
        row.sep_term_approved_max_loading ?? 0
      );
      summary.feb_approved_loading = Number(
        row.feb_term_approved_max_loading ?? 0
      );
      summary.jun_approved_loading = Number(
        row.jun_term_approved_max_loading ?? 0
      );
      summary.annual_approved_loading =
        summary.sep_approved_loading +
        summary.feb_approved_loading +
        summary.jun_approved_loading;
    }
  }

  return [...map.values()].sort((a, b) =>
    a.teacher_name.localeCompare(b.teacher_name)
  );
}
