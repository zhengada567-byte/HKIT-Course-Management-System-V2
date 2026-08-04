import {
  getStudyPlanExportColumnKey,
  studyPlanExportModuleCodesMatch,
} from "./studyPlanModuleCode";
import {
  buildStudyPlanStudentCsvCells,
  STUDY_PLAN_CSV_STUDENT_HEADERS,
  studyTermCellValue,
} from "./studyPlanCsvFormat";
import { isDegreeProgramme } from "../pages/programme-leader/make-study-plan/helpers";
import type { StudyPlanModule } from "../pages/programme-leader/make-study-plan/types";
import {
  loadProgrammeModules,
  mergeStudyPlanCatalogModules,
  shouldIncludeModuleInStudyPlanExport,
  sortModulesForStudyPlanExport,
  type StudyPlanExportBundle,
} from "../services/studyPlanService";

export interface AlignedStudyPlanSheet {
  programmeCode: string;
  rows: string[][];
}

function normalizeStream(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "nil";
}

function isDegreeExportBundle(bundle: StudyPlanExportBundle): boolean {
  return isDegreeProgramme(
    bundle.student.programmeCode,
    bundle.student.programmeType
  );
}

function isBridgingModuleForExport(module: StudyPlanModule): boolean {
  return String(module.planStage ?? "").trim().toLowerCase() === "bridging";
}

function isProgrammeModuleForExport(module: StudyPlanModule): boolean {
  return !isBridgingModuleForExport(module);
}

function findCatalogSlotIndex(
  catalog: StudyPlanModule[],
  module: StudyPlanModule
): number {
  return catalog.findIndex((entry) =>
    studyPlanExportModuleCodesMatch(entry.moduleCode, module.moduleCode)
  );
}

function collectUsedProgrammeColumnKeys(
  bundles: StudyPlanExportBundle[],
  isDegree: boolean
): Set<string> {
  const usedKeys = new Set<string>();

  for (const bundle of bundles) {
    for (const module of bundle.modules) {
      if (!shouldIncludeModuleInStudyPlanExport(module)) {
        continue;
      }

      if (isDegree && isBridgingModuleForExport(module)) {
        continue;
      }

      usedKeys.add(getStudyPlanExportColumnKey(module.moduleCode));
    }
  }

  return usedKeys;
}

async function buildExportCatalogColumns(params: {
  programmeCode: string;
  streams: string[];
  bundles: StudyPlanExportBundle[];
  isDegree: boolean;
}): Promise<StudyPlanModule[]> {
  const tableCatalogLists = await Promise.all(
    params.streams.map((stream) =>
      loadProgrammeModules(params.programmeCode, stream)
    )
  );

  const studentProgrammeModules = params.isDegree
    ? []
    : params.bundles.flatMap(({ modules }) =>
        modules.filter((module) => {
          if (!shouldIncludeModuleInStudyPlanExport(module)) {
            return false;
          }

          return isProgrammeModuleForExport(module);
        })
      );

  const mergedCatalog = mergeStudyPlanCatalogModules([
    ...tableCatalogLists,
    studentProgrammeModules,
  ]);

  const usedColumnKeys = collectUsedProgrammeColumnKeys(
    params.bundles,
    params.isDegree
  );

  return mergedCatalog.filter((column) =>
    usedColumnKeys.has(getStudyPlanExportColumnKey(column.moduleCode))
  );
}

