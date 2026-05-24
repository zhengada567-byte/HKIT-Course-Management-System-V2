import * as XLSX from "xlsx";

import type {
  StudyPlanModule,
  StudyPlanStudent,
} from "../pages/programme-leader/make-study-plan/types";

import { saveStudyPlan } from "./studyPlanService";

type ExcelCell = string | number | boolean | Date | null | undefined;

interface ParsedExcelRow {
  headers: string[];
  values: ExcelCell[];
  rowNumber: number;
}

export interface InitialStudyPlanUploadContext {
  programmeCode: string;
}

export interface InitialStudyPlanUploadResult {
  totalRows: number;
  totalStudents: number;
  successStudents: number;
  failedStudents: number;
  skippedModuleCells: number;
  errors: InitialStudyPlanUploadError[];
  warnings: InitialStudyPlanUploadWarning[];
}

export interface InitialStudyPlanUploadError {
  row?: number;
  studentId?: string;
  message: string;
}

export interface InitialStudyPlanUploadWarning {
  row?: number;
  studentId?: string;
  moduleCode?: string;
  column?: string;
  value?: string;
  message: string;
}

interface GroupedStudentPlan {
  student: StudyPlanStudent;
  modules: StudyPlanModule[];
  rowNumber: number;
}

const STUDENT_FIELD_ALIASES = {
  studentName: ["student_name", "student name", "name", "studentname"],
  studentId: ["student_id", "student id", "studentid", "sid", "id"],
  intakeLevel: ["intake_level", "intake level", "intakelevel"],
  intakeTerm: ["intake_term", "intake term", "intaketerm"],
  studyMode: ["study_mode", "study mode", "studymode", "mode"],
  sex: ["sex", "gender"],
  programmeStream: [
    "programme_stream",
    "programme stream",
    "program_stream",
    "program stream",
    "stream",
  ],
};

const NON_MODULE_HEADER_ALIASES = [
  "student_name",
  "student name",
  "name",
  "studentname",
  "student_id",
  "student id",
  "studentid",
  "sid",
  "id",
  "intake_level",
  "intake level",
  "intakelevel",
  "intake_term",
  "intake term",
  "intaketerm",
  "study_mode",
  "study mode",
  "studymode",
  "mode",
  "sex",
  "gender",
  "programme_stream",
  "programme stream",
  "program_stream",
  "program stream",
  "stream",
  "module_code",
  "module code",
  "study_term",
  "study term",
  "studyterm",
  "module_name",
  "module name",
  "module_year",
  "module year",
  "module_term",
  "module term",
  "remark",
  "remarks",
  "comment",
  "comments",
];

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function optionalText(value: unknown): string | undefined {
  const text = cleanText(value);
  return text || undefined;
}

function normalizeHeader(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/-/g, "_");
}

function normalizeAlias(value: unknown): string {
  return normalizeHeader(value).replace(/\s+/g, "_");
}

/**
 * Critical rule:
 *
 * Module codes may legally contain underscores "_" and hyphens "-".
 *
 * Examples:
 * - HD403_HDC
 * - CS404_EE
 * - CS408_EE
 * - AF-01
 *
 * Therefore, do NOT use:
 * - split("_")
 * - split("-")
 * - split(/[_-]/)
 * - replace(/_.+$/, "")
 * - replace(/-.+$/, "")
 *
 * The upload must preserve the full module code exactly, except trimming
 * whitespace and converting to uppercase.
 */
function normalizeModuleCode(value: unknown): string {
  return cleanText(value).toUpperCase();
}

function isValidModuleCode(value: unknown): boolean {
  const code = normalizeModuleCode(value);

  if (!code) return false;

  /**
   * Allows:
   * - HD401
   * - HD403_HDC
   * - CS404_EE
   * - CS408_EE
   * - AF-01
   *
   * Requires at least one digit to reduce false positives from normal text.
   */
  return /^(?=.*\d)[A-Z0-9]+(?:[_-][A-Z0-9]+)*$/.test(code);
}

