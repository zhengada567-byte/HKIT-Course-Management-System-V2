import { normalizeProgrammeYear } from "../lib/programmeYear";
import { normalizeAcademicYear, offeredTermToStudyTerm } from "../lib/utils";
import { supabase } from "../lib/supabase";
import type { ModuleTerm } from "../types";

export type ProgrammeTuitionFeeRow = {
  id: string;
  academic_year: string;
  programme_code: string;
  tuition_fee_per_student: number;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type StudentYearModeCount = {
  programmeYear: string;
  ft: number;
  pt: number;
  total: number;
};

export type ProgrammeStudentBreakdown = {
  programmeCode: string;
  byYear: StudentYearModeCount[];
  ftTotal: number;
  ptTotal: number;
  total: number;
  studyTerm?: string;
};

function parseAmount(value: number | string, field = "Amount") {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }
  return Math.round(n * 100) / 100;
}

function normalizeProgrammeCode(value: string) {
  const code = String(value ?? "").trim().toUpperCase();
  if (!code) throw new Error("Programme code is required.");
  return code;
}

function emptyBreakdown(
  programmeCode: string,
  studyTerm?: string
): ProgrammeStudentBreakdown {
  return {
    programmeCode,
    byYear: [],
    ftTotal: 0,
    ptTotal: 0,
    total: 0,
    studyTerm,
  };
}

function accumulateBreakdown(
  rows: Array<{
    intake_level?: string | null;
    study_mode?: string | null;
    student_status?: string | null;
  }>,
  programmeCode: string,
  studyTerm?: string
): ProgrammeStudentBreakdown {
  const byYear = new Map<string, { ft: number; pt: number }>();
  let ftTotal = 0;
  let ptTotal = 0;

  for (const row of rows) {
    const status = String(row.student_status ?? "").trim().toLowerCase();
    if (status === "graduated") continue;

    const year =
      normalizeProgrammeYear(row.intake_level) ||
      String(row.intake_level ?? "").trim().toUpperCase() ||
      "Unknown";
    const isPt = String(row.study_mode ?? "").trim().toUpperCase() === "PT";
    const bucket = byYear.get(year) ?? { ft: 0, pt: 0 };

    if (isPt) {
      bucket.pt += 1;
      ptTotal += 1;
    } else {
      bucket.ft += 1;
      ftTotal += 1;
    }
    byYear.set(year, bucket);
  }

  const years = Array.from(byYear.entries())
    .map(([programmeYear, counts]) => ({
      programmeYear,
      ft: counts.ft,
      pt: counts.pt,
      total: counts.ft + counts.pt,
    }))
    .sort((a, b) => a.programmeYear.localeCompare(b.programmeYear));

  return {
    programmeCode,
    byYear: years,
    ftTotal,
    ptTotal,
    total: ftTotal + ptTotal,
    studyTerm,
  };
}

export async function listProgrammeTuitionFees(academicYear: string) {
  const year = normalizeAcademicYear(academicYear);
  const { data, error } = await supabase
    .from("programme_tuition_fees")
    .select("*")
    .eq("academic_year", year)
    .order("programme_code");

  if (error) throw error;
  return (data ?? []) as ProgrammeTuitionFeeRow[];
}

export async function getProgrammeTuitionFee(params: {
  academicYear: string;
  programmeCode: string;
}) {
  const { data, error } = await supabase
    .from("programme_tuition_fees")
    .select("*")
    .eq("academic_year", normalizeAcademicYear(params.academicYear))
    .eq("programme_code", normalizeProgrammeCode(params.programmeCode))
    .maybeSingle();

  if (error) throw error;
  return (data as ProgrammeTuitionFeeRow | null) ?? null;
}

