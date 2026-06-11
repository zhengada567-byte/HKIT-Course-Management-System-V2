import { supabase } from "../lib/supabase";
import { fetchAllPaginatedRows } from "../lib/supabasePagination";
import {
  getAcademicYearVariants,
  hasSelectedTimetableStream,
  normalizeAcademicYear,
  normalizeStream,
  offeredTermToStudyTerm,
  timetableProgrammeStreamFromSelection,
} from "../lib/utils";
import { recalculateActualStudentNumbers } from "./studyPlanService";
import type { ModuleTerm } from "../types";
import type { ModuleEnrollmentRow } from "./moduleEnrollmentService";
import {
  ensureTimetablePlanningModules,
  listPlanningModulesWithStudentNumbers,
} from "./timetableService";
import {
  listStudentNumbers,
  resolveExpectedStudentNumberOnSync,
} from "./studentNumberService";

function buildSyncKey(params: {
  academicYear: string;
  moduleCode: string;
  programmeCode: string;
  programmeStream: string;
  studyTerm: string;
}) {
  return [
    normalizeAcademicYear(params.academicYear),
    params.moduleCode,
    params.programmeCode,
    normalizeStream(params.programmeStream),
    params.studyTerm,
  ].join("|");
}

function buildStudyPlanActualStreamKey(params: {
  academicYear: string;
  moduleCode: string;
  programmeCode: string;
  programmeStream: string;
  studyTerm: string;
}) {
  return buildSyncKey(params);
}

function buildStudyPlanActualAllStreamsKey(params: {
  academicYear: string;
  moduleCode: string;
  programmeCode: string;
  studyTerm: string;
}) {
  return [
    normalizeAcademicYear(params.academicYear),
    params.moduleCode,
    params.programmeCode,
    params.studyTerm,
  ].join("|");
}

function buildStudyPlanActualLookupMaps(params: {
  studyPlanRows: Record<string, unknown>[];
  canonicalYear: string;
  programmeCode?: string;
}) {
  const byStreamKey = new Map<string, number>();
  const byAllStreamsKey = new Map<string, number>();

  for (const row of params.studyPlanRows) {
    const programmeCode = String(row.programme_code ?? "").trim();

    if (
      params.programmeCode &&
      programmeCode !== params.programmeCode.trim()
    ) {
      continue;
    }

    const studyTerm = String(row.study_term ?? "").trim();

    if (!studyTerm) {
      continue;
    }

    const academicYear = normalizeAcademicYear(
      String(row.academic_year ?? params.canonicalYear)
    );
    const moduleCode = String(row.module_code ?? "").trim();
    const programmeStream = normalizeStream(
      String(row.programme_stream ?? "").trim()
    );
    const count = Number(row.actual_student_number ?? 0);

    const streamKey = buildStudyPlanActualStreamKey({
      academicYear,
      moduleCode,
      programmeCode,
      programmeStream,
      studyTerm,
    });

    byStreamKey.set(streamKey, (byStreamKey.get(streamKey) ?? 0) + count);

    const allStreamsKey = buildStudyPlanActualAllStreamsKey({
      academicYear,
      moduleCode,
      programmeCode,
      studyTerm,
    });

    byAllStreamsKey.set(
      allStreamsKey,
      (byAllStreamsKey.get(allStreamsKey) ?? 0) + count
    );
  }

  return { byStreamKey, byAllStreamsKey };
}

function getStudyPlanActualForTimetable(params: {
  maps: ReturnType<typeof buildStudyPlanActualLookupMaps>;
  selectedStreamCode?: string;
  academicYear: string;
  moduleCode: string;
  programmeCode: string;
  studyTerm: string;
}) {
  const academicYear = normalizeAcademicYear(params.academicYear);

  if (hasSelectedTimetableStream(params.selectedStreamCode)) {
    const programmeStream = timetableProgrammeStreamFromSelection(
      params.selectedStreamCode
    );

    return (
      params.maps.byStreamKey.get(
        buildStudyPlanActualStreamKey({
          academicYear,
          moduleCode: params.moduleCode,
          programmeCode: params.programmeCode,
          programmeStream,
          studyTerm: params.studyTerm,
        })
      ) ?? 0
    );
  }

  return (
    params.maps.byAllStreamsKey.get(
      buildStudyPlanActualAllStreamsKey({
        academicYear,
        moduleCode: params.moduleCode,
        programmeCode: params.programmeCode,
        studyTerm: params.studyTerm,
      })
    ) ?? 0
  );
}

export interface SyncStudyPlanStudentNumbersResult {
  syncedCount: number;
  zeroActualCount: number;
}

