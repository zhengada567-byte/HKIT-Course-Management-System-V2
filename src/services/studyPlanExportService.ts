import { saveAs } from "file-saver";

import type { StudyPlanModule } from "../pages/programme-leader/make-study-plan/types";

import {
  loadStudyPlanExportBundles,
  shouldIncludeModuleInStudyPlanExport,
  sortModulesForStudyPlanExport,
  type StudyPlanExportBundle,
  type StudyPlanExportFilters,
} from "./studyPlanService";

export type StudyPlanExportScope =
  | "student"
  | "stream"
  | "programme"
  | "programme_type"
  | "all";

export interface DownloadStudyPlanCsvParams {
  scope: StudyPlanExportScope;
  studentProfileId?: string;
  programmeCode?: string;
  programmeStream?: string;
  programmeType?: string;
}

const STUDENT_HEADERS = [
  "Student Name",
  "Intake Level",
  "student ID",
  "Intake term",
  "study mode",
  "programme stream",
  "programme code",
] as const;

function escapeCsvCell(value: unknown): string {
  const text = String(value ?? "");

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function studyTermCellValue(module: StudyPlanModule): string {
  if (module.status === "exempted") {
    return "Exempted";
  }

  return String(module.studyTerm ?? "").trim();
}

function buildExportFilters(
  params: DownloadStudyPlanCsvParams
): StudyPlanExportFilters {
  switch (params.scope) {
    case "student":
      return {
        studentProfileId: params.studentProfileId,
      };
    case "stream":
      return {
        programmeCode: params.programmeCode,
        programmeStream: params.programmeStream,
      };
    case "programme":
      return {
        programmeCode: params.programmeCode,
      };
    case "programme_type":
      return {
        programmeType: params.programmeType,
      };
    case "all":
    default:
      return {};
  }
}

function buildStudyPlanCsvContent(bundles: StudyPlanExportBundle[]): string {
  const exportModulesByStudent = bundles.map(({ modules }) =>
    sortModulesForStudyPlanExport(modules).filter(
      shouldIncludeModuleInStudyPlanExport
    )
  );

  const maxPairCount = Math.max(
    0,
    ...exportModulesByStudent.map((modules) => modules.length)
  );

  const pairHeaders: string[] = [];

  for (let index = 0; index < maxPairCount; index += 1) {
    pairHeaders.push("Module code", "Study term");
  }

  const headerRow = [...STUDENT_HEADERS, ...pairHeaders];

  const dataRows = bundles.map(({ student, modules }, bundleIndex) => {
    const exportModules = exportModulesByStudent[bundleIndex] ?? [];

    const row: string[] = [
      student.studentName,
      student.intakeLevel ?? "",
      student.studentId,
      student.intakeTerm ?? "",
      student.studyMode,
      student.programmeStream ?? "nil",
      student.programmeCode,
    ];

    for (const module of exportModules) {
      row.push(module.moduleCode, studyTermCellValue(module));
    }

    while (row.length < headerRow.length) {
      row.push("");
    }

    return row;
  });

  return [headerRow, ...dataRows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
}

function buildStudyPlanExportFileName(
  params: DownloadStudyPlanCsvParams,
  rowCount: number
): string {
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  switch (params.scope) {
    case "student":
      return `study_plan_student_${dateStamp}.csv`;
    case "stream":
      return `study_plan_${params.programmeCode ?? "programme"}_${params.programmeStream ?? "stream"}_${dateStamp}.csv`;
    case "programme":
      return `study_plan_${params.programmeCode ?? "programme"}_${dateStamp}.csv`;
    case "programme_type":
      return `study_plan_${params.programmeType ?? "type"}_${dateStamp}.csv`;
    case "all":
    default:
      return `study_plan_all_${rowCount}_${dateStamp}.csv`;
  }
}

export async function buildStudyPlanCsvExport(
  params: DownloadStudyPlanCsvParams
): Promise<{ csvContent: string; fileName: string; rowCount: number }> {
  const bundles = await loadStudyPlanExportBundles(buildExportFilters(params));

  if (bundles.length === 0) {
    throw new Error("No study plans found for the selected export scope.");
  }

  const csvContent = buildStudyPlanCsvContent(bundles);
  const fileName = buildStudyPlanExportFileName(params, bundles.length);

  return {
    csvContent,
    fileName,
    rowCount: bundles.length,
  };
}

export async function downloadStudyPlanCsv(
  params: DownloadStudyPlanCsvParams
): Promise<{ fileName: string; rowCount: number }> {
  const { csvContent, fileName, rowCount } =
    await buildStudyPlanCsvExport(params);

  saveAs(
    new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    }),
    fileName
  );

  return {
    fileName,
    rowCount,
  };
}
