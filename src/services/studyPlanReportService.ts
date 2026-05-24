import { saveAs } from "file-saver";

import { compareStudyTerm } from "../pages/programme-leader/make-study-plan/helpers";
import { supabase } from "../lib/supabase";

function normalizeStream(value?: string | null): string {
  const text = String(value ?? "").trim();
  return text || "nil";
}

export type StudentHeadcountGroupBy =
  | "programme_type"
  | "programme_code"
  | "programme_stream";

export interface StudentHeadcountReportParams {
  groupBy: StudentHeadcountGroupBy;
  includeIntakeTerm?: boolean;
}

export interface StudentHeadcountReportRow {
  programmeType: string;
  programmeCode: string;
  programmeStream: string;
  intakeTerm: string;
  studentCount: number;
}

export interface ModuleEnrollmentReportParams {
  includeBridging?: boolean;
  programmeCode?: string;
}

export interface ModuleEnrollmentReportRow {
  programmeCode: string;
  programmeStream: string;
  moduleCode: string;
  moduleName: string;
  planStage: string;
  studyTerm: string;
  studentCount: number;
}

function escapeCsvCell(value: unknown): string {
  const text = String(value ?? "");

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function rowsToCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
}

async function loadProgrammeTypeByCode(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("programmes")
    .select("programme_code, programme_type");

  if (error) {
    console.error("[StudyPlanReport] Failed to load programme types:", error);
    throw error;
  }

  const map = new Map<string, string>();

  for (const row of data ?? []) {
    const programmeCode = String(row.programme_code ?? "").trim();

    if (!programmeCode || map.has(programmeCode)) {
      continue;
    }

    map.set(programmeCode, String(row.programme_type ?? "").trim() || "Unknown");
  }

  return map;
}

export async function getStudentHeadcountReport(
  params: StudentHeadcountReportParams
): Promise<StudentHeadcountReportRow[]> {
  const { data, error } = await supabase.from("study_plan_students").select("*");

  if (error) throw error;

  const programmeTypeByCode = await loadProgrammeTypeByCode();
  const includeIntakeTerm = params.includeIntakeTerm ?? false;
  const grouped = new Map<string, StudentHeadcountReportRow>();

  for (const row of data ?? []) {
    const programmeCode = String(row.programme_code ?? "").trim();
    const programmeStream = normalizeStream(row.programme_stream);
    const programmeType =
      programmeTypeByCode.get(programmeCode) ?? "Unknown";
    const intakeTerm = String(row.intake_term ?? "").trim();

    const keyParts: string[] = [];

    if (params.groupBy === "programme_type") {
      keyParts.push(programmeType);
    } else if (params.groupBy === "programme_code") {
      keyParts.push(programmeCode);
    } else {
      keyParts.push(programmeCode, programmeStream);
    }

    if (includeIntakeTerm) {
      keyParts.push(intakeTerm);
    }

    const key = keyParts.join("|");
    const existing = grouped.get(key);

    if (existing) {
      existing.studentCount += 1;
      continue;
    }

    grouped.set(key, {
      programmeType,
      programmeCode:
        params.groupBy === "programme_type" ? "" : programmeCode,
      programmeStream:
        params.groupBy === "programme_stream" ? programmeStream : "",
      intakeTerm: includeIntakeTerm ? intakeTerm : "",
      studentCount: 1,
    });
  }

  const rows = Array.from(grouped.values());

  rows.sort((a, b) => {
    const typeDiff = a.programmeType.localeCompare(b.programmeType);

    if (typeDiff !== 0) return typeDiff;

    const codeDiff = a.programmeCode.localeCompare(b.programmeCode);

    if (codeDiff !== 0) return codeDiff;

    const streamDiff = a.programmeStream.localeCompare(b.programmeStream);

    if (streamDiff !== 0) return streamDiff;

    return compareStudyTerm(a.intakeTerm, b.intakeTerm);
  });

  return rows;
}