function isNonModuleHeader(header: unknown): boolean {
  const normalizedHeader = normalizeHeader(header);
  const normalizedAlias = normalizeAlias(header);

  return NON_MODULE_HEADER_ALIASES.some((alias) => {
    const normalizedNonModuleHeader = normalizeHeader(alias);
    const normalizedNonModuleAlias = normalizeAlias(alias);

    return (
      normalizedHeader === normalizedNonModuleHeader ||
      normalizedAlias === normalizedNonModuleAlias
    );
  });
}

function isExemptValue(value: unknown): boolean {
  const text = cleanText(value).toLowerCase();

  if (!text) return false;

  return (
    text === "exempt" ||
    text === "exempted" ||
    text === "exemption" ||
    text.includes("exempt")
  );
}

function isStudyTermValue(value: unknown): boolean {
  const text = cleanText(value).toUpperCase();

  if (!text) return false;

  return /^T\d{4}[A-Z]$/.test(text);
}

function parseModuleStudyValue(value: unknown): {
  shouldCreate: boolean;
  status?: StudyPlanModule["status"];
  studyTerm?: string;
  warning?: string;
} {
  const text = cleanText(value);

  if (!text) {
    return {
      shouldCreate: false,
    };
  }

  if (isExemptValue(text)) {
    return {
      shouldCreate: true,
      status: "exempted",
      studyTerm: undefined,
    };
  }

  if (isStudyTermValue(text)) {
    return {
      shouldCreate: true,
      status: "planned",
      studyTerm: text.toUpperCase(),
    };
  }

  return {
    shouldCreate: false,
    warning: `Unrecognized study term or exempted value: ${text}`,
  };
}

function findHeaderIndex(headers: string[], aliases: string[]): number {
  const normalizedAliases = aliases.flatMap((alias) => [
    normalizeHeader(alias),
    normalizeAlias(alias),
  ]);

  return headers.findIndex((header) => {
    const normalizedHeader = normalizeHeader(header);
    const normalizedHeaderAlias = normalizeAlias(header);

    return (
      normalizedAliases.includes(normalizedHeader) ||
      normalizedAliases.includes(normalizedHeaderAlias)
    );
  });
}

function getValueByAliases(row: ParsedExcelRow, aliases: string[]): string {
  const index = findHeaderIndex(row.headers, aliases);

  if (index < 0) return "";

  return cleanText(row.values[index]);
}

function findFirstModuleCodeColumn(headers: string[]): number {
  return headers.findIndex((header) => {
    const normalized = normalizeHeader(header);
    const alias = normalizeAlias(header);

    return normalized === "module code" || alias === "module_code";
  });
}

function parseWorkbook(file: File): Promise<ParsedExcelRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error("Failed to read Excel file."));
    };

    reader.onload = () => {
      try {
        const arrayBuffer = reader.result as ArrayBuffer;

        const workbook = XLSX.read(arrayBuffer, {
          type: "array",
        });

        const firstSheetName = workbook.SheetNames[0];

        if (!firstSheetName) {
          throw new Error("Excel file does not contain any worksheet.");
        }

        const worksheet = workbook.Sheets[firstSheetName];

        const rawRows = XLSX.utils.sheet_to_json<ExcelCell[]>(worksheet, {
          header: 1,
          defval: "",
          blankrows: false,
        });

        if (rawRows.length === 0) {
          resolve([]);
          return;
        }

        const headers = rawRows[0].map((cell) => cleanText(cell));

        const rows: ParsedExcelRow[] = rawRows
          .slice(1)
          .map((values, index) => ({
            headers,
            values,
            rowNumber: index + 2,
          }))
          .filter((row) =>
            row.values.some((cell) => cleanText(cell).length > 0)
          );

        resolve(rows);
      } catch (error) {
        reject(error);
      }
    };

    reader.readAsArrayBuffer(file);
  });
}