export async function syncStudyPlanStudentNumbersToTimetable(params: {
  academicYear: string;
  programmeCode?: string;
  streamCode?: string;
  moduleTerm?: ModuleTerm;
  createdBy: string;
}): Promise<SyncStudyPlanStudentNumbersResult> {
  const canonicalYear = normalizeAcademicYear(params.academicYear);
  const timetableStream = timetableProgrammeStreamFromSelection(
    params.streamCode
  );

  await recalculateActualStudentNumbers();

  await ensureTimetablePlanningModules({
    academicYear: canonicalYear,
    programmeCode: params.programmeCode,
    streamCode: params.streamCode,
    moduleTerm: params.moduleTerm,
    createdBy: params.createdBy,
  });

  const planningModules = await listPlanningModulesWithStudentNumbers({
    academicYear: canonicalYear,
    programmeCode: params.programmeCode,
    streamCode: params.streamCode,
    moduleTerm: params.moduleTerm,
  });

  if (planningModules.length === 0) {
    return {
      syncedCount: 0,
      zeroActualCount: 0,
    };
  }

  const yearVariants = getAcademicYearVariants(canonicalYear);

  const [studyPlanRows, existingRows, enrollmentResult] = await Promise.all([
    fetchAllPaginatedRows<Record<string, unknown>>({
      fetchPage: ({ from, to }) =>
        supabase
          .from("study_plan_actual_student_numbers")
          .select("*")
          .in("academic_year", yearVariants)
          .order("id", { ascending: true })
          .range(from, to),
    }),
    listStudentNumbers(canonicalYear),
    supabase
      .from("module_enrollment")
      .select("*")
      .in("academic_year", yearVariants),
  ]);

  if (enrollmentResult.error) throw enrollmentResult.error;

  const actualMaps = buildStudyPlanActualLookupMaps({
    studyPlanRows,
    canonicalYear,
    programmeCode: params.programmeCode,
  });

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

  const payloadMap = new Map<
    string,
    {
      academic_year: string;
      module_code: string;
      module_term: string | null;
      programme_code: string;
      programme_stream: string;
      study_term: string;
      expected_student_number: number;
      actual_student_number: number;
      created_by: string;
    }
  >();

  for (const module of planningModules) {
    const studyTerm = offeredTermToStudyTerm(
      module.academic_year,
      module.module_term
    );

    const key = buildSyncKey({
      academicYear: module.academic_year,
      moduleCode: module.module_code,
      programmeCode: module.programme_code,
      programmeStream: timetableStream,
      studyTerm,
    });

    const existing = existingMap.get(key);
    const enrollment = enrollmentMap.get(key);
    const actual = getStudyPlanActualForTimetable({
      maps: actualMaps,
      selectedStreamCode: params.streamCode,
      academicYear: module.academic_year,
      moduleCode: module.module_code,
      programmeCode: module.programme_code,
      studyTerm,
    });

    const expected = resolveExpectedStudentNumberOnSync({
      existingExpected:
        existing?.expected_student_number ??
        enrollment?.expected_student_number,
      existingActual:
        existing?.actual_student_number ??
        enrollment?.actual_student_number,
      newActual: actual,
    });

    const previous = payloadMap.get(key);

    if (!previous) {
      payloadMap.set(key, {
        academic_year: canonicalYear,
        module_code: module.module_code,
        module_term: module.module_term,
        programme_code: module.programme_code,
        programme_stream: timetableStream,
        study_term: studyTerm,
        expected_student_number: expected,
        actual_student_number: actual,
        created_by: params.createdBy,
      });
      continue;
    }

    // De-duplicate within the same upsert batch.
    // This commonly happens when "All Streams" is selected but planning modules
    // are present per-stream in the source table(s).
    payloadMap.set(key, {
      ...previous,
      expected_student_number: Math.max(previous.expected_student_number, expected),
      actual_student_number: Math.max(previous.actual_student_number, actual),
    });
  }

  const payload = Array.from(payloadMap.values());

  zeroActualCount = payload.filter((row) => row.actual_student_number === 0).length;

  const { error: upsertError } = await supabase
    .from("timetable_student_numbers")
    .upsert(payload, {
      onConflict:
        "academic_year,module_code,programme_code,programme_stream,study_term",
    });

  if (upsertError) {
    const message = String(upsertError.message ?? upsertError);

    if (message.includes("created_by") || message.includes("foreign key")) {
      throw new Error(
        "Could not save student numbers because the login session is invalid. Please log out and log in again."
      );
    }

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
