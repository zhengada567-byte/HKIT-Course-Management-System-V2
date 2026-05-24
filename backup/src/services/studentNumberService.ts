import { supabase } from "../lib/supabase";
import type {
  TimetablePlanningModuleRow,
  TimetableStudentNumberRow,
} from "../types";
import type { ModuleEnrollmentRow } from "./moduleEnrollmentService";

export interface StudentNumberInputRow {
  academic_year: string;
  module_code: string;
  module_name: string | null;
  module_term: string | null;
  programme_code: string;
  streams_included: string[];
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
  moduleTerm?: string | null;
}) {
  return [
    normalizeKeyPart(params.academicYear),
    normalizeKeyPart(params.moduleCode),
    normalizeKeyPart(params.programmeCode),
    normalizeKeyPart(params.moduleTerm),
  ].join("|");
}

function getRowModuleTerm(row: {
  module_term?: string | null;
  moduleTerm?: string | null;
}) {
  return row.module_term ?? row.moduleTerm ?? null;
}

export function buildStudentNumberInputRows(
  planningModules: TimetablePlanningModuleRow[],
  existingStudentNumbers: TimetableStudentNumberRow[],
  moduleEnrollments: ModuleEnrollmentRow[] = []
) {
  const map = new Map<string, StudentNumberInputRow>();

  const existingMap = new Map<string, TimetableStudentNumberRow>();

  for (const row of existingStudentNumbers) {
    const key = buildKey({
      academicYear: row.academic_year,
      moduleCode: row.module_code,
      programmeCode: row.programme_code,
      moduleTerm: getRowModuleTerm(row),
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
      programmeCode: row.programme_code,
      moduleTerm: getRowModuleTerm(row),
    });

    enrollmentMap.set(key, {
      expected_student_number: row.expected_student_number,
      actual_student_number: row.actual_student_number,
    });
  }

  for (const module of planningModules) {
    const key = buildKey({
      academicYear: module.academic_year,
      moduleCode: module.module_code,
      programmeCode: module.programme_code,
      moduleTerm: module.module_term,
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
        streams_included: [],
        expected_student_number:
          existing?.expected_student_number ??
          enrollment?.expected_student_number ??
          null,
        actual_student_number:
          existing?.actual_student_number ??
          enrollment?.actual_student_number ??
          null,
      });
    }

    const row = map.get(key)!;
    const streamDisplay = displayStream(module.stream_code);

    if (!row.streams_included.includes(streamDisplay)) {
      row.streams_included.push(streamDisplay);
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
    .eq("academic_year", academicYear)
    .order("programme_code")
    .order("module_code")
    .order("module_term");

  if (error) throw error;

  return (data ?? []) as TimetableStudentNumberRow[];
}

export async function getStudentNumberInputRows(params: {
  academicYear: string;
  planningModules: TimetablePlanningModuleRow[];
}) {
  const [existing, enrollmentResult] = await Promise.all([
    listStudentNumbers(params.academicYear),
    supabase
      .from("module_enrollment")
      .select("*")
      .eq("academic_year", params.academicYear),
  ]);

  if (enrollmentResult.error) throw enrollmentResult.error;

  return buildStudentNumberInputRows(
    params.planningModules,
    existing,
    (enrollmentResult.data ?? []) as ModuleEnrollmentRow[]
  );
}

export async function upsertStudentNumber(input: {
  academicYear: string;
  moduleCode: string;
  moduleTerm?: string | null;
  programmeCode: string;
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

  const { data, error } = await supabase
    .from("timetable_student_numbers")
    .upsert(
      {
        academic_year: input.academicYear,
        module_code: input.moduleCode,
        module_term: input.moduleTerm ?? null,
        programme_code: input.programmeCode,
        expected_student_number: input.expectedStudentNumber,
        actual_student_number: input.actualStudentNumber ?? null,
        created_by: input.createdBy,
      },
      {
        onConflict: "academic_year,module_code,programme_code,module_term",
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
      academic_year: row.academic_year,
      module_code: row.module_code,
      module_term: row.module_term ?? null,
      programme_code: row.programme_code,
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
      onConflict: "academic_year,module_code,programme_code,module_term",
    })
    .select("*");

  if (error) throw error;

  return (data ?? []) as TimetableStudentNumberRow[];
}

export function validateStudentNumbersComplete(rows: StudentNumberInputRow[]) {
  const missing = rows.filter(
    (row) => row.expected_student_number === null
  );

  if (missing.length > 0) {
    return {
      valid: false,
      message: `Expected student number is missing for: ${missing
        .map((row) => `${displayModule(row)}/${row.programme_code}`)
        .join(", ")}`,
    };
  }

  return {
    valid: true,
    message: "",
  };
}
