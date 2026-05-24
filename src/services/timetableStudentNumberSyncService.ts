import { supabase } from "../lib/supabase";
import {
  getAcademicYearVariants,
  normalizeStream,
  offeredTermToStudyTerm,
} from "../lib/utils";
import { recalculateActualStudentNumbers } from "./studyPlanService";
import type { ModuleEnrollmentRow } from "./moduleEnrollmentService";
import {
  ensureTimetablePlanningModules,
  listPlanningModulesWithStudentNumbers,
} from "./timetableService";
import { listStudentNumbers } from "./studentNumberService";

function buildSyncKey(params: {
  academicYear: string;
  moduleCode: string;
  programmeCode: string;
  programmeStream: string;
  studyTerm: string;
}) {
  return [
    params.academicYear,
    params.moduleCode,
    params.programmeCode,
    params.programmeStream,
    params.studyTerm,
  ].join("|");
}

export interface SyncStudyPlanStudentNumbersResult {
  syncedCount: number;
  zeroActualCount: number;
}

export async function syncStudyPlanStudentNumbersToTimetable(params: {
  academicYear: string;
  programmeCode?: string;
  streamCode?: string;
  createdBy: string;
}): Promise<SyncStudyPlanStudentNumbersResult> {
  try {
    await recalculateActualStudentNumbers();
  } catch (error) {
    console.warn(
      "[syncStudyPlanStudentNumbersToTimetable] Could not recalculate study plan counts:",
      error
    );
  }

  await ensureTimetablePlanningModules({
    academicYear: params.academicYear,
    programmeCode: params.programmeCode,
    streamCode: params.streamCode,
    createdBy: params.createdBy,
  });

  const planningModules = await listPlanningModulesWithStudentNumbers({
    academicYear: params.academicYear,
    programmeCode: params.programmeCode,
    streamCode: params.streamCode,
  });

  if (planningModules.length === 0) {
    return {
      syncedCount: 0,
      zeroActualCount: 0,
    };
  }

  const yearVariants = getAcademicYearVariants(params.academicYear);

  const [{ data: studyPlanRows, error: studyPlanError }, existingRows, enrollmentResult] =
    await Promise.all([
      supabase
        .from("study_plan_actual_student_numbers")
        .select("*")
        .in("academic_year", yearVariants),
      listStudentNumbers(params.academicYear),
      supabase
        .from("module_enrollment")
        .select("*")
        .eq("academic_year", params.academicYear),
    ]);

  if (studyPlanError) throw studyPlanError;
  if (enrollmentResult.error) throw enrollmentResult.error;

  const actualByKey = new Map<string, number>();

  for (const row of studyPlanRows ?? []) {
    const studyTerm = String(row.study_term ?? "").trim();
    const key = buildSyncKey({
      academicYear: params.academicYear,
      moduleCode: row.module_code,
      programmeCode: row.programme_code,
      programmeStream: normalizeStream(row.programme_stream),
      studyTerm,
    });

    actualByKey.set(
      key,
      (actualByKey.get(key) ?? 0) + Number(row.actual_student_number ?? 0)
    );
  }

  const existingMap = new Map<string, (typeof existingRows)[number]>();

  for (const row of existingRows) {
    const studyTerm =
      String(row.study_term ?? "").trim() ||
      offeredTermToStudyTerm(row.academic_year, row.module_term ?? "");

    existingMap.set(
      buildSyncKey({
        academicYear: row.academic_year,
        moduleCode: row.module_code,
        programmeCode: row.programme_code,
        programmeStream: normalizeStream(row.programme_stream),
        studyTerm,
      }),
      row
    );
  }

  const enrollmentMap = new Map<
    string,
    { expected_student_number: number; actual_student_number: number | null }
  >();

  for (const row of (enrollmentResult.data ?? []) as ModuleEnrollmentRow[]) {
    const studyTerm = offeredTermToStudyTerm(
      row.academic_year,
      row.module_term ?? ""
    );

    enrollmentMap.set(
      buildSyncKey({
        academicYear: row.academic_year,
        moduleCode: row.module_code,
        programmeCode: row.programme_code ?? "",
        programmeStream: normalizeStream(row.stream_code),
        studyTerm,
      }),
      {
        expected_student_number: row.expected_student_number,
        actual_student_number: row.actual_student_number,
      }
    );
  }

  let zeroActualCount = 0;

  const payload = planningModules.map((module) => {
    const programmeStream = normalizeStream(module.stream_code);
    const studyTerm = offeredTermToStudyTerm(
      module.academic_year,
      module.module_term
    );

    const key = buildSyncKey({
      academicYear: module.academic_year,
      moduleCode: module.module_code,
      programmeCode: module.programme_code,
      programmeStream,
      studyTerm,
    });

    const existing = existingMap.get(key);
    const enrollment = enrollmentMap.get(key);
    const actual = actualByKey.get(key) ?? 0;

    if (actual === 0) {
      zeroActualCount += 1;
    }

    return {
      academic_year: module.academic_year,
      module_code: module.module_code,
      module_term: module.module_term,
      programme_code: module.programme_code,
      programme_stream: programmeStream,
      study_term: studyTerm,
      expected_student_number:
        existing?.expected_student_number ??
        enrollment?.expected_student_number ??
        0,
      actual_student_number: actual,
      created_by: params.createdBy,
    };
  });

  const { error: upsertError } = await supabase
    .from("timetable_student_numbers")
    .upsert(payload, {
      onConflict:
        "academic_year,module_code,programme_code,programme_stream,study_term",
    });

  if (upsertError) {
    const message = String(upsertError.message ?? upsertError);

    if (
      message.includes("programme_stream") ||
      message.includes("study_term") ||
      message.includes("on conflict")
    ) {
      throw new Error(
        "Could not save student numbers. Please run migration 003_drop_all_module_term_unique_constraints.sql in Supabase SQL Editor, then try again."
      );
    }

    throw upsertError;
  }

  return {
    syncedCount: payload.length,
    zeroActualCount,
  };
}