function partitionModulesForAlignedExport(params: {
  modules: StudyPlanModule[];
  catalog: StudyPlanModule[];
  isDegree: boolean;
}): {
  bridgingModules: StudyPlanModule[];
  catalogSlots: Array<StudyPlanModule | null>;
  extraModules: StudyPlanModule[];
} {
  const exportModules = sortModulesForStudyPlanExport(params.modules).filter(
    shouldIncludeModuleInStudyPlanExport
  );

  const bridgingModules: StudyPlanModule[] = [];
  const slotByIndex = new Map<number, StudyPlanModule>();
  const extraModules: StudyPlanModule[] = [];

  for (const module of exportModules) {
    if (params.isDegree && isBridgingModuleForExport(module)) {
      bridgingModules.push(module);
      continue;
    }

    if (!params.isDegree || isProgrammeModuleForExport(module)) {
      const slotIndex = findCatalogSlotIndex(params.catalog, module);

      if (slotIndex >= 0 && !slotByIndex.has(slotIndex)) {
        slotByIndex.set(slotIndex, module);
        continue;
      }
    }

    extraModules.push(module);
  }

  const catalogSlots = params.catalog.map(
    (_, index) => slotByIndex.get(index) ?? null
  );

  return {
    bridgingModules: sortModulesForStudyPlanExport(bridgingModules),
    catalogSlots,
    extraModules: sortModulesForStudyPlanExport(extraModules),
  };
}

export type StudyPlanModulePairWriter = (
  module: StudyPlanModule
) => [string, string];

function buildRepeatedPairHeaders(
  pairCount: number,
  labels: [string, string]
): string[] {
  const headers: string[] = [];

  for (let index = 0; index < pairCount; index += 1) {
    headers.push(labels[0], labels[1]);
  }

  return headers;
}

function appendModulePairs(
  row: string[],
  modules: Array<StudyPlanModule | null>,
  pairCount: number,
  writePair: StudyPlanModulePairWriter
) {
  for (let index = 0; index < pairCount; index += 1) {
    const module = modules[index] ?? null;

    if (!module) {
      row.push("", "");
      continue;
    }

    const [left, right] = writePair(module);
    row.push(left, right);
  }
}

function buildAlignedSheetRows(params: {
  bundles: StudyPlanExportBundle[];
  catalog: StudyPlanModule[];
  isDegree: boolean;
  writePair: StudyPlanModulePairWriter;
  pairHeader: [string, string];
}): string[][] {
  const partitioned = params.bundles.map(({ student, modules }) => ({
    student,
    ...partitionModulesForAlignedExport({
      modules,
      catalog: params.catalog,
      isDegree: params.isDegree,
    }),
  }));

  const maxBridgingCount = params.isDegree
    ? Math.max(0, ...partitioned.map((row) => row.bridgingModules.length))
    : 0;
  const maxExtraCount = Math.max(
    0,
    ...partitioned.map((row) => row.extraModules.length)
  );

  const headerRow = [
    ...STUDY_PLAN_CSV_STUDENT_HEADERS,
    ...buildRepeatedPairHeaders(maxBridgingCount, params.pairHeader),
    ...buildRepeatedPairHeaders(params.catalog.length, params.pairHeader),
    ...buildRepeatedPairHeaders(maxExtraCount, params.pairHeader),
  ];

  const dataRows = partitioned.map(
    ({ student, bridgingModules, catalogSlots, extraModules }) => {
      const row = [...buildStudyPlanStudentCsvCells(student)];

      appendModulePairs(row, bridgingModules, maxBridgingCount, params.writePair);
      appendModulePairs(
        row,
        catalogSlots,
        catalogSlots.length,
        params.writePair
      );
      appendModulePairs(row, extraModules, maxExtraCount, params.writePair);

      while (row.length < headerRow.length) {
        row.push("");
      }

      return row;
    }
  );

  return [headerRow, ...dataRows];
}

async function buildEnrollmentExportCatalogColumns(params: {
  programmeCode: string;
  streams: string[];
  bundles: StudyPlanExportBundle[];
  isDegree: boolean;
}): Promise<StudyPlanModule[]> {
  const tableCatalogLists = await Promise.all(
    params.streams.map((stream) =>
      loadProgrammeModules(params.programmeCode, stream)
    )
  );

  const studentModules = params.bundles.flatMap(({ modules }) =>
    modules.filter((module) => {
      if (!shouldIncludeModuleInStudyPlanExport(module)) {
        return false;
      }

      if (params.isDegree && isBridgingModuleForExport(module)) {
        return false;
      }

      return isProgrammeModuleForExport(module);
    })
  );

  const mergedCatalog = mergeStudyPlanCatalogModules([
    ...tableCatalogLists,
    studentModules,
  ]);

  const usedColumnKeys = collectUsedProgrammeColumnKeys(
    params.bundles,
    params.isDegree
  );

  const orderedCatalog = mergedCatalog.filter((column) =>
    usedColumnKeys.has(getStudyPlanExportColumnKey(column.moduleCode))
  );

  if (orderedCatalog.length > 0) {
    return orderedCatalog;
  }

  return sortModulesForStudyPlanExport(
    mergeStudyPlanCatalogModules([studentModules])
  );
}