function buildStudentFromRow(
  row: ParsedExcelRow,
  programmeCode: string,
  errors: InitialStudyPlanUploadError[]
): StudyPlanStudent | null {
  const studentId = getValueByAliases(row, STUDENT_FIELD_ALIASES.studentId);

  const studentName = getValueByAliases(
    row,
    STUDENT_FIELD_ALIASES.studentName
  );

  const studyMode = getValueByAliases(row, STUDENT_FIELD_ALIASES.studyMode);

  const programmeStream =
    getValueByAliases(row, STUDENT_FIELD_ALIASES.programmeStream) || "nil";

  const intakeLevel = getValueByAliases(
    row,
    STUDENT_FIELD_ALIASES.intakeLevel
  );

  const intakeTerm = getValueByAliases(row, STUDENT_FIELD_ALIASES.intakeTerm);

  if (!studentId) {
    errors.push({
      row: row.rowNumber,
      message: "Missing required field: student id",
    });
  }

  if (!studentName) {
    errors.push({
      row: row.rowNumber,
      message: "Missing required field: student name",
    });
  }

  if (!studyMode) {
    errors.push({
      row: row.rowNumber,
      message: "Missing required field: study mode",
    });
  }

  if (!studentId || !studentName || !studyMode) {
    return null;
  }

  const student = {
    studentId,
    studentName,
    programmeCode,
    programmeStream,
    studyMode,
    intakeLevel: optionalText(intakeLevel),
    intakeTerm: optionalText(intakeTerm),
    studentStatus: "potential",
  } as StudyPlanStudent;

  return student;
}

function createStudyPlanModule(params: {
  student: StudyPlanStudent;
  moduleCode: string;
  parsed: {
    status?: StudyPlanModule["status"];
    studyTerm?: string;
  };
}): StudyPlanModule {
  const { student, moduleCode, parsed } = params;

  return {
    studentId: student.studentId,
    programmeCode: student.programmeCode,
    programmeStream: student.programmeStream,

    moduleCode,

    /**
     * Temporary fallback.
     *
     * saveStudyPlan / studyPlanService should later enrich this from
     * the modules table using the full module code.
     */
    moduleName: moduleCode,

    moduleYear: undefined,
    moduleTermPattern: undefined,
    deliveryMode: undefined,
    moduleSequence: undefined,

    planStage: "programme",
    status: parsed.status ?? "planned",
    studyTerm: parsed.studyTerm,

    isExempted: parsed.status === "exempted",
    isFailed: false,
    isLocked: false,

    remark: undefined,
  };
}

function mergeModuleIntoMap(
  moduleMap: Map<string, StudyPlanModule>,
  nextModule: StudyPlanModule
) {
  const existing = moduleMap.get(nextModule.moduleCode);

  if (!existing) {
    moduleMap.set(nextModule.moduleCode, nextModule);
    return;
  }

  if (nextModule.status === "exempted") {
    moduleMap.set(nextModule.moduleCode, nextModule);
    return;
  }

  if (!existing.studyTerm && nextModule.studyTerm) {
    moduleMap.set(nextModule.moduleCode, nextModule);
  }
}

/**
 * Format A:
 *
 * Repeated column pairs:
 * - Module code | Study term | Module code | Study term
 *
 * In this format, module code is stored in the cell value.
 */
