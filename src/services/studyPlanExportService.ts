import { saveAs } from "file-saver";

import { buildStudyPlanCsvContent } from "../lib/studyPlanCsvFormat";

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

function buildStudyPlanCsvFromBundles(bundles: StudyPlanExportBundle[]): string {
  const exportModulesByStudent = bundles.map(({ modules }) =>
    sortModulesForStudyPlanExport(modules).filter(
      shouldIncludeModuleInStudyPlanExport
    )
  );

  const maxPairCount = Math.max(
    0,
    ...exportModulesByStudent.map((modules) => modules.length)
  );

  return buildStudyPlanCsvContent({
    modulePairCount: maxPairCount,
    students: bundles.map(({ student, modules }, bundleIndex) => ({
      student,
      modules: exportModulesByStudent[bundleIndex] ?? [],
    })),
  });
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

  const csvContent = buildStudyPlanCsvFromBundles(bundles);
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
