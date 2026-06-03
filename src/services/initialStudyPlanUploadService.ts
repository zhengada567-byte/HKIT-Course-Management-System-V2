import * as XLSX from "xlsx";

import type {
  StudyPlanModule,
  StudyPlanStudent,
} from "../pages/programme-leader/make-study-plan/types";


import {
  inferPlanStageFromModuleCode,
  isDegreeStyleModuleCode,
  isHdStyleModuleCode,
} from "../lib/studyPlanModuleCode";

import {
  parseArticulationFromUpload,
  parseRemarkFromUpload,
} from "../lib/studyPlanCsvFormat";

import {
  generateStudyPlanForStudent,
  getDegreeStartTermAfterBridging,
} from "../pages/programme-leader/make-study-plan/studyPlanRules";

import {
  buildBridgingModulesFromUploadRow,
  clearStudyPlanServiceCaches,
  formatStudyPlanSaveError,
  getProgrammeTypeByCode,
  getStudyPlanSettingsCached,
  isDegreeProgrammeByCode,
  loadBridgingModuleOptionsForDegree,
  loadModuleMetadataForPlan,
  loadProgrammeModules,
  saveStudyPlan,
  syncStudyPlanPostSave,
  type StudyPlanSaveBatchOptions,
} from "./studyPlanService";

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
  /** Student IDs that were saved in this upload (for verifying batch results). */
  savedStudentIds: string[];
  /** True when end-of-upload timetable sync was skipped for speed. */
  timetableSyncSkipped?: boolean;
  errors: InitialStudyPlanUploadError[];
  warnings: InitialStudyPlanUploadWarning[];
}

export interface InitialStudyPlanUploadError {
  row?: number;
  studentId?: string;
  message: string;
}

/** Whole-file failures (no row) block the save phase; row errors skip that student only. */
function isBlockingUploadError(error: InitialStudyPlanUploadError): boolean {
  return error.row === undefined && !error.studentId;
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
  programmeCode: ["programme_code", "programme code"],
  programmeStream: [
    "programme_stream",
    "programme stream",
    "program_stream",
    "program stream",
    "stream",
  ],
  articulation: [
    "articulation",
    "ok_to_articulate",
    "ok to articulate",
    "原校升學",
  ],
  remark1: ["remark1", "remark 1"],
  remark2: ["remark2", "remark 2"],
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
  "programme_code",
  "programme code",
  "articulation",
  "ok_to_articulate",
  "ok to articulate",
  "原校升學",
  "remark1",
  "remark 1",
  "remark2",
  "remark 2",
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

/** Excel often stores student IDs as numbers; keep a stable integer string. */
function normalizeStudentIdFromUpload(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.round(value));
  }

  const text = cleanText(value);

  if (/^\d+\.0+$/.test(text)) {
    return text.replace(/\.0+$/, "");
  }

  return text;
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
  return canonicalizeModuleCodeForUpload(value);
}

/**
 * Normalize Excel module codes before upload.
 * - HD406 -> HD401, HD407 -> HD402
 * - HD403_HDC -> HD403, HD402_N -> HD402
 * - CS422 (ASGN) -> CS422
 */
export function canonicalizeModuleCodeForUpload(value: unknown): string {
  let code = cleanText(value)
    .toUpperCase()
    .replace(/\s*\([^)]*\)/g, "");

  const explicitAliases: Record<string, string> = {
    HD406: "HD401",
    HD407: "HD402",
  };

  if (explicitAliases[code]) {
    return explicitAliases[code];
  }

  const underscoreIndex = code.indexOf("_");

  if (underscoreIndex > 0) {
    const base = code.slice(0, underscoreIndex);

    if (explicitAliases[base]) {
      return explicitAliases[base];
    }

    if (/^[A-Z]{2,4}\d{3}[A-Z]?$/.test(base)) {
      return base;
    }
  }

  return code;
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