export async function getModuleEnrollmentReport(
  params: ModuleEnrollmentReportParams = {}
): Promise<ModuleEnrollmentReportRow[]> {
  let query = supabase
    .from("study_plan_modules")
    .select(
      "module_code, module_name, programme_code, programme_stream, study_term, status, plan_stage"
    )
    .eq("status", "planned")
    .not("study_term", "is", null);

  if (!params.includeBridging) {
    query = query.eq("plan_stage", "programme");
  }

  if (params.programmeCode) {
    query = query.eq(
      "programme_code",
      String(params.programmeCode).trim()
    );
  }

  const { data, error } = await query;

  if (error) throw error;

  const grouped = new Map<string, ModuleEnrollmentReportRow>();

  for (const row of data ?? []) {
    const programmeCode = String(row.programme_code ?? "").trim();
    const programmeStream = normalizeStream(row.programme_stream);
    const moduleCode = String(row.module_code ?? "").trim();
    const moduleName = String(row.module_name ?? moduleCode).trim();
    const planStage = String(row.plan_stage ?? "programme").trim();
    const studyTerm = String(row.study_term ?? "").trim().toUpperCase();

    if (!programmeCode || !moduleCode || !studyTerm) {
      continue;
    }

    const key = [
      programmeCode,
      programmeStream,
      moduleCode,
      planStage,
      studyTerm,
    ].join("|");

    const existing = grouped.get(key);

    if (existing) {
      existing.studentCount += 1;
      continue;
    }

    grouped.set(key, {
      programmeCode,
      programmeStream,
      moduleCode,
      moduleName,
      planStage,
      studyTerm,
      studentCount: 1,
    });
  }

  const rows = Array.from(grouped.values());

  rows.sort((a, b) => {
    const codeDiff = a.programmeCode.localeCompare(b.programmeCode);

    if (codeDiff !== 0) return codeDiff;

    const streamDiff = a.programmeStream.localeCompare(b.programmeStream);

    if (streamDiff !== 0) return streamDiff;

    const stageDiff = a.planStage.localeCompare(b.planStage);

    if (stageDiff !== 0) return stageDiff;

    const moduleDiff = a.moduleCode.localeCompare(b.moduleCode);

    if (moduleDiff !== 0) return moduleDiff;

    return compareStudyTerm(a.studyTerm, b.studyTerm);
  });

  return rows;
}

export async function downloadStudentHeadcountReportCsv(
  params: StudentHeadcountReportParams
): Promise<{ fileName: string; rowCount: number }> {
  const rows = await getStudentHeadcountReport(params);
  const includeIntakeTerm = params.includeIntakeTerm ?? false;

  const headers = ["Programme Type"];

  if (params.groupBy === "programme_code" || params.groupBy === "programme_stream") {
    headers.push("Programme Code");
  }

  if (params.groupBy === "programme_stream") {
    headers.push("Programme Stream");
  }

  if (includeIntakeTerm) {
    headers.push("Intake Term");
  }

  headers.push("Student Count");

  const csvRows = rows.map((row) => {
    const cells = [row.programmeType];

    if (params.groupBy === "programme_code" || params.groupBy === "programme_stream") {
      cells.push(row.programmeCode);
    }

    if (params.groupBy === "programme_stream") {
      cells.push(row.programmeStream);
    }

    if (includeIntakeTerm) {
      cells.push(row.intakeTerm);
    }

    cells.push(String(row.studentCount));

    return cells;
  });

  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const fileName = `study_plan_student_headcount_${params.groupBy}_${dateStamp}.csv`;

  saveAs(
    new Blob([rowsToCsv(headers, csvRows)], {
      type: "text/csv;charset=utf-8;",
    }),
    fileName
  );

  return {
    fileName,
    rowCount: rows.length,
  };
}

export async function downloadModuleEnrollmentReportCsv(
  params: ModuleEnrollmentReportParams = {}
): Promise<{ fileName: string; rowCount: number }> {
  const rows = await getModuleEnrollmentReport(params);

  const headers = [
    "Programme Code",
    "Programme Stream",
    "Plan Stage",
    "Module Code",
    "Module Name",
    "Study Term",
    "Student Count",
  ];

  const csvRows = rows.map((row) => [
    row.programmeCode,
    row.programmeStream,
    row.planStage,
    row.moduleCode,
    row.moduleName,
    row.studyTerm,
    String(row.studentCount),
  ]);

  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = params.programmeCode
    ? params.programmeCode
    : params.includeBridging
      ? "all_with_bridging"
      : "programme_only";

  const fileName = `study_plan_module_enrollment_${suffix}_${dateStamp}.csv`;

  saveAs(
    new Blob([rowsToCsv(headers, csvRows)], {
      type: "text/csv;charset=utf-8;",
    }),
    fileName
  );

  return {
    fileName,
    rowCount: rows.length,
  };
}