function buildModulesFromModulePairs(
  row: ParsedExcelRow,
  student: StudyPlanStudent,
  warnings: InitialStudyPlanUploadWarning[]
): {
  modules: StudyPlanModule[];
  skippedModuleCells: number;
  usedPairFormat: boolean;
} {
  const moduleMap = new Map<string, StudyPlanModule>();
  let skippedModuleCells = 0;

  const firstModuleColumnIndex = findFirstModuleCodeColumn(row.headers);

  if (firstModuleColumnIndex < 0) {
    return {
      modules: [],
      skippedModuleCells,
      usedPairFormat: false,
    };
  }

  let foundAtLeastOnePair = false;

  for (
    let columnIndex = firstModuleColumnIndex;
    columnIndex < row.values.length;
    columnIndex += 2
  ) {
    const moduleHeader = row.headers[columnIndex] ?? "";
    const studyTermHeader = row.headers[columnIndex + 1] ?? "";

    const normalizedModuleHeader = normalizeAlias(moduleHeader);
    const normalizedStudyTermHeader = normalizeAlias(studyTermHeader);

    const looksLikeModulePair =
      normalizedModuleHeader === "module_code" &&
      normalizedStudyTermHeader === "study_term";

    if (!looksLikeModulePair) {
      continue;
    }

    foundAtLeastOnePair = true;

    const rawModuleCode = row.values[columnIndex];
    const rawStudyTerm = row.values[columnIndex + 1];

    const moduleCode = normalizeModuleCode(rawModuleCode);
    const parsed = parseModuleStudyValue(rawStudyTerm);

    if (!moduleCode && !cleanText(rawStudyTerm)) {
      continue;
    }

    if (moduleCode && !isValidModuleCode(moduleCode)) {
      skippedModuleCells += 1;

      warnings.push({
        row: row.rowNumber,
        studentId: student.studentId,
        moduleCode,
        column: `Column ${columnIndex + 1}`,
        value: cleanText(rawModuleCode),
        message:
          "Invalid module code format. Module codes may contain letters, numbers, underscores, and hyphens.",
      });

      continue;
    }

    if (!moduleCode && cleanText(rawStudyTerm)) {
      skippedModuleCells += 1;

      warnings.push({
        row: row.rowNumber,
        studentId: student.studentId,
        column: `Column ${columnIndex + 1}`,
        value: cleanText(rawStudyTerm),
        message: "Study term exists but module code is missing.",
      });

      continue;
    }

    if (moduleCode && !cleanText(rawStudyTerm)) {
      skippedModuleCells += 1;

      warnings.push({
        row: row.rowNumber,
        studentId: student.studentId,
        moduleCode,
        column: `Column ${columnIndex + 2}`,
        message: "Module code exists but study term is missing.",
      });

      continue;
    }

    if (parsed.warning) {
      skippedModuleCells += 1;

      warnings.push({
        row: row.rowNumber,
        studentId: student.studentId,
        moduleCode,
        column: `Column ${columnIndex + 2}`,
        value: cleanText(rawStudyTerm),
        message: parsed.warning,
      });

      continue;
    }

    if (!parsed.shouldCreate) {
      continue;
    }

    const nextModule = createStudyPlanModule({
      student,
      moduleCode,
      parsed,
    });

    mergeModuleIntoMap(moduleMap, nextModule);
  }

  return {
    modules: Array.from(moduleMap.values()),
    skippedModuleCells,
    usedPairFormat: foundAtLeastOnePair,
  };
}

/**
 * Format B:
 *
 * Module code as Excel column header:
 *
 * student id | student name | intake term | study mode | stream | HD401 | HD403_HDC | CS408_EE | AF-01
 *
 * In this format, the header is the module code and the cell value is:
 * - T2026A
 * - T2026B
 * - Exempted
 * - blank
 */
function buildModulesFromHeaderColumns(
  row: ParsedExcelRow,
  student: StudyPlanStudent,
  warnings: InitialStudyPlanUploadWarning[]
): {
  modules: StudyPlanModule[];
  skippedModuleCells: number;
} {
  const moduleMap = new Map<string, StudyPlanModule>();
  let skippedModuleCells = 0;

  row.headers.forEach((header, columnIndex) => {
    const rawHeader = cleanText(header);

    if (!rawHeader) return;

    if (isNonModuleHeader(rawHeader)) return;

    const moduleCode = normalizeModuleCode(rawHeader);

    if (!isValidModuleCode(moduleCode)) {
      return;
    }

    const rawStudyTerm = row.values[columnIndex];
    const parsed = parseModuleStudyValue(rawStudyTerm);

    if (!cleanText(rawStudyTerm)) {
      return;
    }

    if (parsed.warning) {
      skippedModuleCells += 1;

      warnings.push({
        row: row.rowNumber,
        studentId: student.studentId,
        moduleCode,
        column: rawHeader,
        value: cleanText(rawStudyTerm),
        message: parsed.warning,
      });

      return;
    }

    if (!parsed.shouldCreate) {
      return;
    }

    const nextModule = createStudyPlanModule({
      student,
      moduleCode,
      parsed,
    });

    mergeModuleIntoMap(moduleMap, nextModule);
  });

  return {
    modules: Array.from(moduleMap.values()),
    skippedModuleCells,
  };
}