export interface InitialStudyPlanUploadOptions {
  /** When true, Degree uploads accept any module code (same as HD). */
  relaxed?: boolean;
  /** When true, defer timetable sync until all students are saved. */
  deferPostSync?: boolean;
  /**
   * When true (default for UI), skip full-database timetable sync after upload.
   * Sync separately when needed — it scans all study plans and is slow.
   */
  skipTimetableSync?: boolean;
}

const UPLOAD_SAVE_CONCURRENCY = 4;

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex]);
    }
  }

  const workerCount = Math.min(limit, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker())
  );
}

function buildUploadBatchMetadataInputs(
  grouped: Map<string, GroupedStudentPlan>
) {
  const inputs: Array<{
    moduleCode: string;
    programmeCode?: string;
    programmeStream?: string;
    moduleTerm?: string;
    moduleTermPattern?: string;
  }> = [];

  for (const plan of grouped.values()) {
    for (const module of plan.modules) {
      inputs.push({
        moduleCode: module.moduleCode,
        programmeCode: module.programmeCode || plan.student.programmeCode,
        programmeStream: module.programmeStream || plan.student.programmeStream,
        moduleTerm: module.moduleTerm,
        moduleTermPattern: module.moduleTermPattern,
      });
    }
  }

  return inputs;
}

function parseWorkbookRows(arrayBuffer: ArrayBuffer): ParsedExcelRow[] {
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
    return [];
  }

  const headers = rawRows[0].map((cell) => cleanText(cell));

  return rawRows
    .slice(1)
    .map((values, index) => ({
      headers,
      values,
      rowNumber: index + 2,
    }))
    .filter((row) => row.values.some((cell) => cleanText(cell).length > 0));
}

function parseWorkbook(file: File): Promise<ParsedExcelRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error("Failed to read Excel file."));
    };

    reader.onload = () => {
      try {
        resolve(parseWorkbookRows(reader.result as ArrayBuffer));
      } catch (error) {
        reject(error);
      }
    };

    reader.readAsArrayBuffer(file);
  });
}

export function parseStudyPlanWorkbookBuffer(
  arrayBuffer: ArrayBuffer
): ParsedExcelRow[] {
  return parseWorkbookRows(arrayBuffer);
}

const DEGREE_UPLOAD_INTAKE_LEVEL = "Year 3";
const DEGREE_UPLOAD_STUDY_MODE = "FT" as const;

function normalizeStudyModeForUpload(
  value: string,
  options?: { isDegreeUpload?: boolean }
) {
  if (options?.isDegreeUpload) {
    return DEGREE_UPLOAD_STUDY_MODE;
  }

  const text = cleanText(value).toUpperCase();

  if (text === "FT" || text === "PT") {
    return text;
  }

  if (text.includes("PT")) {
    return "PT";
  }

  return "FT";
}

function buildStudentFromRow(
  row: ParsedExcelRow,
  programmeCode: string,
  errors: InitialStudyPlanUploadError[],
  options?: {
    isDegreeUpload?: boolean;
  }
): StudyPlanStudent | null {
  const isDegreeUpload = options?.isDegreeUpload ?? false;

  const studentId = normalizeStudentIdFromUpload(
    row.values[
      findHeaderIndex(row.headers, STUDENT_FIELD_ALIASES.studentId)
    ]
  );

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

  const rowProgrammeCode = getValueByAliases(
    row,
    STUDENT_FIELD_ALIASES.programmeCode
  );
  const articulation = getValueByAliases(
    row,
    STUDENT_FIELD_ALIASES.articulation
  );
  const remark1 = parseRemarkFromUpload(
    row.values[findHeaderIndex(row.headers, STUDENT_FIELD_ALIASES.remark1)]
  );
  const remark2 = parseRemarkFromUpload(
    row.values[findHeaderIndex(row.headers, STUDENT_FIELD_ALIASES.remark2)]
  );

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

  if (!studentId || !studentName) {
    return null;
  }

  if (
    rowProgrammeCode &&
    rowProgrammeCode.toUpperCase() !== programmeCode.toUpperCase()
  ) {
    errors.push({
      row: row.rowNumber,
      studentId,
      message: `programme code "${rowProgrammeCode}" does not match selected programme "${programmeCode}".`,
    });
    return null;
  }

  const student = {
    studentId,
    studentName,
    programmeCode,
    programmeStream: isDegreeUpload ? "nil" : programmeStream,
    studyMode: normalizeStudyModeForUpload(studyMode, { isDegreeUpload }),
    intakeLevel: isDegreeUpload
      ? DEGREE_UPLOAD_INTAKE_LEVEL
      : optionalText(intakeLevel),
    intakeTerm: optionalText(intakeTerm),
    studentStatus: "potential",
    okToArticulate: parseArticulationFromUpload(articulation),
    remark1,
    remark2,
  } as StudyPlanStudent;

  return student;
}