export async function upsertProgrammeTuitionFee(params: {
  academicYear: string;
  programmeCode: string;
  tuitionFeePerStudent: number | string;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const payload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    programme_code: normalizeProgrammeCode(params.programmeCode),
    tuition_fee_per_student: parseAmount(
      params.tuitionFeePerStudent,
      "Tuition fee"
    ),
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("programme_tuition_fees")
    .upsert(payload, { onConflict: "academic_year,programme_code" })
    .select("*")
    .single();

  if (error) throw error;
  return data as ProgrammeTuitionFeeRow;
}

export async function loadProgrammeStudentBreakdown(
  programmeCode: string
): Promise<ProgrammeStudentBreakdown> {
  const code = normalizeProgrammeCode(programmeCode);

  const { data, error } = await supabase
    .from("study_plan_students")
    .select("intake_level, study_mode, student_status")
    .eq("programme_code", code);

  if (error) throw error;
  return accumulateBreakdown(data ?? [], code);
}

export async function loadProgrammeStudentBreakdownForTerm(params: {
  programmeCode: string;
  academicYear: string;
  moduleTerm: ModuleTerm | string;
}): Promise<ProgrammeStudentBreakdown> {
  const code = normalizeProgrammeCode(params.programmeCode);
  const academicYear = normalizeAcademicYear(params.academicYear);
  const moduleTerm = String(params.moduleTerm ?? "").trim() as ModuleTerm;
  if (moduleTerm !== "Sep" && moduleTerm !== "Feb" && moduleTerm !== "Jun") {
    throw new Error("Term must be Sep, Feb, or Jun.");
  }
  const studyTerm = offeredTermToStudyTerm(academicYear, moduleTerm);

  const { data: modules, error: moduleError } = await supabase
    .from("study_plan_modules")
    .select("student_profile_id")
    .eq("programme_code", code)
    .eq("study_term", studyTerm);

  if (moduleError) throw moduleError;

  const profileIds = Array.from(
    new Set(
      (modules ?? [])
        .map((row) => String(row.student_profile_id ?? "").trim())
        .filter(Boolean)
    )
  );

  if (profileIds.length === 0) {
    return emptyBreakdown(code, studyTerm);
  }

  const students: Array<{
    intake_level?: string | null;
    study_mode?: string | null;
    student_status?: string | null;
  }> = [];
  const chunkSize = 200;

  for (let i = 0; i < profileIds.length; i += chunkSize) {
    const chunk = profileIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("study_plan_students")
      .select("id, intake_level, study_mode, student_status")
      .in("id", chunk);

    if (error) throw error;
    students.push(...(data ?? []));
  }

  return accumulateBreakdown(students, code, studyTerm);
}

export type ProgrammeTermStudentExportRow = {
  programmeCode: string;
  programmeName: string;
  programmeStream: string;
  studentId: string;
  studentName: string;
  studyMode: string;
};

/**
 * Distinct non-graduated students with a study-plan module in the offered term.
 */
export async function listProgrammeStudentsForTerm(params: {
  programmeCode: string;
  academicYear: string;
  moduleTerm: ModuleTerm | string;
  programmeName?: string | null;
}): Promise<ProgrammeTermStudentExportRow[]> {
  const code = normalizeProgrammeCode(params.programmeCode);
  const academicYear = normalizeAcademicYear(params.academicYear);
  const moduleTerm = String(params.moduleTerm ?? "").trim() as ModuleTerm;
  if (moduleTerm !== "Sep" && moduleTerm !== "Feb" && moduleTerm !== "Jun") {
    throw new Error("Term must be Sep, Feb, or Jun.");
  }
  const studyTerm = offeredTermToStudyTerm(academicYear, moduleTerm);
  const programmeName = String(params.programmeName ?? "").trim() || code;

  const { data: modules, error: moduleError } = await supabase
    .from("study_plan_modules")
    .select("student_profile_id")
    .eq("programme_code", code)
    .eq("study_term", studyTerm);

  if (moduleError) throw moduleError;

  const profileIds = Array.from(
    new Set(
      (modules ?? [])
        .map((row) => String(row.student_profile_id ?? "").trim())
        .filter(Boolean)
    )
  );

  if (profileIds.length === 0) return [];

  const students: Array<{
    student_id?: string | null;
    student_name?: string | null;
    programme_stream?: string | null;
    study_mode?: string | null;
    student_status?: string | null;
  }> = [];
  const chunkSize = 200;

  for (let i = 0; i < profileIds.length; i += chunkSize) {
    const chunk = profileIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("study_plan_students")
      .select(
        "student_id, student_name, programme_stream, study_mode, student_status"
      )
      .in("id", chunk);

    if (error) throw error;
    students.push(...(data ?? []));
  }

  return students
    .filter(
      (row) =>
        String(row.student_status ?? "").trim().toLowerCase() !== "graduated"
    )
    .map((row) => ({
      programmeCode: code,
      programmeName,
      programmeStream: String(row.programme_stream ?? "").trim(),
      studentId: String(row.student_id ?? "").trim(),
      studentName: String(row.student_name ?? "").trim(),
      studyMode:
        String(row.study_mode ?? "").trim().toUpperCase() === "PT" ? "PT" : "FT",
    }))
    .sort((a, b) => {
      const streamDiff = a.programmeStream.localeCompare(b.programmeStream);
      if (streamDiff !== 0) return streamDiff;
      return a.studentId.localeCompare(b.studentId);
    });
}

function csvEscape(value: string) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function downloadProgrammeTermStudentListCsv(params: {
  programmeCode: string;
  academicYear: string;
  moduleTerm: ModuleTerm | string;
  programmeName?: string | null;
}) {
  const rows = await listProgrammeStudentsForTerm(params);
  const headers = [
    "Programme Name",
    "Programme Code",
    "Stream",
    "Student ID",
    "Student Name",
    "FT/PT",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        csvEscape(row.programmeName),
        csvEscape(row.programmeCode),
        csvEscape(row.programmeStream || "nil"),
        csvEscape(row.studentId),
        csvEscape(row.studentName),
        csvEscape(row.studyMode),
      ].join(",")
    ),
  ];

  const studyTerm = offeredTermToStudyTerm(
    normalizeAcademicYear(params.academicYear),
    String(params.moduleTerm)
  );
  const code = normalizeProgrammeCode(params.programmeCode);
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${code}_${studyTerm}_students.csv`;
  anchor.click();
  URL.revokeObjectURL(url);

  return rows.length;
}

export async function loadAllProgrammeStudentBreakdowns(
  programmeCodes: string[]
) {
  const unique = Array.from(
    new Set(
      programmeCodes
        .map((c) => String(c ?? "").trim().toUpperCase())
        .filter(Boolean)
    )
  );

  const result = new Map<string, ProgrammeStudentBreakdown>();
  await Promise.all(
    unique.map(async (code) => {
      result.set(code, await loadProgrammeStudentBreakdown(code));
    })
  );
  return result;
}

export async function loadAllProgrammeStudentBreakdownsForTerm(params: {
  programmeCodes: string[];
  academicYear: string;
  moduleTerm: ModuleTerm | string;
}) {
  const unique = Array.from(
    new Set(
      params.programmeCodes
        .map((c) => String(c ?? "").trim().toUpperCase())
        .filter(Boolean)
    )
  );

  const result = new Map<string, ProgrammeStudentBreakdown>();
  await Promise.all(
    unique.map(async (code) => {
      result.set(
        code,
        await loadProgrammeStudentBreakdownForTerm({
          programmeCode: code,
          academicYear: params.academicYear,
          moduleTerm: params.moduleTerm,
        })
      );
    })
  );
  return result;
}