function buildModulesFromRow(
  row: ParsedExcelRow,
  student: StudyPlanStudent,
  warnings: InitialStudyPlanUploadWarning[]
): {
  modules: StudyPlanModule[];
  skippedModuleCells: number;
} {
  /**
   * Prefer pair format when the Excel file explicitly uses:
   * Module code / Study term pairs.
   */
  const pairResult = buildModulesFromModulePairs(row, student, warnings);

  if (pairResult.usedPairFormat) {
    return {
      modules: pairResult.modules,
      skippedModuleCells: pairResult.skippedModuleCells,
    };
  }

  /**
   * Otherwise use header-column format, where each module code is a column.
   */
  return buildModulesFromHeaderColumns(row, student, warnings);
}

function buildGroupedPlans(
  rows: ParsedExcelRow[],
  context: InitialStudyPlanUploadContext
) {
  const errors: InitialStudyPlanUploadError[] = [];
  const warnings: InitialStudyPlanUploadWarning[] = [];
  const grouped = new Map<string, GroupedStudentPlan>();

  let skippedModuleCells = 0;

  const programmeCode = cleanText(context.programmeCode).toUpperCase();

  if (!programmeCode) {
    errors.push({
      message: "Please select a programme before uploading.",
    });

    return {
      grouped,
      errors,
      warnings,
      skippedModuleCells,
    };
  }

  rows.forEach((row) => {
    const student = buildStudentFromRow(row, programmeCode, errors);

    if (!student) return;

    const result = buildModulesFromRow(row, student, warnings);

    skippedModuleCells += result.skippedModuleCells;

    if (result.modules.length === 0) {
      warnings.push({
        row: row.rowNumber,
        studentId: student.studentId,
        message:
          "No valid module study term or exempted status found for this student.",
      });
    }

    grouped.set(student.studentId, {
      student,
      modules: result.modules,
      rowNumber: row.rowNumber,
    });
  });

  return {
    grouped,
    errors,
    warnings,
    skippedModuleCells,
  };
}

export async function uploadInitialStudyPlanExcel(
  file: File,
  context: InitialStudyPlanUploadContext
): Promise<InitialStudyPlanUploadResult> {
  const rows = await parseWorkbook(file);

  const { grouped, errors, warnings, skippedModuleCells } = buildGroupedPlans(
    rows,
    context
  );

  if (errors.length > 0) {
    return {
      totalRows: rows.length,
      totalStudents: grouped.size,
      successStudents: 0,
      failedStudents: grouped.size,
      skippedModuleCells,
      errors,
      warnings,
    };
  }

  let successStudents = 0;
  let failedStudents = 0;

  for (const [studentId, plan] of grouped.entries()) {
    try {
      await saveStudyPlan(plan.student, plan.modules);
      successStudents += 1;
    } catch (error: any) {
      failedStudents += 1;

      errors.push({
        row: plan.rowNumber,
        studentId,
        message:
          error?.message ||
          `Failed to save study plan for student ${studentId}.`,
      });
    }
  }

  return {
    totalRows: rows.length,
    totalStudents: grouped.size,
    successStudents,
    failedStudents,
    skippedModuleCells,
    errors,
    warnings,
  };
}