async function buildAlignedProgrammeSheet(
  programmeCode: string,
  bundles: StudyPlanExportBundle[],
  options: {
    writePair: StudyPlanModulePairWriter;
    pairHeader: [string, string];
    buildCatalog?: typeof buildExportCatalogColumns;
  }
): Promise<AlignedStudyPlanSheet> {
  const streams = Array.from(
    new Set(
      bundles.map((bundle) => normalizeStream(bundle.student.programmeStream))
    )
  );

  const isDegree = bundles.some((bundle) => isDegreeExportBundle(bundle));
  const buildCatalog = options.buildCatalog ?? buildExportCatalogColumns;
  const catalog = await buildCatalog({
    programmeCode,
    streams,
    bundles,
    isDegree,
  });

  return {
    programmeCode,
    rows: buildAlignedSheetRows({
      bundles,
      catalog,
      isDegree,
      writePair: options.writePair,
      pairHeader: options.pairHeader,
    }),
  };
}

export function groupStudyPlanBundlesByProgramme(
  bundles: StudyPlanExportBundle[]
): Map<string, StudyPlanExportBundle[]> {
  const groups = new Map<string, StudyPlanExportBundle[]>();

  for (const bundle of bundles) {
    const programmeCode = String(bundle.student.programmeCode ?? "")
      .trim()
      .toUpperCase();

    if (!programmeCode) {
      continue;
    }

    const existing = groups.get(programmeCode) ?? [];
    existing.push(bundle);
    groups.set(programmeCode, existing);
  }

  return groups;
}

export async function buildAlignedStudyPlanSheets(
  bundles: StudyPlanExportBundle[]
): Promise<AlignedStudyPlanSheet[]> {
  return buildAlignedModuleProfileSheets(bundles, {
    writePair: (module) => [module.moduleCode, studyTermCellValue(module)],
    pairHeader: ["Module code", "Study term"],
  });
}

export async function buildAlignedEnrollmentProfileSheets(
  bundles: StudyPlanExportBundle[],
  params: { notEnrolledLabel: string }
): Promise<AlignedStudyPlanSheet[]> {
  return buildAlignedModuleProfileSheets(bundles, {
    writePair: (module) => [
      enrollmentClassCellValue(module, params.notEnrolledLabel),
      studyTermCellValue(module),
    ],
    pairHeader: ["Enrolled class", "Study term"],
    buildCatalog: buildEnrollmentExportCatalogColumns,
  });
}

function enrollmentClassCellValue(
  module: StudyPlanModule,
  notEnrolledLabel: string
): string {
  const enrolledClass = String(module.enrolledModuleInstanceCode ?? "").trim();

  if (enrolledClass) {
    return enrolledClass;
  }

  if (module.status === "exempted") {
    return "";
  }

  return notEnrolledLabel;
}

async function buildAlignedModuleProfileSheets(
  bundles: StudyPlanExportBundle[],
  options: {
    writePair: StudyPlanModulePairWriter;
    pairHeader: [string, string];
    buildCatalog?: typeof buildExportCatalogColumns;
  }
): Promise<AlignedStudyPlanSheet[]> {
  const groups = groupStudyPlanBundlesByProgramme(bundles);
  const programmeCodes = Array.from(groups.keys()).sort();

  return Promise.all(
    programmeCodes.map((programmeCode) =>
      buildAlignedProgrammeSheet(
        programmeCode,
        groups.get(programmeCode) ?? [],
        options
      )
    )
  );
}