function createStudyPlanModule(params: {
  student: StudyPlanStudent;
  moduleCode: string;
  planStage?: StudyPlanModule["planStage"];
  parsed: {
    status?: StudyPlanModule["status"];
    studyTerm?: string;
  };
}): StudyPlanModule {
  const { student, moduleCode, parsed, planStage = "programme" } = params;

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

    planStage,
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

function classifyDegreeModulesByCodeStructure(
  modules: StudyPlanModule[]
): StudyPlanModule[] {
  return modules.map((module) => {
    const inferred = inferPlanStageFromModuleCode(module.moduleCode);

    if (!inferred || module.planStage === inferred) {
      return module;
    }

    return {
      ...module,
      planStage: inferred,
    };
  });
}

function buildGroupedPlans(
  rows: ParsedExcelRow[],
  context: InitialStudyPlanUploadContext,
  options?: {
    isDegreeUpload?: boolean;
    classifyDegreeModules?: boolean;
  }
) {
  const errors: InitialStudyPlanUploadError[] = [];
  const warnings: InitialStudyPlanUploadWarning[] = [];
  const grouped = new Map<string, GroupedStudentPlan>();

  let skippedModuleCells = 0;

  const programmeCode = cleanText(context.programmeCode).toUpperCase();
  const isDegreeUpload = options?.isDegreeUpload ?? false;

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
    const student = buildStudentFromRow(row, programmeCode, errors, {
      isDegreeUpload,
    });

    if (!student) return;

    const result = buildModulesFromRow(row, student, warnings);
    let modules = result.modules;

    if (options?.classifyDegreeModules) {
      modules = classifyDegreeModulesByCodeStructure(modules);
    }

    skippedModuleCells += result.skippedModuleCells;

    if (modules.length === 0) {
      warnings.push({
        row: row.rowNumber,
        studentId: student.studentId,
        message:
          "No valid module study term or exempted status found for this student.",
      });
    }

    grouped.set(student.studentId, {
      student,
      modules,
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

function parsedRowToRecord(row: ParsedExcelRow): Record<string, string> {
  const record: Record<string, string> = {};

  row.headers.forEach((header, index) => {
    const key = normalizeAlias(header);

    if (!key) return;

    record[key] = cleanText(row.values[index]);
  });

  return record;
}

function hasBridgingUploadColumns(row: ParsedExcelRow): boolean {
  return row.headers.some((header) =>
    normalizeAlias(header).startsWith("bridging_module_")
  );
}

function hasModulePairUploadColumns(row: ParsedExcelRow): boolean {
  const firstModuleColumnIndex = findFirstModuleCodeColumn(row.headers);

  if (firstModuleColumnIndex < 0) {
    return false;
  }

  for (
    let columnIndex = firstModuleColumnIndex;
    columnIndex < row.headers.length;
    columnIndex += 2
  ) {
    const moduleHeader = normalizeAlias(row.headers[columnIndex] ?? "");
    const studyTermHeader = normalizeAlias(row.headers[columnIndex + 1] ?? "");

    if (moduleHeader === "module_code" && studyTermHeader === "study_term") {
      return true;
    }
  }

  return false;
}

type DegreeUploadFormat = "bridging_columns" | "module_pairs";

function detectDegreeUploadFormat(row: ParsedExcelRow): DegreeUploadFormat | null {
  if (hasBridgingUploadColumns(row)) {
    return "bridging_columns";
  }

  if (hasModulePairUploadColumns(row)) {
    return "module_pairs";
  }

  return null;
}

function buildCatalogByModuleCode(options: StudyPlanModule[]) {
  const map = new Map<string, StudyPlanModule>();

  for (const option of options) {
    const moduleCode = normalizeModuleCode(option.moduleCode);

    if (!moduleCode) continue;

    const existing = map.get(moduleCode);

    if (!existing) {
      map.set(moduleCode, option);
      continue;
    }

    const existingStream = String(existing.programmeStream ?? "nil")
      .trim()
      .toLowerCase();
    const optionStream = String(option.programmeStream ?? "nil")
      .trim()
      .toLowerCase();

    if (existingStream === "nil" && optionStream !== "nil") {
      map.set(moduleCode, option);
    }
  }

  return map;
}

function applyPlanStageFromModuleCode(
  module: StudyPlanModule,
  catalogMatch?: StudyPlanModule
): StudyPlanModule {
  const inferred = inferPlanStageFromModuleCode(module.moduleCode);

  if (!inferred) {
    return module;
  }

  if (catalogMatch) {
    return {
      ...module,
      ...catalogMatch,
      id: undefined,
      studentId: module.studentId,
      studentProfileId: module.studentProfileId,
      planStage: inferred,
      status: module.status,
      studyTerm: module.studyTerm,
      isExempted: module.isExempted,
      isFailed: module.isFailed,
      isLocked: module.isLocked,
    };
  }

  return {
    ...module,
    planStage: inferred,
  };
}

function buildDegreeModulesFromModulePairs(
  row: ParsedExcelRow,
  student: StudyPlanStudent,
  bridgingOptions: StudyPlanModule[],
  degreeProgrammeModules: StudyPlanModule[],
  warnings: InitialStudyPlanUploadWarning[],
  options?: { relaxed?: boolean }
): {
  bridgingModules: StudyPlanModule[];
  programmeModulesFromImport: StudyPlanModule[];
} {
  const pairResult = buildModulesFromModulePairs(row, student, warnings);

  if (!pairResult.usedPairFormat) {
    throw new Error(
      "No valid Module code / Study term column pairs found."
    );
  }

  const degreeCatalogByCode = buildCatalogByModuleCode(degreeProgrammeModules);
  const bridgingCatalogByCode = buildCatalogByModuleCode(bridgingOptions);

  const bridgingModules: StudyPlanModule[] = [];
  const programmeModulesFromImport: StudyPlanModule[] = [];

  for (const parsed of pairResult.modules) {
    const moduleCode = normalizeModuleCode(parsed.moduleCode);
    const degreeMatch = degreeCatalogByCode.get(moduleCode);
    const bridgingMatch = bridgingCatalogByCode.get(moduleCode);

    if (parsed.status === "planned" && !parsed.studyTerm) {
      throw new Error(
        `Module ${moduleCode} is planned but has no study term.`
      );
    }

    if (degreeMatch) {
      programmeModulesFromImport.push({
        ...degreeMatch,
        id: undefined,
        studentId: student.studentId,
        studentProfileId: student.id,
        planStage: "programme",
        status: parsed.status ?? "planned",
        studyTerm: parsed.studyTerm,
        isExempted: parsed.status === "exempted",
        isFailed: parsed.status === "failed",
        isLocked: false,
      });
      continue;
    }

    if (bridgingMatch) {
      bridgingModules.push({
        ...bridgingMatch,
        id: undefined,
        studentId: student.studentId,
        studentProfileId: student.id,
        planStage: "bridging",
        status: parsed.status ?? "planned",
        studyTerm: parsed.studyTerm,
        isExempted: parsed.status === "exempted",
        isFailed: parsed.status === "failed",
        isLocked: false,
      });
      continue;
    }

    const inferred = inferPlanStageFromModuleCode(moduleCode);
    const treatAsBridging =
      inferred === "bridging" || isHdStyleModuleCode(moduleCode);
    const treatAsProgramme =
      inferred === "programme" || isDegreeStyleModuleCode(moduleCode);
    const allowUnknownCodes = options?.relaxed;

    if (treatAsBridging || treatAsProgramme || allowUnknownCodes) {
      if (treatAsBridging) {
        if (!bridgingMatch) {
          warnings.push({
            row: row.rowNumber,
            studentId: student.studentId,
            moduleCode,
            message: `Module ${moduleCode} is not in articulation settings for this degree; imported as bridging (HD-style code).`,
          });
        }

        bridgingModules.push(
          applyPlanStageFromModuleCode(
            createStudyPlanModule({
              student,
              moduleCode,
              planStage: "bridging",
              parsed,
            }),
            bridgingCatalogByCode.get(moduleCode)
          )
        );
        continue;
      }

      if (treatAsProgramme) {
        if (!degreeMatch) {
          warnings.push({
            row: row.rowNumber,
            studentId: student.studentId,
            moduleCode,
            message: `Module ${moduleCode} is not in the degree programme catalogue; imported as programme module (degree-style code).`,
          });
        }

        programmeModulesFromImport.push(
          applyPlanStageFromModuleCode(
            createStudyPlanModule({
              student,
              moduleCode,
              planStage: "programme",
              parsed,
            }),
            degreeCatalogByCode.get(moduleCode)
          )
        );
        continue;
      }

      programmeModulesFromImport.push(
        createStudyPlanModule({
          student,
          moduleCode,
          planStage: "programme",
          parsed,
        })
      );
      continue;
    }

    throw new Error(
      `Module ${moduleCode} is not part of this degree programme or its articulated bridging modules.`
    );
  }

  return {
    bridgingModules,
    programmeModulesFromImport,
  };
}

async function buildGroupedDegreePlans(
  rows: ParsedExcelRow[],
  context: InitialStudyPlanUploadContext,
  options?: { relaxed?: boolean }
) {
  const errors: InitialStudyPlanUploadError[] = [];
  const warnings: InitialStudyPlanUploadWarning[] = [];
  const grouped = new Map<string, GroupedStudentPlan>();

  const programmeCode = cleanText(context.programmeCode).toUpperCase();

  if (!programmeCode) {
    errors.push({
      message: "Please select a programme before uploading.",
    });

    return {
      grouped,
      errors,
      warnings,
      skippedModuleCells: 0,
    };
  }

  let skippedModuleCells = 0;

  const uploadFormat =
    rows.length > 0 ? detectDegreeUploadFormat(rows[0]) : null;

  if (!uploadFormat) {
    if (options?.relaxed) {
      return buildGroupedPlans(rows, context, {
        isDegreeUpload: true,
        classifyDegreeModules: true,
      });
    }

    errors.push({
      message:
        "Degree programme upload requires either bridging_module_1_code / bridging_module_1_study_term columns, or repeated Module code / Study term column pairs.",
    });

    return {
      grouped,
      errors,
      warnings,
      skippedModuleCells: 0,
    };
  }

  let bridgingOptions: StudyPlanModule[];

  try {
    bridgingOptions = await loadBridgingModuleOptionsForDegree({
      degreeProgrammeCode: programmeCode,
    });
  } catch (error) {
    errors.push({
      message: formatStudyPlanSaveError(
        error,
        "Failed to load bridging module options from articulation settings."
      ),
    });

    return {
      grouped,
      errors,
      warnings,
      skippedModuleCells: 0,
    };
  }

  let degreeProgrammeType: string | undefined;

  try {
    degreeProgrammeType = await getProgrammeTypeByCode(programmeCode);
  } catch (error) {
    errors.push({
      message: formatStudyPlanSaveError(
        error,
        `Failed to resolve programme type for ${programmeCode}.`
      ),
    });

    return {
      grouped,
      errors,
      warnings,
      skippedModuleCells: 0,
    };
  }

  let sharedProgrammeModules: StudyPlanModule[];

  try {
    sharedProgrammeModules = await loadProgrammeModules(programmeCode, "nil");
  } catch (error) {
    errors.push({
      message: formatStudyPlanSaveError(
        error,
        `Failed to load programme modules for ${programmeCode}.`
      ),
    });

    return {
      grouped,
      errors,
      warnings,
      skippedModuleCells: 0,
    };
  }

  if (sharedProgrammeModules.length === 0) {
    errors.push({
      message: `No programme modules found for ${programmeCode} / nil.`,
    });

    return {
      grouped,
      errors,
      warnings,
      skippedModuleCells: 0,
    };
  }

  for (const row of rows) {
    const student = buildStudentFromRow(row, programmeCode, errors, {
      isDegreeUpload: true,
    });

    if (!student) continue;

    const studentWithType = {
      ...student,
      programmeType: degreeProgrammeType,
      intakeLevel: DEGREE_UPLOAD_INTAKE_LEVEL,
      studyMode: DEGREE_UPLOAD_STUDY_MODE,
    };

    if (!studentWithType.intakeTerm) {
      errors.push({
        row: row.rowNumber,
        studentId: studentWithType.studentId,
        message: "Missing required field: intake term",
      });
      continue;
    }

    const rowRecord = parsedRowToRecord(row);

    let bridgingModules: StudyPlanModule[] = [];
    let programmeModulesFromImport: StudyPlanModule[] = [];
    const programmeModules = sharedProgrammeModules;

    try {
      if (uploadFormat === "bridging_columns") {
        bridgingModules = buildBridgingModulesFromUploadRow({
          row: rowRecord,
          bridgingOptions,
          student: studentWithType,
        });
      } else {
        const classified = buildDegreeModulesFromModulePairs(
          row,
          studentWithType,
          bridgingOptions,
          programmeModules,
          warnings,
          { relaxed: options?.relaxed }
        );

        bridgingModules = classified.bridgingModules;
        programmeModulesFromImport = classified.programmeModulesFromImport;
      }
    } catch (error) {
      errors.push({
        row: row.rowNumber,
        studentId: studentWithType.studentId,
        message:
          error instanceof Error
            ? error.message
            : "Failed to parse degree study plan modules from upload row.",
      });
      continue;
    }

    if (
      bridgingModules.length === 0 &&
      programmeModulesFromImport.length === 0
    ) {
      warnings.push({
        row: row.rowNumber,
        studentId: studentWithType.studentId,
        message:
          uploadFormat === "bridging_columns"
            ? "No bridging modules found. Degree programme modules will start from intake term."
            : "No module pairs found. Treating as bridging complete; degree programme modules will start from intake term.",
      });
    }

    let allModules: StudyPlanModule[];

    if (programmeModulesFromImport.length > 0) {
      allModules = [...bridgingModules, ...programmeModulesFromImport];
    } else {
      const startTerm = getDegreeStartTermAfterBridging(
        bridgingModules,
        studentWithType.intakeTerm
      );

      let generatedProgrammeModules: StudyPlanModule[];

      try {
        generatedProgrammeModules = generateStudyPlanForStudent({
          student: studentWithType,
          modules: programmeModules.map((module) => ({
            ...module,
            studentId: studentWithType.studentId,
          })),
          startTerm,
        });
      } catch (error) {
        errors.push({
          row: row.rowNumber,
          studentId: studentWithType.studentId,
          message:
            error instanceof Error
              ? error.message
              : "Failed to generate degree programme study plan.",
        });
        continue;
      }

      allModules = [...bridgingModules, ...generatedProgrammeModules];
    }

    grouped.set(studentWithType.studentId, {
      student: studentWithType,
      modules: allModules,
      rowNumber: row.rowNumber,
    });
  }

  return {
    grouped,
    errors,
    warnings,
    skippedModuleCells,
  };
}

export async function previewInitialStudyPlanRows(
  rows: ParsedExcelRow[],
  context: InitialStudyPlanUploadContext,
  options?: Pick<InitialStudyPlanUploadOptions, "relaxed">
) {
  const programmeCode = cleanText(context.programmeCode).toUpperCase();
  const isDegree = await isDegreeProgrammeByCode(programmeCode);

  if (!isDegree) {
    return buildGroupedPlans(rows, context);
  }

  return buildGroupedDegreePlans(rows, context, {
    relaxed: Boolean(options?.relaxed),
  });
}

export async function uploadInitialStudyPlanExcel(
  file: File,
  context: InitialStudyPlanUploadContext,
  options?: InitialStudyPlanUploadOptions
): Promise<InitialStudyPlanUploadResult> {
  const rows = await parseWorkbook(file);

  return uploadInitialStudyPlanRows(rows, context, options);
}

export async function uploadInitialStudyPlanRows(
  rows: ParsedExcelRow[],
  context: InitialStudyPlanUploadContext,
  options?: InitialStudyPlanUploadOptions
): Promise<InitialStudyPlanUploadResult> {
  clearStudyPlanServiceCaches();

  const programmeCode = cleanText(context.programmeCode).toUpperCase();

  const isDegree = await isDegreeProgrammeByCode(programmeCode);
  const useRelaxedUpload = Boolean(options?.relaxed);

  const { grouped, errors, warnings, skippedModuleCells } = isDegree
    ? await buildGroupedDegreePlans(rows, context, {
        relaxed: useRelaxedUpload,
      })
    : buildGroupedPlans(rows, context);

  const parseErrors = errors.filter((error) => !isBlockingUploadError(error));

  if (errors.some(isBlockingUploadError)) {
    return {
      totalRows: rows.length,
      totalStudents: grouped.size,
      successStudents: 0,
      failedStudents: grouped.size + parseErrors.length,
      skippedModuleCells,
      savedStudentIds: [],
      errors,
      warnings,
    };
  }

  let successStudents = 0;
  let failedStudents = parseErrors.length;
  const savedStudentIds: string[] = [];
  const skipTimetableSync = options?.skipTimetableSync ?? !options?.deferPostSync;

  const saveEntries = Array.from(grouped.entries());

  if (saveEntries.length > 0) {
    const batch: StudyPlanSaveBatchOptions = {
      settings: await getStudyPlanSettingsCached(),
      isDegreeProgramme: isDegree,
    };

    const metadataInputs = buildUploadBatchMetadataInputs(grouped);

    if (metadataInputs.length > 0) {
      batch.moduleMetadataMap = await loadModuleMetadataForPlan(
        programmeCode,
        "nil",
        metadataInputs
      );
    }

    await runWithConcurrency(saveEntries, UPLOAD_SAVE_CONCURRENCY, async ([
      studentId,
      plan,
    ]) => {
      try {
        await saveStudyPlan(plan.student, plan.modules, {
          skipPostSync: true,
          skipDegreeReconcile: isDegree,
          batch,
        });
        successStudents += 1;
        savedStudentIds.push(studentId);
      } catch (error: unknown) {
        failedStudents += 1;

        errors.push({
          row: plan.rowNumber,
          studentId,
          message: formatStudyPlanSaveError(
            error,
            `Failed to save study plan for student ${studentId}.`
          ),
        });
      }
    });
  }

  let timetableSyncSkipped = false;

  if (successStudents > 0 && !options?.deferPostSync && !skipTimetableSync) {
    try {
      await syncStudyPlanPostSave();
    } catch (error: unknown) {
      errors.push({
        message: formatStudyPlanSaveError(
          error,
          "Study plans were saved, but syncing timetable student numbers failed. Students are in the list; retry sync from admin or re-upload if counts look wrong."
        ),
      });
    }
  } else if (successStudents > 0 && skipTimetableSync && !options?.deferPostSync) {
    timetableSyncSkipped = true;
  }

  return {
    totalRows: rows.length,
    totalStudents: grouped.size,
    successStudents,
    failedStudents,
    skippedModuleCells,
    savedStudentIds,
    timetableSyncSkipped,
    errors,
    warnings,
  };
}
