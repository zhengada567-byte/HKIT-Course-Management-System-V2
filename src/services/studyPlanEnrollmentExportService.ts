import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

import { buildAlignedEnrollmentProfileSheets } from "../lib/studyPlanAlignedExport";
import { studyPlanRowsToCsv } from "../lib/studyPlanCsvFormat";
import {
  offeredTermFromStudyTerm,
  studyTermToAcademicYear,
} from "../pages/programme-leader/make-study-plan/helpers";
import type { StudyPlanModule } from "../pages/programme-leader/make-study-plan/types";
import type { ModuleTerm } from "../types/common";
import { normalizeAcademicYear } from "../lib/utils";
import {
  loadStudyPlanExportBundles,
  shouldIncludeModuleInStudyPlanExport,
  type StudyPlanExportBundle,
  type StudyPlanExportFilters,
} from "./studyPlanService";

export type EnrollmentProfileExportScope = "programme" | "all";

export interface DownloadEnrollmentProfileParams {
  scope: EnrollmentProfileExportScope;
  academicYear: string;
  offeredTerm: ModuleTerm;
  programmeCode?: string;
  notEnrolledLabel: string;
}

export function filterStudyPlanModulesForEnrollmentExport(
  modules: StudyPlanModule[],
  params: { academicYear: string; offeredTerm: ModuleTerm }
): StudyPlanModule[] {
  const canonicalYear = normalizeAcademicYear(params.academicYear);

  return modules.filter((module) => {
    if (module.status !== "planned" && module.status !== "failed") {
      return false;
    }

    if (!shouldIncludeModuleInStudyPlanExport(module)) {
      return false;
    }

    const studyTerm = String(module.studyTerm ?? "").trim();

    if (!studyTerm) {
      return false;
    }

    if (normalizeAcademicYear(studyTermToAcademicYear(studyTerm)) !== canonicalYear) {
      return false;
    }

    return offeredTermFromStudyTerm(studyTerm) === params.offeredTerm;
  });
}

function buildEnrollmentExportFilters(
  params: DownloadEnrollmentProfileParams
): StudyPlanExportFilters {
  if (params.scope === "programme") {
    return {
      programmeCode: params.programmeCode,
    };
  }

  return {};
}

function filterBundlesForEnrollmentTerm(
  bundles: StudyPlanExportBundle[],
  params: DownloadEnrollmentProfileParams
): StudyPlanExportBundle[] {
  return bundles.map(({ student, modules }) => ({
    student,
    modules: filterStudyPlanModulesForEnrollmentExport(modules, {
      academicYear: params.academicYear,
      offeredTerm: params.offeredTerm,
    }),
  }));
}

function countEnrollmentExportModules(bundles: StudyPlanExportBundle[]): number {
  return bundles.reduce((total, bundle) => total + bundle.modules.length, 0);
}

function buildEnrollmentTermMismatchMessage(params: DownloadEnrollmentProfileParams) {
  const year = normalizeAcademicYear(params.academicYear);
  return `No planned modules found for ${year} ${params.offeredTerm} term. Check academic year and offered term match student study terms (e.g. T2025C = 2025/26 Sep).`;
}

function sanitizeExcelSheetName(value: string): string {
  const sanitized = String(value ?? "")
    .trim()
    .replace(/[\\/?*[\]:]/g, "_")
    .slice(0, 31);

  return sanitized || "Sheet";
}

function buildEnrollmentProfileFileName(
  params: DownloadEnrollmentProfileParams,
  rowCount: number,
  sheetCount: number
): string {
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const extension = sheetCount > 1 ? "xlsx" : "csv";
  const yearToken = normalizeAcademicYear(params.academicYear).replace(/\//g, "-");
  const termToken = params.offeredTerm;

  if (params.scope === "programme") {
    return `enrollment_profile_${params.programmeCode ?? "programme"}_${termToken}_${yearToken}_${dateStamp}.${extension}`;
  }

  return `enrollment_profile_all_${termToken}_${yearToken}_${rowCount}_${dateStamp}.${extension}`;
}

function downloadEnrollmentWorkbook(
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

export async function downloadEnrollmentProfile(
  params: DownloadEnrollmentProfileParams
): Promise<{ fileName: string; rowCount: number }> {
  if (params.scope === "programme" && !String(params.programmeCode ?? "").trim()) {
    throw new Error("Programme code is required.");
  }

  const bundles = filterBundlesForEnrollmentTerm(
    await loadStudyPlanExportBundles(buildEnrollmentExportFilters(params)),
    params
  );

  if (bundles.length === 0) {
    throw new Error("No students found for the selected export scope.");
  }

  if (countEnrollmentExportModules(bundles) === 0) {
    throw new Error(buildEnrollmentTermMismatchMessage(params));
  }

  const sheets = await buildAlignedEnrollmentProfileSheets(bundles, {
    notEnrolledLabel: params.notEnrolledLabel,
  });

  if (sheets.length === 0) {
    throw new Error("No enrollment data found for the selected term.");
  }

  const fileName = buildEnrollmentProfileFileName(
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
    downloadEnrollmentWorkbook(sheets, fileName);
  }

  return {
    fileName,
    rowCount: bundles.length,
  };
}
