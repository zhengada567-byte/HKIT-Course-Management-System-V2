import { supabase } from "../lib/supabase";
import {
  getAcademicYearVariants,
  normalizeAcademicYear,
  normalizeStream,
  offeredTermToStudyTerm,
  timetableProgrammeStreamFromSelection,
} from "../lib/utils";
import type {
  TimetablePlanningModuleRow,
  TimetableStudentNumberRow,
} from "../types";
import type { ModuleEnrollmentRow } from "./moduleEnrollmentService";

/**
 * Option B: keep PL-edited expected; otherwise default expected to actual on sync/load.
 */
export function resolveExpectedStudentNumberOnSync(params: {
  existingExpected: number | null | undefined;
  existingActual: number | null | undefined;
  newActual: number;
}) {
  const expected = params.existingExpected;

  if (expected === null || expected === undefined) {
    return params.newActual;
  }

  if (expected === 0) {
    return params.newActual;
  }

  const previousActual = Number(params.existingActual ?? 0);

  if (expected === previousActual) {
    return params.newActual;
  }

  return expected;
}

export interface StudentNumberInputRow {
  academic_year: string;
  module_code: string;
  module_name: string | null;
  /** Catalog offered term from modules / planning (Sep, Feb, Jun). */
  module_term: string | null;
  programme_code: string;
  programme_stream: string;
  /** Actual run / intake term (T2025A, T2025B, ...). */
  study_term: string;
  streams_included: string[];
  /** All active planning rows aggregated into this display row. */
  planning_module_ids: string[];
  expected_student_number: number | null;
  actual_student_number: number | null;
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function normalizeKeyPart(value: string | null | undefined) {
  return normalizeText(value).toLowerCase();
}

function normalizeStreamKey(value: string | null | undefined) {
  const text = normalizeText(value).toLowerCase();

  return text === "" ? "nil" : text;
}

function isCommonStream(streamCode: string | null | undefined) {
  const text = normalizeStreamKey(streamCode);

  return text === "" || text === "nil";
}

function displayStream(streamCode: string | null | undefined) {
  return isCommonStream(streamCode)
    ? "All Streams"
    : normalizeText(streamCode);
}

function displayModule(row: {
  module_code: string;
  module_name?: string | null;
  module_term?: string | null;
}) {
  const moduleLabel = row.module_name
    ? `${row.module_code} - ${row.module_name}`
    : row.module_code;

  return row.module_term ? `${moduleLabel} / ${row.module_term}` : moduleLabel;
}

function buildKey(params: {
  academicYear: string;
  moduleCode: string;
  programmeCode: string;
  programmeStream: string;
  studyTerm: string;
}) {
  return [
    normalizeKeyPart(params.academicYear),
    normalizeKeyPart(params.moduleCode),
    normalizeKeyPart(params.programmeCode),
    normalizeKeyPart(params.programmeStream),
    normalizeKeyPart(params.studyTerm),
  ].join("|");
}

function getRowModuleTerm(row: {
  module_term?: string | null;
  moduleTerm?: string | null;
}) {
  return row.module_term ?? row.moduleTerm ?? null;
}

function getRowStudyTerm(
  row: {
    academic_year: string;
    study_term?: string | null;
    module_term?: string | null;
  }
) {
  const studyTerm = String(row.study_term ?? "").trim();

  if (studyTerm) {
    return studyTerm;
  }

  const offeredTerm = getRowModuleTerm(row);

  if (!offeredTerm) {
    return "";
  }

  return offeredTermToStudyTerm(row.academic_year, offeredTerm);
}

function getRowProgrammeStream(row: {
  programme_stream?: string | null;
  stream_code?: string | null;
}) {
  return normalizeStream(row.programme_stream ?? row.stream_code);
}

export function buildStudentNumberInputRows(
  planningModules: TimetablePlanningModuleRow[],
  existingStudentNumbers: TimetableStudentNumberRow[],
  moduleEnrollments: ModuleEnrollmentRow[] = [],
  selectedStreamCode?: string
) {
  const timetableStream =
    timetableProgrammeStreamFromSelection(selectedStreamCode);
  const map = new Map<string, StudentNumberInputRow>();

  const existingMap = new Map<string, TimetableStudentNumberRow>();

  for (const row of existingStudentNumbers) {
    const key = buildKey({
      academicYear: row.academic_year,
      moduleCode: row.module_code,
      programmeCode: row.programme_code,
      programmeStream: getRowProgrammeStream(row),
      studyTerm: getRowStudyTerm(row),
    });

    existingMap.set(key, row);
  }

  const enrollmentMap = new Map<
    string,
    {
      expected_student_number: number;
      actual_student_number: number | null;
    }
  >();

  for (const row of moduleEnrollments) {
    const key = buildKey({
      academicYear: row.academic_year,
      moduleCode: row.module_code,
      programmeCode: row.programme_code ?? "",
      programmeStream: getRowProgrammeStream(row),
      studyTerm: getRowStudyTerm({
        academic_year: row.academic_year,
        module_term: row.module_term,
      }),
    });

    enrollmentMap.set(key, {
      expected_student_number: row.expected_student_number,
      actual_student_number: row.actual_student_number,
    });
  }

  for (const module of planningModules) {
    const studyTerm = offeredTermToStudyTerm(
      module.academic_year,
      module.module_term
    );

    const key = buildKey({
      academicYear: module.academic_year,
      moduleCode: module.module_code,
      programmeCode: module.programme_code,
      programmeStream: timetableStream,
      studyTerm,
    });

    if (!map.has(key)) {
      const existing = existingMap.get(key);
      const enrollment = enrollmentMap.get(key);

      map.set(key, {
        academic_year: module.academic_year,
        module_code: module.module_code,
        module_name: module.module_name ?? null,
        module_term: module.module_term ?? null,
        programme_code: module.programme_code,
        programme_stream: timetableStream,
        study_term: studyTerm,
        streams_included: [],
        planning_module_ids: [],
        expected_student_number: resolveExpectedStudentNumberOnSync({
          existingExpected:
            existing?.expected_student_number ??
            enrollment?.expected_student_number,
          existingActual:
            existing?.actual_student_number ??
            enrollment?.actual_student_number,
          newActual:
            existing?.actual_student_number ??
            enrollment?.actual_student_number ??
            0,
        }),
        actual_student_number:
          existing?.actual_student_number ??
          enrollment?.actual_student_number ??
          0,
      });
    }

    const row = map.get(key)!;
    const streamDisplay = displayStream(module.stream_code);

    if (!row.streams_included.includes(streamDisplay)) {
      row.streams_included.push(streamDisplay);
    }

    if (!row.planning_module_ids.includes(module.id)) {
      row.planning_module_ids.push(module.id);
    }
  }

  return [...map.values()].sort((a, b) => {
    const programmeDiff = a.programme_code.localeCompare(b.programme_code);
    if (programmeDiff !== 0) return programmeDiff;

    const codeDiff = a.module_code.localeCompare(b.module_code);
    if (codeDiff !== 0) return codeDiff;

    return normalizeText(a.module_term).localeCompare(
      normalizeText(b.module_term)
    );
  });
}

export async function listStudentNumbers(academicYear: string) {
  const { data, error } = await supabase
    .from("timetable_student_numbers")
    .select("*")
    .in("academic_year", getAcademicYearVariants(academicYear))
    .order("programme_code")
    .order("module_code")
    .order("module_term");

  if (error) throw error;

  const canonicalYear = normalizeAcademicYear(academicYear);

  return ((data ?? []) as TimetableStudentNumberRow[]).map((row) => ({
    ...row,
    academic_year: canonicalYear,
  }));
}

export async function getStudentNumberInputRows(params: {
  academicYear: string;
  planningModules: TimetablePlanningModuleRow[];
  selectedStreamCode?: string;
}) {
  const [existing, enrollmentResult] = await Promise.all([
    listStudentNumbers(params.academicYear),
    supabase
      .from("module_enrollment")
      .select("*")
      .in("academic_year", getAcademicYearVariants(params.academicYear)),
  ]);

  if (enrollmentResult.error) throw enrollmentResult.error;

  return buildStudentNumberInputRows(
    params.planningModules,
    existing,
    (enrollmentResult.data ?? []) as ModuleEnrollmentRow[],
    params.selectedStreamCode
  );
}

export async function upsertStudentNumber(input: {
  academicYear: string;
  moduleCode: string;
  moduleTerm?: string | null;
  programmeCode: string;
  programmeStream?: string | null;
  studyTerm?: string | null;
  expectedStudentNumber: number;
  actualStudentNumber?: number | null;
  createdBy: string;
}) {
  if (input.expectedStudentNumber < 0) {
    throw new Error("Expected student number must be >= 0");
  }

  if (
    input.actualStudentNumber !== null &&
    input.actualStudentNumber !== undefined &&
    input.actualStudentNumber < 0
  ) {
    throw new Error("Actual student number must be >= 0");
  }

  const programmeStream = normalizeStream(input.programmeStream);
  const canonicalYear = normalizeAcademicYear(input.academicYear);
  const studyTerm =
    String(input.studyTerm ?? "").trim() ||
    offeredTermToStudyTerm(canonicalYear, input.moduleTerm ?? "");

  const { data, error } = await supabase
    .from("timetable_student_numbers")
    .upsert(
      {
        academic_year: canonicalYear,
        module_code: input.moduleCode,
        module_term: input.moduleTerm ?? null,
        programme_code: input.programmeCode,
        programme_stream: programmeStream,
        study_term: studyTerm,
        expected_student_number: input.expectedStudentNumber,
        actual_student_number: input.actualStudentNumber ?? null,
        created_by: input.createdBy,
      },
      {
        onConflict:
          "academic_year,module_code,programme_code,programme_stream,study_term",
      }
    )
    .select("*")
    .single();

  if (error) throw error;

  return data as TimetableStudentNumberRow;
}

export async function bulkUpsertStudentNumbers(params: {
  rows: StudentNumberInputRow[];
  createdBy: string;
}) {
  const payload = params.rows.map((row) => {
    if (row.expected_student_number === null) {
      throw new Error(
        `Expected student number is required for ${displayModule(row)} / ${row.programme_code}`
      );
    }

    if (row.expected_student_number < 0) {
      throw new Error(
        `Expected student number must be >= 0 for ${displayModule(row)} / ${row.programme_code}`
      );
    }

    if (
      row.actual_student_number !== null &&
      row.actual_student_number < 0
    ) {
      throw new Error(
        `Actual student number must be >= 0 for ${displayModule(row)} / ${row.programme_code}`
      );
    }

    return {
      academic_year: normalizeAcademicYear(row.academic_year),
      module_code: row.module_code,
      module_term: row.module_term ?? null,
      programme_code: row.programme_code,
      programme_stream: normalizeStream(row.programme_stream),
      study_term: row.study_term,
      expected_student_number: row.expected_student_number,
      actual_student_number: row.actual_student_number,
      created_by: params.createdBy,
    };
  });

  if (payload.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("timetable_student_numbers")
    .upsert(payload, {
      onConflict:
        "academic_year,module_code,programme_code,programme_stream,study_term",
    })
    .select("*");

  if (error) throw error;

  return (data ?? []) as TimetableStudentNumberRow[];
}

export function validateStudentNumbersComplete(rows: StudentNumberInputRow[]) {
  const missingExpected = rows.filter(
    (row) => row.expected_student_number === null
  );

  if (missingExpected.length > 0) {
    return {
      valid: false,
      message: `Expected student number is missing for: ${missingExpected
        .map((row) => `${displayModule(row)}/${row.programme_code}`)
        .join(", ")}`,
    };
  }

  const missingActual = rows.filter(
    (row) => row.actual_student_number === null
  );

  if (missingActual.length > 0) {
    return {
      valid: false,
      message: `Actual student number is missing for: ${missingActual
        .map((row) => `${displayModule(row)}/${row.programme_code}`)
        .join(", ")}`,
    };
  }

  return {
    valid: true,
    message: "",
  };
}
