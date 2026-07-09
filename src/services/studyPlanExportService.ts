import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

import { buildAlignedStudyPlanSheets } from "../lib/studyPlanAlignedExport";
import { studyPlanRowsToCsv } from "../lib/studyPlanCsvFormat";

import {
  loadStudyPlanExportBundles,
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

function sanitizeExcelSheetName(value: string): string {
  const sanitized = String(value ?? "")
    .trim()
    .replace(/[\\/?*[\]:]/g, "_")
    .slice(0, 31);

  return sanitized || "Sheet";
}

function buildStudyPlanExportFileName(
  params: DownloadStudyPlanCsvParams,
  rowCount: number,
  sheetCount: number
): string {
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const extension = sheetCount > 1 ? "xlsx" : "csv";

  switch (params.scope) {
    case "student":
      return `study_plan_student_${dateStamp}.${extension}`;
    case "stream":
      return `study_plan_${params.programmeCode ?? "programme"}_${params.programmeStream ?? "stream"}_${dateStamp}.${extension}`;
    case "programme":
      return `study_plan_${params.programmeCode ?? "programme"}_${dateStamp}.${extension}`;
    case "programme_type":
      return `study_plan_${params.programmeType ?? "type"}_${dateStamp}.${extension}`;
    case "all":
    default:
      return `study_plan_all_${rowCount}_${dateStamp}.${extension}`;
  }
}

function downloadStudyPlanWorkbook(
  sheets: Array<{ programmeCode: string; rows: string[][] }>,
  fileName: string
) {
  const workbook = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      sanitizeExcelSheetName(sheet.programmeCode)
    );
  }

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });

  saveAs(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    fileName
  );
}

export async function buildStudyPlanCsvExport(
  params: DownloadStudyPlanCsvParams
): Promise<{
  csvContent?: string;
  fileName: string;
  rowCount: number;
  sheetCount: number;
}> {
  const bundles = await loadStudyPlanExportBundles(buildExportFilters(params));

  if (bundles.length === 0) {
    throw new Error("No study plans found for the selected export scope.");
  }

  const sheets = await buildAlignedStudyPlanSheets(bundles);
  const fileName = buildStudyPlanExportFileName(
    params,
    bundles.length,
    sheets.length
  );

  if (sheets.length === 1) {
    return {
      csvContent: studyPlanRowsToCsv(sheets[0]?.rows ?? []),
      fileName,
      rowCount: bundles.length,
      sheetCount: 1,
    };
  }

  return {
    fileName,
    rowCount: bundles.length,
    sheetCount: sheets.length,
  };
}

export async function downloadStudyPlanCsv(
  params: DownloadStudyPlanCsvParams
): Promise<{ fileName: string; rowCount: number }> {
  const bundles = await loadStudyPlanExportBundles(buildExportFilters(params));

  if (bundles.length === 0) {
    throw new Error("No study plans found for the selected export scope.");
  }

  const sheets = await buildAlignedStudyPlanSheets(bundles);
  const fileName = buildStudyPlanExportFileName(
    params,
    bundles.length,
    sheets.length
  );

  if (sheets.length === 1) {
    const csvContent = studyPlanRowsToCsv(sheets[0]?.rows ?? []);

    saveAs(
      new Blob([csvContent], {
        type: "text/csv;charset=utf-8;",
      }),
      fileName
    );
  } else {
    downloadStudyPlanWorkbook(sheets, fileName);
  }

  return {
    fileName,
    rowCount: bundles.length,
  };
}
