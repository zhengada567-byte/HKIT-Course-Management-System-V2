import {
  buildStudyPlanCsvHeaderRow,
  buildStudyPlanStudentCsvCells,
  escapeStudyPlanCsvCell,
} from "../lib/studyPlanCsvFormat";
import type { StudyPlanStudent } from "../pages/programme-leader/make-study-plan/types";
import { loadProgrammeModuleCatalogForTemplate } from "./studyPlanService";

const DEGREE_TEMPLATE_BRIDGING_PAIR_COUNT = 7;

function csvRow(cells: string[]): string {
  return cells.map(escapeStudyPlanCsvCell).join(",");
}

function buildModulePairCells(
  moduleCodes: string[],
  studyTerms: string[]
): string[] {
  const cells: string[] = [];

  for (let index = 0; index < moduleCodes.length; index += 1) {
    cells.push(moduleCodes[index] ?? "", studyTerms[index] ?? "");
  }

  return cells;
}

function padModulePairs(
  moduleCodes: string[],
  pairCount: number
): string[] {
  const codes = [...moduleCodes];

  while (codes.length < pairCount) {
    codes.push("");
  }

  return codes.slice(0, pairCount);
}

function buildTemplateCsv(params: {
  programmeCode: string;
  pairCount: number;
  exampleRows: string[][];
}): string {
  const headerRow = buildStudyPlanCsvHeaderRow(params.pairCount);

  return [csvRow(headerRow), ...params.exampleRows.map(csvRow)].join("\n");
}

function exampleStudentBase(programmeCode: string): StudyPlanStudent {
  return {
    studentId: "",
    studentName: "",
    intakeTerm: "",
    intakeLevel: "",
    studyMode: "FT",
    programmeCode,
    programmeStream: "nil",
    okToArticulate: true,
    remark1: "",
    remark2: "",
  };
}

export async function buildInitialStudyPlanTemplateCsv(params: {
  programmeCode: string;
  isDegree: boolean;
}): Promise<string> {
  const programmeCode = String(params.programmeCode ?? "").trim().toUpperCase();

  if (!programmeCode) {
    throw new Error("Programme code is required to build the template.");
  }

  const catalogModules = await loadProgrammeModuleCatalogForTemplate(
    programmeCode
  );
  const catalogCodes = catalogModules.map((module) => module.moduleCode);

  if (params.isDegree) {
    const pairCount = Math.max(
      DEGREE_TEMPLATE_BRIDGING_PAIR_COUNT,
      catalogCodes.length
    );
    const pairSlots = padModulePairs(catalogCodes, pairCount);
    const exampleCodes =
      pairSlots.filter(Boolean).length > 0
        ? pairSlots
        : padModulePairs([], pairCount);

    const withBridging = [
      ...buildStudyPlanStudentCsvCells({
        ...exampleStudentBase(programmeCode),
        studentId: "S001",
        studentName: "Chan Tai Man",
        intakeTerm: "T2026C",
        intakeLevel: "Y3",
      }),
      ...buildModulePairCells(exampleCodes, [
        "T2026C",
        "T2027A",
        "",
        "",
        "",
        "",
        "",
      ]),
    ];

    const noBridging = [
      ...buildStudyPlanStudentCsvCells({
        ...exampleStudentBase(programmeCode),
        studentId: "S002",
        studentName: "Lee Siu Ming",
        intakeTerm: "T2026C",
        intakeLevel: "Y3",
      }),
      ...buildModulePairCells(exampleCodes, []),
    ];

    return buildTemplateCsv({
      programmeCode,
      pairCount,
      exampleRows: [withBridging, noBridging],
    });
  }

  const pairCount = Math.max(1, catalogCodes.length);
  const moduleCodes =
    catalogCodes.length > 0 ? padModulePairs(catalogCodes, pairCount) : [""];

  const exampleRow = [
    ...buildStudyPlanStudentCsvCells({
      ...exampleStudentBase(programmeCode),
      studentId: "S001",
      studentName: "Chan Tai Man",
      intakeTerm: "T2026A",
      intakeLevel: "Y1",
      programmeStream: "nil",
    }),
    ...buildModulePairCells(
      moduleCodes,
      moduleCodes.map((code, index) => (code && index === 0 ? "T2026A" : ""))
    ),
  ];

  return buildTemplateCsv({
    programmeCode,
    pairCount,
    exampleRows: [exampleRow],
  });
}
