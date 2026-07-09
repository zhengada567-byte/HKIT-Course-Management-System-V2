import FileSaver from "file-saver";

const saveAs = FileSaver.saveAs;

import {
  normalizeIntakeLevel,
  normalizeProgrammeYear,
} from "../lib/programmeYear";
import { supabase } from "../lib/supabase";
import {
  deleteByIdsInBatches,
  fetchAllPaginatedRows,
  SUPABASE_DEFAULT_PAGE_SIZE,
} from "../lib/supabasePagination";
import {
  getAcademicYearVariants,
  normalizeAcademicYear,
} from "../lib/utils";

import type {
  StudyPlanModule,
  StudyPlanSettings,
  StudyPlanStudent,
} from "../pages/programme-leader/make-study-plan/types";

import {
  calculateStudentStatus,
  getDefaultIntakeLevel,
  getEarliestStudyTerm,
  getLatestStudyTerm,
  getLatestBridgingStudyTerm,
  getTermIndex,
  intakeTermToIntakeYear,
  isDegreeProgramme,
  isDegreeProgrammeType,
  isHDProgrammeType,
  studyTermToAcademicYear,
} from "../pages/programme-leader/make-study-plan/helpers";

import {
  getCurrentAcademicYear,
  getCurrentStudyTerm,
  setCurrentStudyTermValue,
  setCurrentAcademicYearValue,
} from "./academicYearService";
import { resolveExpectedStudentNumberOnSync } from "./studentNumberService";

import {
  generateStudyPlanForStudent,
  getDegreeStartTermAfterBridging,
} from "../pages/programme-leader/make-study-plan/studyPlanRules";

import { normalizeModuleType } from "./moduleService";

import {
  getBaseModuleCode,
} from "../lib/studyPlanModuleCode";
import { isModuleCodeInDegreeCatalog } from "../lib/studyPlanDegreeCatalog";

/**
 * Keep stream value exactly as database stores it.
 *
 * Important:
 * modules.stream_code = programmes.programme_stream
 *
 * Example:
 * "Artificial Intelligence"
 *
 * Do not uppercase it, otherwise exact Supabase match may fail.
 */
function cleanStream(value?: string | null): string {
  return String(value ?? "").trim();
}

/**
 * Normalize stream for storage in aggregated tables.
 *
 * Use "nil" instead of empty string so grouping and conflict keys are stable.
 */
function normalizeStream(value?: string | null): string {
  return cleanStream(value || "nil") || "nil";
}

/*
 * Recalculate debug logging (academic_year / study_term totals in console).
 * Re-enable: uncomment block below and the `if (debug) { ... }` in recalculateActualStudentNumbers.
 *
 * localStorage.setItem('debugStudyPlanRecalculate', '1')
 * localStorage.setItem('debugStudyPlanRecalculateFilter', 'HDC|CS401|T2026C')
 */
// const STUDY_PLAN_RECALC_DEBUG_KEY = "debugStudyPlanRecalculate";
// const STUDY_PLAN_RECALC_FILTER_KEY = "debugStudyPlanRecalculateFilter";
//
// function isStudyPlanRecalculateDebugEnabled() {
//   try {
//     if (localStorage.getItem(STUDY_PLAN_RECALC_DEBUG_KEY) === "1") {
//       return true;
//     }
//   } catch {
//     // ignore (SSR / privacy mode)
//   }
//
//   return import.meta.env.DEV;
// }
//
// function getStudyPlanRecalculateDebugFilter(): string {
//   try {
//     return String(localStorage.getItem(STUDY_PLAN_RECALC_FILTER_KEY) ?? "").trim();
//   } catch {
//     return "";
//   }
// }
//
// function logStudyPlanRecalculate(
//   message: string,
//   payload?: Record<string, unknown>
// ) {
//   if (!isStudyPlanRecalculateDebugEnabled()) {
//     return;
//   }
//
//   if (payload) {
//     console.info(`[recalculateActualStudentNumbers] ${message}`, payload);
//     return;
//   }
//
//   console.info(`[recalculateActualStudentNumbers] ${message}`);
// }

const RECALCULATE_UPSERT_BATCH_SIZE = 500;

const STUDY_PLAN_ACTUAL_UPSERT_CONFLICT =
  "academic_year,study_term,module_code,programme_code,programme_stream,study_mode";

type StudyPlanActualAggregateRow = {
  academic_year: string;
  study_term: string;
  module_code: string;
  module_name: string | null;
  programme_code: string;
  programme_stream: string;
  study_mode: string;
  actual_student_number: number;
  updated_at: string;
};

function buildStudyPlanActualAggregateKey(row: {
  academic_year: string;
  study_term: string;
  module_code: string;
  programme_code: string;
  programme_stream: string;
  study_mode: string;
}) {
  return [
    normalizeAcademicYear(row.academic_year),
    String(row.study_term ?? "").trim(),
    String(row.module_code ?? "").trim(),
    String(row.programme_code ?? "").trim(),
    normalizeStream(row.programme_stream),
    String(row.study_mode ?? "").trim(),
  ].join("|");
}

function studyPlanActualRowMatchesCanonical(
  dbRow: {
    academic_year: string;
    study_term: string;
    module_code: string;
    programme_code: string;
    programme_stream: string | null;
    study_mode: string | null;
  },
  canonical: StudyPlanActualAggregateRow
) {
  return (
    normalizeAcademicYear(dbRow.academic_year) === canonical.academic_year &&
    String(dbRow.study_term ?? "").trim() === canonical.study_term &&
    String(dbRow.module_code ?? "").trim() === canonical.module_code &&
    String(dbRow.programme_code ?? "").trim() === canonical.programme_code &&
    normalizeStream(dbRow.programme_stream) === canonical.programme_stream &&
    String(dbRow.study_mode ?? "").trim() === canonical.study_mode
  );
}

async function deleteStudyPlanActualOrphanRows(
  canonicalRows: StudyPlanActualAggregateRow[]
) {
  const canonicalByKey = new Map<string, StudyPlanActualAggregateRow>();

  for (const row of canonicalRows) {
    canonicalByKey.set(buildStudyPlanActualAggregateKey(row), row);
  }

  const existingRows = await fetchAllPaginatedRows<{
    id: string;
    academic_year: string;
    study_term: string;
    module_code: string;
    programme_code: string;
    programme_stream: string | null;
    study_mode: string | null;
  }>({
    fetchPage: ({ from, to }) =>
      supabase
        .from("study_plan_actual_student_numbers")
        .select(
          "id, academic_year, study_term, module_code, programme_code, programme_stream, study_mode"
        )
        .order("id", { ascending: true })
        .range(from, to),
  });

  const keptKeys = new Set<string>();
  const orphanIds: string[] = [];

  for (const dbRow of existingRows) {
    const key = buildStudyPlanActualAggregateKey({
      academic_year: String(dbRow.academic_year ?? ""),
      study_term: String(dbRow.study_term ?? ""),
      module_code: String(dbRow.module_code ?? ""),
      programme_code: String(dbRow.programme_code ?? ""),
      programme_stream: String(dbRow.programme_stream ?? ""),
      study_mode: String(dbRow.study_mode ?? ""),
    });

    const canonical = canonicalByKey.get(key);

    if (
      !canonical ||
      !studyPlanActualRowMatchesCanonical(dbRow, canonical) ||
      keptKeys.has(key)
    ) {
      orphanIds.push(dbRow.id);
      continue;
    }

    keptKeys.add(key);
  }

  return deleteByIdsInBatches({
    ids: orphanIds,
    deleteByIds: (ids) =>
      supabase.from("study_plan_actual_student_numbers").delete().in("id", ids),
  });
}

// export function setStudyPlanRecalculateDebug(enabled: boolean) {
//   try {
//     if (enabled) {
//       localStorage.setItem(STUDY_PLAN_RECALC_DEBUG_KEY, "1");
//       console.info(
//         "[recalculateActualStudentNumbers] Debug logging ON. Optional filter: localStorage.setItem('debugStudyPlanRecalculateFilter', 'HDC|CS401|T2026C')"
//       );
//       return;
//     }
//
//     localStorage.removeItem(STUDY_PLAN_RECALC_DEBUG_KEY);
//     console.info("[recalculateActualStudentNumbers] Debug logging OFF");
//   } catch (error) {
//     console.warn(
//       "[recalculateActualStudentNumbers] Could not set debug flag:",
//       error
//     );
//   }
// }

/**
 * Normalize text for identity key.
 */
function normalizeKeyPart(value?: string | number | null): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Parse programmes.articulation under the current real data design.
 *
 * Current design:
 * - articulation is stored on HD programme rows.
 * - It records which Degree programme codes this HD stream can articulate to.
 *
 * Examples:
 * - UWLCS
 * - UWLBS/WUBM
 * - UWLBS;WUBM
 * - UWLBS, WUBM
 */
export function parseArticulatedDegreeCodes(value?: string | null): string[] {
  const text = String(value ?? "").trim();

  if (!text) return [];

  return Array.from(
    new Set(
      text
        .split(/[\/;,]+/g)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function doesProgrammeRowArticulateToDegree(params: {
  articulation?: string | null;
  degreeProgrammeCode: string;
}): boolean {
  const degreeCode = String(params.degreeProgrammeCode ?? "")
    .trim()
    .toUpperCase();

  if (!degreeCode) return false;

  const articulatedDegreeCodes = parseArticulatedDegreeCodes(
    params.articulation
  );

  return articulatedDegreeCodes.includes(degreeCode);
}


/**
 * Module identity rule (matches DB modules table):
 * module_code + programme_code + programme_stream
 */
function buildModuleIdentityKey(input: {
  moduleCode?: string | null;
  programmeCode?: string | null;
  programmeStream?: string | null;
}) {
  return [
    input.moduleCode,
    input.programmeCode,
    normalizeStream(input.programmeStream),
  ]
    .map(normalizeKeyPart)
    .join("|");
}

/** Matches DB unique constraint on study_plan_modules (per student profile). */
export function buildStudyPlanModulePersistKey(module: {
  moduleCode?: string | null;
  programmeCode?: string | null;
  programmeStream?: string | null;
  planStage?: string | null;
}): string {
  return [
    normalizeKeyPart(module.moduleCode),
    normalizeKeyPart(module.programmeCode),
    normalizeStream(module.programmeStream),
    normalizeKeyPart(module.planStage ?? "programme"),
  ].join("|");
}

const STUDY_PLAN_MODULE_ROW_UNIQUE_CONFLICT =
  "student_profile_id,module_code,programme_code,programme_stream,plan_stage";

function studyPlanModulePersistKeyForStudent(
  module: StudyPlanModule,
  student: Pick<StudyPlanStudent, "programmeCode" | "programmeStream">
) {
  return buildStudyPlanModulePersistKey({
    moduleCode: module.moduleCode,
    programmeCode: module.programmeCode || student.programmeCode,
    programmeStream: module.programmeStream || student.programmeStream,
    planStage: module.planStage,
  });
}

/**
 * One row per DB unique key; prefer the row that already has an id.
 */
function dedupeStudyPlanModulesByPersistKey(
  modules: StudyPlanModule[],
  student: Pick<StudyPlanStudent, "programmeCode" | "programmeStream">
): StudyPlanModule[] {
  const byKey = new Map<string, StudyPlanModule>();

  for (const module of modules) {
    const key = studyPlanModulePersistKeyForStudent(module, student);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, module);
      continue;
    }

    if (!existing.id && module.id) {
      byKey.set(key, module);
      continue;
    }

    if (existing.id && !module.id) {
      continue;
    }

    byKey.set(key, module);
  }

  return Array.from(byKey.values());
}

async function attachExistingStudyPlanModuleIds(
  studentProfileId: string,
  modules: StudyPlanModule[],
  student: Pick<StudyPlanStudent, "programmeCode" | "programmeStream">
): Promise<StudyPlanModule[]> {
  const { data: existingRows, error } = await supabase
    .from("study_plan_modules")
    .select("id, module_code, programme_code, programme_stream, plan_stage")
    .eq("student_profile_id", studentProfileId);

  if (error) {
    throw error;
  }

  const idByKey = new Map<string, string>();

  for (const row of existingRows ?? []) {
    const id = String(row.id ?? "").trim();

    if (!id) {
      continue;
    }

    idByKey.set(
      buildStudyPlanModulePersistKey({
        moduleCode: row.module_code,
        programmeCode: row.programme_code,
        programmeStream: row.programme_stream,
        planStage: row.plan_stage,
      }),
      id
    );
  }

  return modules.map((module) => {
    if (module.id) {
      return module;
    }

    const existingId = idByKey.get(
      studyPlanModulePersistKeyForStudent(module, student)
    );

    if (!existingId) {
      return module;
    }

    return { ...module, id: existingId };
  });
}

/**
 * Build identity key directly from modules table row.
 */
function buildModuleRowIdentityKey(row: any) {
  return buildModuleIdentityKey({
    moduleCode: row.module_code,
    programmeCode: row.programme_code,
    programmeStream: row.stream_code,
  });
}

/**
 * Resolve modules-table metadata for a study plan row.
 *
 * Stream matching (same programme_code):
 * 1) Exact programme_stream on the study plan row (or student stream)
 * 2) Fallback to stream_code = "nil" (modules shared by all streams)
 */
function resolveModuleMetadataFromMap(
  module: {
    moduleCode: string;
    programmeCode?: string;
    programmeStream?: string;
  },
  student: StudyPlanStudent,
  metadataMap: Map<string, any>
) {
  const programmeCode = String(
    module.programmeCode || student.programmeCode
  ).trim();
  const stream = normalizeStream(
    module.programmeStream ?? student.programmeStream
  );

  const exact = metadataMap.get(
    buildModuleIdentityKey({
      moduleCode: module.moduleCode,
      programmeCode,
      programmeStream: stream,
    })
  );

  if (exact) {
    return exact;
  }

  if (stream === "nil") {
    return undefined;
  }

  return metadataMap.get(
    buildModuleIdentityKey({
      moduleCode: module.moduleCode,
      programmeCode,
      programmeStream: "nil",
    })
  );
}

/**
 * Resolve modules.module_term for timetable sync (catalog offered term).
 * Same stream fallback as resolveModuleMetadataFromMap.
 */
function resolveCatalogModuleTermFromMap(
  module: {
    moduleCode: string;
    programmeCode: string;
    programmeStream: string;
  },
  catalogTermMap: Map<string, string>
): string | undefined {
  const programmeCode = String(module.programmeCode ?? "").trim();
  const stream = normalizeStream(module.programmeStream);

  const exact = catalogTermMap.get(
    buildModuleIdentityKey({
      moduleCode: module.moduleCode,
      programmeCode,
      programmeStream: stream,
    })
  );

  if (exact) {
    return exact;
  }

  if (stream === "nil") {
    return undefined;
  }

  return catalogTermMap.get(
    buildModuleIdentityKey({
      moduleCode: module.moduleCode,
      programmeCode,
      programmeStream: "nil",
    })
  );
}

export function formatStudyPlanSaveError(
  error: unknown,
  context?: string
): string {
  const parts: string[] = [];

  if (context) {
    parts.push(context);
  }

  if (error && typeof error === "object") {
    const err = error as {
      message?: string;
      details?: string;
      hint?: string;
      code?: string;
    };

    if (err.message) {
      parts.push(err.message);
    }
    if (err.details) {
      parts.push(`Details: ${err.details}`);
    }
    if (err.hint) {
      parts.push(`Hint: ${err.hint}`);
    }
    if (err.code) {
      parts.push(`Code: ${err.code}`);
    }
  }

  if (parts.length > 0) {
    return parts.join("\n");
  }

  if (error instanceof Error) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error while saving study plan.";
  }
}

function isMissingOkToArticulateColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const err = error as { message?: string; details?: string; code?: string };
  const combined = [err.message, err.details, err.code].filter(Boolean).join(" ");

  return (
    combined.includes("ok_to_articulate") &&
    (combined.includes("schema cache") ||
      combined.includes("PGRST204") ||
      combined.includes("42703"))
  );
}

function enrichStudyPlanModuleWithMetadata(
  module: StudyPlanModule,
  student: StudyPlanStudent,
  metadataMap: Map<string, any>
): StudyPlanModule {
  const isBridging = module.planStage === "bridging";

  const programmeCode = String(
    isBridging
      ? module.programmeCode ?? ""
      : module.programmeCode || student.programmeCode
  ).trim();
  const programmeStream = normalizeStream(
    isBridging
      ? module.programmeStream
      : module.programmeStream || student.programmeStream
  );

  const metadata = resolveModuleMetadataFromMap(
    {
      moduleCode: module.moduleCode,
      programmeCode,
      programmeStream,
    },
    student,
    metadataMap
  );

  if (!metadata) {
    return {
      ...module,
      programmeCode,
      programmeStream,
      moduleName: module.moduleName || module.moduleCode,
    };
  }

  const moduleTerm = metadata.module_term ?? module.moduleTerm;

  return {
    ...module,
    programmeCode: programmeCode || metadata.programme_code,
    programmeStream,
    sourceModuleId: metadata.id ?? module.sourceModuleId,
    moduleName: metadata.module_name ?? module.moduleName ?? module.moduleCode,
    moduleYear:
      normalizeProgrammeYear(metadata.module_year) ?? module.moduleYear,
    moduleTerm,
    moduleTermPattern: moduleTerm,
    moduleSequence: module.moduleSequence,
  };
}

/**
 * Convert module_year to sortable number.
 *
 * Expected examples:
 * - 1
 * - "1"
 * - "Y1"
 * - "Year 1"
 */
function getModuleYearOrder(value: unknown): number {
  if (value === null || value === undefined) return 999;

  const text = String(value).trim();

  if (!text) return 999;

  const directNumber = Number(text);

  if (Number.isFinite(directNumber)) {
    return directNumber;
  }

  const matched = text.match(/\d+/);

  if (!matched) return 999;

  const year = Number(matched[0]);

  return Number.isFinite(year) ? year : 999;
}

/**
 * Convert module_term to sortable order.
 *
 * Curriculum display order:
 * Sep -> Feb -> Jun
 *
 * Supported values:
 * - Sep / September / C
 * - Feb / February / A
 * - Jun / June / Summer / B
 * - T2026C / T2027A / T2027B fallback
 */
function getModuleTermOrder(value: unknown): number {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!text) return 999;

  if (
    text === "sep" ||
    text === "sept" ||
    text === "september" ||
    text.includes("sep") ||
    text === "c" ||
    /^t\d{4}c$/i.test(text) ||
    text.endsWith("c")
  ) {
    return 1;
  }

  if (
    text === "feb" ||
    text === "february" ||
    text.includes("feb") ||
    text === "a" ||
    /^t\d{4}a$/i.test(text) ||
    text.endsWith("a")
  ) {
    return 2;
  }

  if (
    text === "jun" ||
    text === "june" ||
    text.includes("jun") ||
    text === "summer" ||
    text.includes("summer") ||
    text === "b" ||
    /^t\d{4}b$/i.test(text) ||
    text.endsWith("b")
  ) {
    return 3;
  }

  return 999;
}

/**
 * Sort modules in the intended display order:
 *
 * Y1 Sep -> Y1 Feb -> Y1 Jun -> Y2 Sep -> Y2 Feb -> Y2 Jun -> ...
 *
 * Note:
 * modules table currently does NOT have module_sequence.
 * Therefore this sorter only uses:
 * module_year -> module_term -> module_code
 */
function sortModuleRowsForDisplay<T extends {
  module_year?: unknown;
  module_term?: unknown;
  module_term_pattern?: unknown;
  module_code?: unknown;
}>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const yearDiff =
      getModuleYearOrder(a.module_year) - getModuleYearOrder(b.module_year);

    if (yearDiff !== 0) return yearDiff;

    const aTerm = a.module_term ?? a.module_term_pattern;
    const bTerm = b.module_term ?? b.module_term_pattern;

    const termDiff =
      getModuleTermOrder(aTerm) - getModuleTermOrder(bTerm);

    if (termDiff !== 0) return termDiff;

    return String(a.module_code ?? "").localeCompare(
      String(b.module_code ?? "")
    );
  });
}

function toStudentRow(student: StudyPlanStudent) {
  return {
    student_id: student.studentId,
    student_name: student.studentName,
    intake_year: student.intakeYear ?? null,
    intake_level: getDefaultIntakeLevel(
      student.programmeCode,
      student.intakeLevel,
      student.programmeType
    ),
    study_mode: student.studyMode,
    programme_code: student.programmeCode,

    /**
     * Store programmes.programme_stream exactly.
     *
     * This same value is used to query modules.stream_code.
     */
    programme_stream: cleanStream(student.programmeStream),

    student_status: student.studentStatus ?? "potential",
    intake_term: student.intakeTerm ?? null,
    graduate_term: student.graduateTerm ?? null,
    ok_to_articulate: isOkToArticulateForReport(student.okToArticulate),
    remark1: student.remark1 ?? null,
    remark2: student.remark2 ?? null,
    updated_at: new Date().toISOString(),
  };
}

/** Null/undefined counts as yes (legacy rows). */
export function isOkToArticulateForReport(
  value: boolean | null | undefined
): boolean {
  return value !== false;
}

function fromStudentRow(row: any): StudyPlanStudent {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    intakeYear: row.intake_year ?? undefined,
    intakeLevel: normalizeIntakeLevel(row.intake_level) ?? undefined,
    studyMode: row.study_mode,
    programmeCode: row.programme_code,
    programmeStream: row.programme_stream ?? "",
    programmeType: row.programme_type ?? undefined,
    studentStatus: row.student_status,
    intakeTerm: row.intake_term ?? undefined,
    graduateTerm: row.graduate_term ?? undefined,
    okToArticulate: isOkToArticulateForReport(row.ok_to_articulate),
    remark1: row.remark1 ?? undefined,
    remark2: row.remark2 ?? undefined,
  };
}

const programmeTypeByCodeCache = new Map<string, string | null>();

/**
 * Resolve programmes.programme_type by programme_code.
 */
export async function getProgrammeTypeByCode(
  programmeCode: string
): Promise<string | undefined> {
  const code = String(programmeCode ?? "").trim();

  if (!code) return undefined;

  if (programmeTypeByCodeCache.has(code)) {
    const cached = programmeTypeByCodeCache.get(code);
    return cached ?? undefined;
  }

  const { data, error } = await supabase
    .from("programmes")
    .select("programme_type")
    .eq("programme_code", code)
    .limit(1);

  if (error) {
    console.error(
      "[StudyPlanService] Failed to resolve programme type:",
      error
    );
    throw error;
  }

  const programmeType = data?.[0]?.programme_type ?? null;
  programmeTypeByCodeCache.set(code, programmeType);

  return programmeType ?? undefined;
}

export async function attachProgrammeTypeToStudent(
  student: StudyPlanStudent
): Promise<StudyPlanStudent> {
  if (student.programmeType) {
    return student;
  }

  const programmeType = await getProgrammeTypeByCode(student.programmeCode);

  if (!programmeType) {
    return student;
  }

  return {
    ...student,
    programmeType,
  };
}

function toModuleRow(
  module: StudyPlanModule,
  student: StudyPlanStudent,
  profileId: string
) {
  const isBridging = module.planStage === "bridging";

  const bridgingProgrammeCode = String(module.programmeCode ?? "").trim();
  const programmeCode = isBridging
    ? bridgingProgrammeCode || String(student.programmeCode ?? "").trim()
    : String(module.programmeCode || student.programmeCode).trim();

  const programmeStream = isBridging
    ? normalizeStream(module.programmeStream || student.programmeStream)
    : normalizeStream(module.programmeStream || student.programmeStream);

  if (!programmeCode) {
    throw new Error(`Module ${module.moduleCode} is missing programme code.`);
  }

  const moduleTerm = module.moduleTerm || module.moduleTermPattern || null;

  return {
    ...(module.id ? { id: module.id } : {}),
    student_id: student.studentId,
    student_profile_id: profileId,

    /**
     * Module identity fields.
     */
    programme_code: programmeCode,
    programme_stream: programmeStream,

    module_code: String(module.moduleCode ?? "").trim().toUpperCase(),
    module_name: module.moduleName,
    module_year: normalizeProgrammeYear(module.moduleYear) ?? null,

    /**
     * Store term explicitly.
     *
     * For backward compatibility, also keep module_term_pattern populated.
     * In this project, module_term_pattern is used by old UI display logic.
     */
    module_term: moduleTerm,
    module_term_pattern: moduleTerm,

    enrolled_module_instance_code:
      module.enrolledModuleInstanceCode ?? null,

    /**
     * This belongs to study_plan_modules only.
     * It is NOT read from modules table because modules.module_sequence
     * does not exist in the current database.
     */
    module_sequence: module.moduleSequence ?? null,

    plan_stage: module.planStage,
    status: module.status,
    study_term: module.studyTerm || null,

    is_exempted: module.status === "exempted",
    is_failed: module.status === "failed",

    is_locked: module.isLocked ?? false,

    remark: module.remark ?? null,
    updated_at: new Date().toISOString(),
  };
}

function fromModuleRow(row: any): StudyPlanModule {
  const moduleTerm = row.module_term ?? row.module_term_pattern ?? undefined;

  return {
    id: row.id,
    sourceModuleId: row.source_module_id ?? undefined,

    studentId: row.student_id,
    studentProfileId: row.student_profile_id,

    programmeCode: row.programme_code,
    programmeStream: row.programme_stream ?? "",

    moduleCode: row.module_code,
    moduleName: row.module_name,
    moduleYear: normalizeProgrammeYear(row.module_year) ?? undefined,

    moduleTerm,
    moduleTermPattern: moduleTerm,

    enrolledModuleInstanceCode:
      row.enrolled_module_instance_code ??
      row.delivery_mode ??
      undefined,
    moduleSequence: row.module_sequence ?? undefined,

    planStage: row.plan_stage,
    status: row.status,
    studyTerm: row.study_term ?? undefined,

    isExempted: row.is_exempted,
    isFailed: row.is_failed,
    isLocked: row.is_locked ?? false,

    remark: row.remark ?? undefined,
  };
}

/**
 * Convert intake term to intake year.
 *
 * Business rule:
 * - T2026C => 2026
 * - T2027A => 2026
 * - T2027B => 2026
 */
function deriveIntakeYearFromTerm(term?: string | null): string | undefined {
  const importedValue = intakeTermToIntakeYear(term);

  if (importedValue) return importedValue;

  const text = String(term ?? "").trim().toUpperCase();
  const matched = text.match(/^T(\d{4})([ABC])$/);

  if (!matched) return undefined;

  const year = Number(matched[1]);
  const letter = matched[2];

  if (!Number.isFinite(year)) return undefined;

  if (letter === "C") return String(year);
  if (letter === "A" || letter === "B") return String(year - 1);

  return String(year);
}

/**
 * Load module metadata from modules table for saved study plan modules.
 *
 * Important:
 * Metadata must be keyed by:
 * module_code + programme_code + programme_stream + term
 *
 * Not just module_code.
 *
 * Important:
 * modules table currently does NOT have module_sequence.
 */
export async function loadModuleMetadataForPlan(
  programmeCode: string,
  programmeStream: string | undefined,
  modules: Array<{
    moduleCode: string;
    programmeCode?: string;
    programmeStream?: string;
    moduleTerm?: string;
    moduleTermPattern?: string;
  }>
) {
  const defaultProgrammeCode = String(programmeCode ?? "").trim();
  const defaultStream = normalizeStream(programmeStream);

  const moduleItems = modules
    .map((item) => ({
      moduleCode: String(item.moduleCode ?? "").trim(),
      programmeCode: String(item.programmeCode || defaultProgrammeCode).trim(),
      programmeStream: normalizeStream(
        item.programmeStream ?? defaultStream
      ),
    }))
    .filter((item) => item.moduleCode && item.programmeCode);

  if (moduleItems.length === 0) {
    return new Map<string, any>();
  }

  const preferredStreamByKey = new Map<string, string>();

  for (const item of moduleItems) {
    preferredStreamByKey.set(buildModuleIdentityKey(item), item.programmeStream);
  }

  const uniqueProgrammeCodes = Array.from(
    new Set(moduleItems.map((item) => item.programmeCode))
  );

  const uniqueModuleCodes = Array.from(
    new Set(moduleItems.map((item) => item.moduleCode))
  );

  const streamValues = Array.from(
    new Set(
      moduleItems
        .flatMap((item) => [item.programmeStream, "nil"])
        .map((value) => cleanStream(value))
        .filter(Boolean)
    )
  );

  const { data, error } = await supabase
    .from("modules")
    .select(
      `
      id,
      module_code,
      module_name,
      module_year,
      module_term,
      programme_code,
      stream_code
      `
    )
    .in("programme_code", uniqueProgrammeCodes)
    .in("stream_code", streamValues)
    .in("module_code", uniqueModuleCodes);

  if (error) {
    console.error("[StudyPlanService] Failed to load module metadata:", error);
    throw error;
  }

  const map = new Map<string, any>();

  for (const row of data ?? []) {
    const moduleCode = String(row.module_code ?? "").trim();

    if (!moduleCode) continue;

    const rowKey = buildModuleRowIdentityKey(row);
    const existing = map.get(rowKey);
    const preferredStream = preferredStreamByKey.get(
      buildModuleIdentityKey({
        moduleCode: row.module_code,
        programmeCode: row.programme_code,
        programmeStream: row.stream_code,
      })
    );

    if (!existing) {
      map.set(rowKey, row);
      continue;
    }

    const existingStream = cleanStream(existing.stream_code);
    const rowStream = cleanStream(row.stream_code);

    /**
     * Prefer exact stream-specific metadata over common 'nil' metadata.
     */
    if (
      preferredStream &&
      existingStream === "nil" &&
      rowStream === preferredStream
    ) {
      map.set(rowKey, row);
    }
  }

  return map;
}

function buildBridgingCatalogByModuleCode(options: StudyPlanModule[]) {
  const map = new Map<string, StudyPlanModule>();

  for (const option of options) {
    const moduleCode = String(option.moduleCode ?? "")
      .trim()
      .toUpperCase();

    if (!moduleCode) continue;

    const existing = map.get(moduleCode);

    if (!existing) {
      map.set(moduleCode, option);
      continue;
    }

    const existingStream = normalizeStream(existing.programmeStream);
    const optionStream = normalizeStream(option.programmeStream);

    if (existingStream === "nil" && optionStream !== "nil") {
      map.set(moduleCode, option);
    }
  }

  return map;
}

type ModuleCatalogRow = {
  id: string;
  module_code: string | null;
  module_name: string | null;
  module_year: string | null;
  module_term: string | null;
  programme_code: string | null;
  stream_code: string | null;
};

/** Cleared at the start of each bulk study-plan upload. */
const bridgingModuleOptionsCache = new Map<string, StudyPlanModule[]>();
const moduleCatalogRowsByCodeCache = new Map<string, ModuleCatalogRow[]>();
let cachedStudyPlanSettings: StudyPlanSettings | null = null;

export interface StudyPlanSaveBatchOptions {
  settings?: StudyPlanSettings;
  moduleMetadataMap?: Map<string, unknown>;
  isDegreeProgramme?: boolean;
}

export function clearStudyPlanServiceCaches() {
  bridgingModuleOptionsCache.clear();
  moduleCatalogRowsByCodeCache.clear();
  programmeTypeByCodeCache.clear();
  cachedStudyPlanSettings = null;
}

function pickBestModuleCatalogRow(
  rows: ModuleCatalogRow[],
  params: {
    programmeCode?: string;
    programmeStream?: string;
    preferHdProgramme?: boolean;
    hdProgrammeCodes?: Set<string>;
  }
): ModuleCatalogRow {
  const targetProgramme = String(params.programmeCode ?? "").trim();
  const targetStream = normalizeStream(params.programmeStream);

  let best = rows[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    let score = 0;
    const rowProgramme = String(row.programme_code ?? "").trim();
    const rowStream = normalizeStream(row.stream_code);

    if (targetProgramme && rowProgramme === targetProgramme) {
      score += 100;
    }

    if (targetStream && rowStream === targetStream) {
      score += 50;
    } else if (targetStream && rowStream === "nil") {
      score += 20;
    }

    if (
      params.preferHdProgramme &&
      params.hdProgrammeCodes?.has(rowProgramme)
    ) {
      score += 30;
    }

    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  return best;
}

export interface StudyPlanModuleMetadataLookup {
  moduleCode: string;
  moduleName: string;
  moduleYear?: string;
  moduleTerm?: string;
  moduleTermPattern?: string;
  programmeCode?: string;
  programmeStream?: string;
  sourceModuleId?: string;
  enrolledModuleInstanceCode?: string;
}

async function loadModuleCatalogRowsByCode(
  moduleCode: string
): Promise<ModuleCatalogRow[]> {
  const lookupKey = String(moduleCode ?? "").trim().toUpperCase();

  if (!lookupKey) {
    return [];
  }

  const cached = moduleCatalogRowsByCodeCache.get(lookupKey);

  if (cached) {
    return cached;
  }

  const { data: moduleRows, error: moduleError } = await supabase
    .from("modules")
    .select(
      "id, module_code, module_name, module_year, module_term, programme_code, stream_code"
    )
    .eq("module_code", lookupKey)
    .limit(50);

  if (moduleError) {
    console.error(
      "[StudyPlanService] Failed to lookup module metadata:",
      moduleError
    );
    return [];
  }

  const rows = (moduleRows ?? []) as ModuleCatalogRow[];
  moduleCatalogRowsByCodeCache.set(lookupKey, rows);

  return rows;
}

export async function lookupStudyPlanModuleMetadataByCode(params: {
  moduleCode: string;
  programmeCode?: string;
  programmeStream?: string;
}): Promise<StudyPlanModuleMetadataLookup | null> {
  const rawCode = String(params.moduleCode ?? "")
    .trim()
    .toUpperCase();

  if (!rawCode) {
    return null;
  }

  const lookupCodes = Array.from(
    new Set([rawCode, getBaseModuleCode(rawCode)].filter(Boolean))
  );

  let rows: ModuleCatalogRow[] = [];

  for (const lookupCode of lookupCodes) {
    const matches = await loadModuleCatalogRowsByCode(lookupCode);
    if (matches.length > 0) {
      rows = matches;
      break;
    }
  }

  if (!rows.length) {
    return null;
  }

  const catalogCode = rows[0]?.module_code ?? rawCode;
  const programmeCodes = Array.from(
    new Set(
      rows.map((row) => String(row.programme_code ?? "").trim()).filter(Boolean)
    )
  );

  let hdProgrammeCodes: Set<string> | undefined;

  if (programmeCodes.length > 0) {
    const { data: programmeRows, error: programmeError } = await supabase
      .from("programmes")
      .select("programme_code, programme_type")
      .in("programme_code", programmeCodes);

    if (programmeError) {
      console.error(
        "[StudyPlanService] Failed to lookup programme type for module:",
        programmeError
      );
    } else {
      hdProgrammeCodes = new Set(
        (programmeRows ?? [])
          .filter((row) => isHDProgrammeType(String(row.programme_type ?? "")))
          .map((row) => String(row.programme_code ?? "").trim())
          .filter(Boolean)
      );
    }
  }

  const matchedRow = pickBestModuleCatalogRow(rows, {
    programmeCode: params.programmeCode,
    programmeStream: params.programmeStream,
    preferHdProgramme: true,
    hdProgrammeCodes,
  });

  const moduleTerm = matchedRow.module_term ?? undefined;

  return {
    moduleCode: String(matchedRow.module_code ?? catalogCode).trim(),
    moduleName: String(matchedRow.module_name ?? "").trim(),
    moduleYear: normalizeProgrammeYear(matchedRow.module_year) ?? undefined,
    moduleTerm,
    moduleTermPattern: moduleTerm,
    programmeCode: String(matchedRow.programme_code ?? "").trim() || undefined,
    programmeStream: normalizeStream(matchedRow.stream_code),
    sourceModuleId: matchedRow.id ?? undefined,
  };
}

async function lookupHdModuleMetadataByCode(
  moduleCode: string
): Promise<StudyPlanModule | null> {
  const metadata = await lookupStudyPlanModuleMetadataByCode({
    moduleCode,
  });

  if (!metadata) {
    return null;
  }

  return {
    moduleCode: metadata.moduleCode,
    moduleName: metadata.moduleName || metadata.moduleCode,
    moduleYear: metadata.moduleYear,
    moduleTerm: metadata.moduleTerm,
    moduleTermPattern: metadata.moduleTermPattern ?? metadata.moduleTerm,
    programmeCode: metadata.programmeCode ?? "",
    programmeStream: metadata.programmeStream,
    sourceModuleId: metadata.sourceModuleId,
    planStage: "bridging",
    status: "planned",
    isExempted: false,
    isFailed: false,
    isLocked: false,
  };
}

/**
 * Reconcile Degree study-plan module stages from the degree programme catalogue.
 *
 * - Module in degree catalogue -> programme
 * - Otherwise -> bridging (even when not listed in HD bridging options)
 * - Enrich bridging rows from articulation / modules metadata when available
 * - Auto-generate missing degree programme modules when only bridging exists
 */
export async function reconcileDegreeStudyPlanModules(
  student: StudyPlanStudent,
  modules: StudyPlanModule[]
): Promise<StudyPlanModule[]> {
  const studentWithType = await attachProgrammeTypeToStudent(student);

  if (!isDegreeProgramme(studentWithType.programmeCode, studentWithType.programmeType)) {
    return modules;
  }

  const [degreeCatalog, bridgingCatalog] = await Promise.all([
    loadProgrammeModules(
      studentWithType.programmeCode,
      studentWithType.programmeStream
    ),
    loadBridgingModuleOptionsForDegree({
      degreeProgrammeCode: studentWithType.programmeCode,
      degreeProgrammeStream: studentWithType.programmeStream,
    }),
  ]);

  const bridgingByCode = buildBridgingCatalogByModuleCode(bridgingCatalog);
  const hdMetadataCache = new Map<string, StudyPlanModule | null>();

  let reconciled: StudyPlanModule[] = await Promise.all(
    modules.map(async (module) => {
      const moduleCode = getBaseModuleCode(module.moduleCode);
      const inDegreeCatalog = isModuleCodeInDegreeCatalog(
        module.moduleCode,
        degreeCatalog
      );

      if (inDegreeCatalog) {
        const catalogMatch = degreeCatalog.find((entry) =>
          isModuleCodeInDegreeCatalog(module.moduleCode, [entry])
        );

        return {
          ...module,
          planStage: "programme" as const,
          programmeCode:
            catalogMatch?.programmeCode ?? studentWithType.programmeCode,
          programmeStream: normalizeStream(
            catalogMatch?.programmeStream ?? studentWithType.programmeStream
          ),
          sourceModuleId: catalogMatch?.sourceModuleId ?? module.sourceModuleId,
          moduleName:
            catalogMatch?.moduleName ?? module.moduleName ?? module.moduleCode,
          moduleYear: catalogMatch?.moduleYear ?? module.moduleYear,
          moduleTerm:
            catalogMatch?.moduleTerm ??
            catalogMatch?.moduleTermPattern ??
            module.moduleTerm,
          moduleTermPattern:
            catalogMatch?.moduleTermPattern ??
            catalogMatch?.moduleTerm ??
            module.moduleTermPattern ??
            module.moduleTerm,
        };
      }

      const bridgingMatch = bridgingByCode.get(moduleCode);

      if (bridgingMatch) {
        return {
          ...module,
          planStage: "bridging" as const,
          programmeCode: bridgingMatch.programmeCode,
          programmeStream: normalizeStream(bridgingMatch.programmeStream),
          sourceModuleId: bridgingMatch.sourceModuleId ?? module.sourceModuleId,
          moduleName:
            bridgingMatch.moduleName ?? module.moduleName ?? module.moduleCode,
          moduleYear: bridgingMatch.moduleYear ?? module.moduleYear,
          moduleTerm: bridgingMatch.moduleTerm ?? module.moduleTerm,
          moduleTermPattern:
            bridgingMatch.moduleTermPattern ??
            bridgingMatch.moduleTerm ??
            module.moduleTermPattern ??
            module.moduleTerm,
        };
      }

      if (!hdMetadataCache.has(moduleCode)) {
        hdMetadataCache.set(
          moduleCode,
          await lookupHdModuleMetadataByCode(moduleCode)
        );
      }

      const hdMetadata = hdMetadataCache.get(moduleCode);

      if (hdMetadata) {
        return {
          ...module,
          planStage: "bridging" as const,
          programmeCode: hdMetadata.programmeCode,
          programmeStream: normalizeStream(hdMetadata.programmeStream),
          sourceModuleId: hdMetadata.sourceModuleId ?? module.sourceModuleId,
          moduleName:
            hdMetadata.moduleName ?? module.moduleName ?? module.moduleCode,
          moduleYear: hdMetadata.moduleYear ?? module.moduleYear,
          moduleTerm: hdMetadata.moduleTerm ?? module.moduleTerm,
          moduleTermPattern:
            hdMetadata.moduleTermPattern ??
            hdMetadata.moduleTerm ??
            module.moduleTermPattern ??
            module.moduleTerm,
        };
      }

      return {
        ...module,
        planStage: "bridging" as const,
        programmeCode: studentWithType.programmeCode,
        programmeStream: normalizeStream(studentWithType.programmeStream),
        moduleName: module.moduleName || module.moduleCode,
      };
    })
  );

  const hasProgrammeModules = reconciled.some(
    (module) => module.planStage === "programme"
  );

  if (!hasProgrammeModules && studentWithType.intakeTerm) {
    const bridgingModules = reconciled.filter(
      (module) => module.planStage === "bridging"
    );

    if (degreeCatalog.length > 0) {
      const startTerm = getDegreeStartTermAfterBridging(
        bridgingModules,
        studentWithType.intakeTerm
      );

      const generatedProgrammeModules = generateStudyPlanForStudent({
        student: studentWithType,
        modules: degreeCatalog.map((module) => ({
          ...module,
          studentId: studentWithType.studentId,
          studentProfileId: studentWithType.id,
        })),
        startTerm,
      });

      reconciled = [...reconciled, ...generatedProgrammeModules];
    }
  }

  return reconciled;
}

export async function listStudyPlanStudents(filters?: {
  programmeCode?: string;
  programmeStream?: string;
  studentId?: string;
  studentName?: string;
}) {
  let query = supabase
    .from("study_plan_students")
    .select("*")
    .order("programme_code", { ascending: true })
    .order("student_id", { ascending: true });

  if (filters?.programmeCode) {
    query = query.eq("programme_code", filters.programmeCode);
  }

  if (
    filters?.programmeStream !== undefined &&
    filters.programmeStream !== ""
  ) {
    query = query.eq("programme_stream", cleanStream(filters.programmeStream));
  }

  if (filters?.studentId) {
    query = query.ilike("student_id", `%${filters.studentId}%`);
  }

  if (filters?.studentName) {
    query = query.ilike("student_name", `%${filters.studentName}%`);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []).map(fromStudentRow);
}

export async function getStudyPlanStudent(profileId: string) {
  const { data: studentRow, error: studentError } = await supabase
    .from("study_plan_students")
    .select("*")
    .eq("id", profileId)
    .single();

  if (studentError) throw studentError;

  const { data: moduleRows, error: moduleError } = await supabase
    .from("study_plan_modules")
    .select("*")
    .eq("student_profile_id", profileId)
    .order("plan_stage", { ascending: false })
    .order("module_year", { ascending: true })
    .order("module_term", { ascending: true })
    .order("module_sequence", { ascending: true })
    .order("module_code", { ascending: true });

  if (moduleError) throw moduleError;

  const student = await attachProgrammeTypeToStudent(fromStudentRow(studentRow));
  const savedModules = (moduleRows ?? []).map(fromModuleRow);

  const reconciledModules = await reconcileDegreeStudyPlanModules(
    student,
    savedModules
  );

  const moduleMetadataMap = await loadModuleMetadataForPlan(
    student.programmeCode,
    student.programmeStream,
    reconciledModules.map((module) => ({
      moduleCode: module.moduleCode,
      programmeCode: module.programmeCode || student.programmeCode,
      programmeStream: module.programmeStream || student.programmeStream,
      moduleTerm: module.moduleTerm,
      moduleTermPattern: module.moduleTermPattern,
    }))
  );

  const enrichedModules = reconciledModules.map((module) =>
    enrichStudyPlanModuleWithMetadata(
      {
        ...module,
        programmeCode: module.programmeCode || student.programmeCode,
        programmeStream: module.programmeStream || student.programmeStream,
      },
      student,
      moduleMetadataMap
    )
  );

  return {
    student,
    modules: sortModulesForStudyPlan(enrichedModules),
  };
}

export async function getStudyPlanStudentByStudentId(studentId: string) {
  const trimmedId = String(studentId ?? "").trim();

  if (!trimmedId) {
    return null;
  }

  const { data, error } = await supabase
    .from("study_plan_students")
    .select("id")
    .eq("student_id", trimmedId)
    .maybeSingle();

  if (error) throw error;

  if (!data?.id) {
    return null;
  }

  return getStudyPlanStudent(String(data.id));
}

export interface GraduatingStudentSearchParams {
  studyTerm: string;
  programmeCode: string;
}

export interface GraduatingStudentSearchRow {
  profileId: string;
  studentId: string;
  studentName: string;
  programmeCode: string;
  programmeStream: string;
  studyMode: string;
  studentStatus?: string;
  intakeTerm?: string;
  calculatedGraduateTerm: string;
}

function normalizeStudyTermKey(term: string): string {
  return String(term ?? "").trim().toUpperCase();
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function escapeStudyPlanSearchCsvCell(value: unknown): string {
  const text = String(value ?? "");

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function graduatingStudentsToCsv(
  headers: string[],
  rows: string[][]
): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeStudyPlanSearchCsvCell).join(","))
    .join("\n");
}

export async function searchGraduatingStudents(
  params: GraduatingStudentSearchParams
): Promise<GraduatingStudentSearchRow[]> {
  const studyTerm = normalizeStudyTermKey(params.studyTerm);
  const programmeCode = String(params.programmeCode ?? "").trim();

  if (!studyTerm || !programmeCode) {
    return [];
  }

  const students = await listStudyPlanStudents({ programmeCode });
  const profileIds = students
    .map((student) => student.id)
    .filter((value): value is string => Boolean(value));

  if (profileIds.length === 0) {
    return [];
  }

  const modulesByProfile = await loadStudyPlanModulesByProfileIds(profileIds);
  const results: GraduatingStudentSearchRow[] = [];

  for (const student of students) {
    if (!student.id) {
      continue;
    }

    const modules = modulesByProfile.get(student.id) ?? [];
    const latestTerm = getLatestStudyTerm(modules);

    if (!latestTerm || normalizeStudyTermKey(latestTerm) !== studyTerm) {
      continue;
    }

    results.push({
      profileId: student.id,
      studentId: student.studentId,
      studentName: student.studentName,
      programmeCode: student.programmeCode,
      programmeStream: cleanStream(student.programmeStream),
      studyMode: student.studyMode,
      studentStatus: student.studentStatus,
      intakeTerm: student.intakeTerm,
      calculatedGraduateTerm: normalizeStudyTermKey(latestTerm),
    });
  }

  return sortStudyPlanSearchRows(results);
}

export async function downloadGraduatingStudentsCsv(
  params: GraduatingStudentSearchParams
): Promise<{ fileName: string; rowCount: number }> {
  const rows = await searchGraduatingStudents(params);

  if (rows.length === 0) {
    throw new Error("沒有符合條件的畢業生，無法匯出。");
  }

  const headers = [
    "Programme Code",
    "Programme Stream",
    "Student ID",
    "Student Name",
    "Study Mode",
    "Student Status",
    "Intake Term",
    "Calculated Graduate Term",
    "Selected Study Term",
  ];

  const csvRows = rows.map((row) => [
    row.programmeCode,
    row.programmeStream,
    row.studentId,
    row.studentName,
    row.studyMode,
    row.studentStatus ?? "",
    row.intakeTerm ?? "",
    row.calculatedGraduateTerm,
    normalizeStudyTermKey(params.studyTerm),
  ]);

  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const fileName = `study_plan_graduates_${programmeCodeKey(
    params.programmeCode
  )}_${normalizeStudyTermKey(params.studyTerm)}_${dateStamp}.csv`;

  saveAs(
    new Blob([graduatingStudentsToCsv(headers, csvRows)], {
      type: "text/csv;charset=utf-8;",
    }),
    fileName
  );

  return {
    fileName,
    rowCount: rows.length,
  };
}

export interface BridgingCompleteStudentSearchParams {
  studyTerm: string;
  programmeCode: string;
}

export interface BridgingCompleteStudentSearchRow {
  profileId: string;
  studentId: string;
  studentName: string;
  programmeCode: string;
  programmeStream: string;
  studyMode: string;
  studentStatus?: string;
  intakeTerm?: string;
  calculatedBridgingCompleteTerm: string;
}

async function loadStudyPlanModulesByProfileIds(
  profileIds: string[]
): Promise<Map<string, StudyPlanModule[]>> {
  const modulesByProfile = new Map<string, StudyPlanModule[]>();

  for (const profileChunk of chunkValues(profileIds, 100)) {
    const { data, error } = await supabase
      .from("study_plan_modules")
      .select("*")
      .in("student_profile_id", profileChunk);

    if (error) throw error;

    for (const row of data ?? []) {
      const profileId = String(row.student_profile_id ?? "").trim();

      if (!profileId) {
        continue;
      }

      const existing = modulesByProfile.get(profileId) ?? [];
      existing.push(fromModuleRow(row));
      modulesByProfile.set(profileId, existing);
    }
  }

  return modulesByProfile;
}

function sortStudyPlanSearchRows<
  T extends { programmeStream: string; studentId: string },
>(rows: T[]): T[] {
  return rows.sort((a, b) => {
    const streamDiff = a.programmeStream.localeCompare(b.programmeStream);

    if (streamDiff !== 0) {
      return streamDiff;
    }

    return a.studentId.localeCompare(b.studentId);
  });
}

export async function searchBridgingCompleteStudents(
  params: BridgingCompleteStudentSearchParams
): Promise<BridgingCompleteStudentSearchRow[]> {
  const studyTerm = normalizeStudyTermKey(params.studyTerm);
  const programmeCode = String(params.programmeCode ?? "").trim();

  if (!studyTerm || !programmeCode) {
    return [];
  }

  const students = await listStudyPlanStudents({ programmeCode });
  const profileIds = students
    .map((student) => student.id)
    .filter((value): value is string => Boolean(value));

  if (profileIds.length === 0) {
    return [];
  }

  const modulesByProfile = await loadStudyPlanModulesByProfileIds(profileIds);
  const results: BridgingCompleteStudentSearchRow[] = [];

  for (const student of students) {
    if (!student.id) {
      continue;
    }

    const modules = modulesByProfile.get(student.id) ?? [];
    const latestBridgingTerm = getLatestBridgingStudyTerm(modules);

    if (
      !latestBridgingTerm ||
      normalizeStudyTermKey(latestBridgingTerm) !== studyTerm
    ) {
      continue;
    }

    results.push({
      profileId: student.id,
      studentId: student.studentId,
      studentName: student.studentName,
      programmeCode: student.programmeCode,
      programmeStream: cleanStream(student.programmeStream),
      studyMode: student.studyMode,
      studentStatus: student.studentStatus,
      intakeTerm: student.intakeTerm,
      calculatedBridgingCompleteTerm: normalizeStudyTermKey(latestBridgingTerm),
    });
  }

  return sortStudyPlanSearchRows(results);
}

export async function downloadBridgingCompleteStudentsCsv(
  params: BridgingCompleteStudentSearchParams
): Promise<{ fileName: string; rowCount: number }> {
  const rows = await searchBridgingCompleteStudents(params);

  if (rows.length === 0) {
    throw new Error("沒有符合條件的學生，無法匯出。");
  }

  const headers = [
    "Programme Code",
    "Programme Stream",
    "Student ID",
    "Student Name",
    "Study Mode",
    "Student Status",
    "Intake Term",
    "Calculated Bridging Complete Term",
    "Selected Study Term",
  ];

  const csvRows = rows.map((row) => [
    row.programmeCode,
    row.programmeStream,
    row.studentId,
    row.studentName,
    row.studyMode,
    row.studentStatus ?? "",
    row.intakeTerm ?? "",
    row.calculatedBridgingCompleteTerm,
    normalizeStudyTermKey(params.studyTerm),
  ]);

  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const fileName = `study_plan_bridging_complete_${programmeCodeKey(
    params.programmeCode
  )}_${normalizeStudyTermKey(params.studyTerm)}_${dateStamp}.csv`;

  saveAs(
    new Blob([graduatingStudentsToCsv(headers, csvRows)], {
      type: "text/csv;charset=utf-8;",
    }),
    fileName
  );

  return {
    fileName,
    rowCount: rows.length,
  };
}

function programmeCodeKey(programmeCode: string): string {
  return String(programmeCode ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export interface StudyPlanExportFilters {
  studentProfileId?: string;
  programmeCode?: string;
  programmeStream?: string;
  programmeType?: string;
}

export interface StudyPlanExportBundle {
  student: StudyPlanStudent;
  modules: StudyPlanModule[];
}

export async function listProgrammeCodesByProgrammeType(
  programmeType: string
): Promise<string[]> {
  const normalizedType = String(programmeType ?? "").trim();

  if (!normalizedType) {
    return [];
  }

  const { data, error } = await supabase
    .from("programmes")
    .select("programme_code, programme_type")
    .not("programme_code", "is", null);

  if (error) {
    console.error(
      "[StudyPlanService] Failed to load programme codes by type:",
      error
    );
    throw error;
  }

  const target = normalizedType.toLowerCase();

  return Array.from(
    new Set(
      (data ?? [])
        .filter((row) => {
          const rowType = String(row.programme_type ?? "")
            .trim()
            .toLowerCase();

          if (target === "degree") {
            return isDegreeProgrammeType(rowType);
          }

          if (target === "hd") {
            return isHDProgrammeType(rowType);
          }

          return rowType === target;
        })
        .map((row) => String(row.programme_code ?? "").trim())
        .filter(Boolean)
    )
  );
}

export function shouldIncludeModuleInStudyPlanExport(
  module: StudyPlanModule
): boolean {
  if (module.status === "exempted") {
    return true;
  }

  if (module.status === "planned" || module.status === "failed") {
    return Boolean(String(module.studyTerm ?? "").trim());
  }

  return false;
}

function compareModulesForStudyPlanExport(
  a: StudyPlanModule,
  b: StudyPlanModule
): number {
  const getStudyTermSortKey = (module: StudyPlanModule): number => {
    if (module.status === "exempted") {
      return Number.MAX_SAFE_INTEGER - 1;
    }

    const studyTerm = String(module.studyTerm ?? "").trim();

    if (!studyTerm) {
      return Number.MAX_SAFE_INTEGER;
    }

    const termIndex = getTermIndex(studyTerm);

    return Number.isFinite(termIndex) ? termIndex : Number.MAX_SAFE_INTEGER - 2;
  };

  const termDiff = getStudyTermSortKey(a) - getStudyTermSortKey(b);

  if (termDiff !== 0) return termDiff;

  const yearDiff =
    getModuleYearOrder(a.moduleYear) - getModuleYearOrder(b.moduleYear);

  if (yearDiff !== 0) return yearDiff;

  const termOrderDiff =
    getModuleTermOrder(a.moduleTerm ?? a.moduleTermPattern) -
    getModuleTermOrder(b.moduleTerm ?? b.moduleTermPattern);

  if (termOrderDiff !== 0) return termOrderDiff;

  return String(a.moduleCode ?? "").localeCompare(String(b.moduleCode ?? ""));
}

export function sortModulesForStudyPlanExport(
  modules: StudyPlanModule[]
): StudyPlanModule[] {
  return sortModulesForStudyPlan(modules);
}

export function sortModulesForStudyPlan(
  modules: StudyPlanModule[]
): StudyPlanModule[] {
  const bridgingModules = modules
    .filter((module) => module.planStage === "bridging")
    .sort(compareModulesForStudyPlanExport);

  const programmeModules = modules
    .filter((module) => module.planStage !== "bridging")
    .sort(compareModulesForStudyPlanExport);

  return [...bridgingModules, ...programmeModules];
}

/** Study-plan catalogue order: module_year → module_term → module_code. */
export function sortStudyPlanCatalogModules(
  modules: StudyPlanModule[]
): StudyPlanModule[] {
  return [...modules].sort((a, b) => {
    const yearDiff =
      getModuleYearOrder(a.moduleYear) - getModuleYearOrder(b.moduleYear);

    if (yearDiff !== 0) return yearDiff;

    const termDiff =
      getModuleTermOrder(a.moduleTerm ?? a.moduleTermPattern) -
      getModuleTermOrder(b.moduleTerm ?? b.moduleTermPattern);

    if (termDiff !== 0) return termDiff;

    return String(a.moduleCode ?? "").localeCompare(String(b.moduleCode ?? ""));
  });
}

/** Merge programme module catalogues (e.g. multiple streams) into one column order. */
export function mergeStudyPlanCatalogModules(
  moduleLists: StudyPlanModule[][]
): StudyPlanModule[] {
  const seen = new Set<string>();
  const merged: StudyPlanModule[] = [];

  for (const module of sortStudyPlanCatalogModules(moduleLists.flat())) {
    const key = getBaseModuleCode(module.moduleCode);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(module);
  }

  return merged;
}

export async function loadStudyPlanExportBundles(
  filters: StudyPlanExportFilters = {}
): Promise<StudyPlanExportBundle[]> {
  let students = await listStudyPlanStudents({
    programmeCode: filters.programmeCode,
    programmeStream: filters.programmeStream,
  });

  if (filters.programmeType) {
    const programmeCodes = await listProgrammeCodesByProgrammeType(
      filters.programmeType
    );
    const codeSet = new Set(
      programmeCodes.map((code) => code.trim().toUpperCase())
    );

    students = students.filter((student) =>
      codeSet.has(String(student.programmeCode ?? "").trim().toUpperCase())
    );
  }

  if (filters.studentProfileId) {
    students = students.filter(
      (student) => student.id === filters.studentProfileId
    );
  }

  if (students.length === 0) {
    return [];
  }

  const studentsWithType = await Promise.all(
    students.map((student) => attachProgrammeTypeToStudent(student))
  );

  const profileIds = studentsWithType
    .map((student) => student.id)
    .filter((id): id is string => Boolean(id));

  if (profileIds.length === 0) {
    return [];
  }

  // Batch by profile id — a single .in(...) with hundreds of UUIDs exceeds URL limits (400).
  const modulesByProfileId = await loadStudyPlanModulesByProfileIds(profileIds);

  const reconciledByStudent = await Promise.all(
    studentsWithType.map(async (student) => {
      const savedModules = student.id
        ? modulesByProfileId.get(student.id) ?? []
        : [];

      return {
        student,
        modules: await reconcileDegreeStudyPlanModules(student, savedModules),
      };
    })
  );

  const metadataInputs = reconciledByStudent.flatMap(({ student, modules }) =>
    modules.map((module) => ({
      moduleCode: module.moduleCode,
      programmeCode: module.programmeCode || student.programmeCode,
      programmeStream: module.programmeStream || student.programmeStream,
      moduleTerm: module.moduleTerm,
      moduleTermPattern: module.moduleTermPattern,
    }))
  );

  const moduleMetadataMap = await loadModuleMetadataForPlan(
    studentsWithType[0]?.programmeCode ?? "",
    studentsWithType[0]?.programmeStream,
    metadataInputs
  );

  return reconciledByStudent.map(({ student, modules }) => {
    const enrichedModules = modules.map((module) =>
      enrichStudyPlanModuleWithMetadata(
        {
          ...module,
          programmeCode: module.programmeCode || student.programmeCode,
          programmeStream: normalizeStream(
            module.programmeStream || student.programmeStream
          ),
        },
        student,
        moduleMetadataMap
      )
    );

    return {
      student,
      modules: sortModulesForStudyPlanExport(enrichedModules),
    };
  });
}

export async function upsertStudyPlanStudent(student: StudyPlanStudent) {
  const row = toStudentRow(student);

  const { data, error } = await supabase
    .from("study_plan_students")
    .upsert(row, {
      onConflict: "student_id",
    })
    .select("*")
    .single();

  if (error) {
    if (isMissingOkToArticulateColumn(error)) {
      throw new Error(
        [
          "数据库尚未添加 ok_to_articulate 字段，无法保存「原校升學 / Articulation」。",
          "请在 Supabase SQL Editor 执行：",
          "supabase/migrations/012_study_plan_ok_to_articulate.sql",
          "执行后刷新页面再保存。",
        ].join("\n")
      );
    }

    throw error;
  }

  return fromStudentRow(data);
}

export async function deleteStudyPlanStudent(profileId: string) {
  const { error } = await supabase
    .from("study_plan_students")
    .delete()
    .eq("id", profileId);

  if (error) throw error;

  await recalculateActualStudentNumbers();
  await syncActualStudentNumbersToTimetable();
}

/**
 * Save student profile fields only (no module writes).
 * Recomputes student_status / graduate_term from modules already in DB when present.
 */
export async function saveStudyPlanStudentProfile(
  student: StudyPlanStudent
): Promise<StudyPlanStudent> {
  const studentInput = await attachProgrammeTypeToStudent(student);
  const intakeTerm = String(studentInput.intakeTerm ?? "").trim();

  if (!intakeTerm) {
    throw new Error("Intake Term is required.");
  }

  const settings = await getStudyPlanSettings();
  let dbModules: StudyPlanModule[] = [];

  if (studentInput.id) {
    const { data, error } = await supabase
      .from("study_plan_modules")
      .select("*")
      .eq("student_profile_id", studentInput.id);

    if (error) {
      throw error;
    }

    dbModules = (data ?? []).map(fromModuleRow);
  }

  let graduateTerm = studentInput.graduateTerm;
  let studentStatus = studentInput.studentStatus ?? "potential";

  if (dbModules.length > 0) {
    graduateTerm = getLatestStudyTerm(dbModules) ?? graduateTerm;
    studentStatus = calculateStudentStatus(
      dbModules,
      settings.currentStudyTerm,
      studentInput.programmeType
    );
  }

  return upsertStudyPlanStudent({
    ...studentInput,
    intakeYear: deriveIntakeYearFromTerm(intakeTerm),
    intakeLevel: getDefaultIntakeLevel(
      studentInput.programmeCode,
      studentInput.intakeLevel,
      studentInput.programmeType
    ),
    intakeTerm,
    graduateTerm,
    studentStatus,
  });
}

async function persistStudyPlanModulesForStudent(
  studentWithType: StudyPlanStudent,
  savedStudentId: string,
  modulesReadyToSave: StudyPlanModule[],
  options?: { isDegreeProgramme?: boolean }
) {
  const modulesWithId = modulesReadyToSave.filter((module) => module.id);
  const modulesWithoutId = modulesReadyToSave.filter((module) => !module.id);

  if (modulesWithId.length > 0) {
    const { error: updateError } = await supabase
      .from("study_plan_modules")
      .upsert(
        modulesWithId.map((module) =>
          toModuleRow(module, studentWithType, savedStudentId)
        ),
        { onConflict: "id" }
      );

    if (updateError) throw updateError;
  }

  const insertedModuleIds: string[] = [];

  if (modulesWithoutId.length > 0) {
    const { data: insertedRows, error: insertError } = await supabase
      .from("study_plan_modules")
      .upsert(
        modulesWithoutId.map((module) =>
          toModuleRow(module, studentWithType, savedStudentId)
        ),
        { onConflict: STUDY_PLAN_MODULE_ROW_UNIQUE_CONFLICT }
      )
      .select("id");

    if (insertError) throw insertError;

    for (const row of insertedRows ?? []) {
      const id = String(row.id ?? "").trim();

      if (id) {
        insertedModuleIds.push(id);
      }
    }
  }

  const keptModuleIds = [
    ...modulesWithId
      .map((module) => module.id)
      .filter((id): id is string => Boolean(id)),
    ...insertedModuleIds,
  ];

  let deleteOrphansQuery = supabase
    .from("study_plan_modules")
    .delete()
    .eq("student_profile_id", savedStudentId);

  if (keptModuleIds.length > 0) {
    deleteOrphansQuery = deleteOrphansQuery.not(
      "id",
      "in",
      `(${keptModuleIds.join(",")})`
    );
  }

  const { error: deleteOrphansError } = await deleteOrphansQuery;

  if (deleteOrphansError) throw deleteOrphansError;

  const isDegree =
    options?.isDegreeProgramme ??
    (await isDegreeProgrammeByCode(studentWithType.programmeCode));

  if (isDegree) {
    const bridgingModuleCodes = Array.from(
      new Set(
        modulesReadyToSave
          .filter((module) => module.planStage === "bridging")
          .flatMap((module) => {
            const raw = String(module.moduleCode ?? "").trim();

            if (!raw) {
              return [];
            }

            const base = getBaseModuleCode(raw);

            return base && base !== raw ? [raw, base] : [raw];
          })
      )
    );

    if (bridgingModuleCodes.length > 0) {
      const { error: cleanupError } = await supabase
        .from("study_plan_modules")
        .delete()
        .eq("student_profile_id", savedStudentId)
        .eq("plan_stage", "programme")
        .eq("programme_code", studentWithType.programmeCode)
        .in("module_code", bridgingModuleCodes);

      if (cleanupError) throw cleanupError;
    }
  }
}

/**
 * Save module rows and sync derived student fields from the editor module list.
 */
export async function saveStudyPlanModules(
  student: StudyPlanStudent,
  modules: StudyPlanModule[],
  options?: {
    skipPostSync?: boolean;
    /** Bulk upload already classified modules; skip per-save reconcile. */
    skipDegreeReconcile?: boolean;
    /** Reuse settings/metadata across a bulk upload batch. */
    batch?: StudyPlanSaveBatchOptions;
  }
): Promise<StudyPlanStudent> {
  const moduleMissingCodeEarly = modules.find(
    (module) => !String(module.moduleCode ?? "").trim()
  );

  if (moduleMissingCodeEarly) {
    throw new Error(
      "Each module row must have a module code before saving the study plan."
    );
  }

  const studentInput = student.programmeType
    ? student
    : await attachProgrammeTypeToStudent(student);
  const settings =
    options?.batch?.settings ?? (await getStudyPlanSettingsCached());

  const intakeTerm = studentInput.intakeTerm || getEarliestStudyTerm(modules);
  const intakeYear = deriveIntakeYearFromTerm(intakeTerm);

  const graduateTerm = getLatestStudyTerm(modules);

  const studentStatus = calculateStudentStatus(
    modules,
    settings.currentStudyTerm,
    studentInput.programmeType
  );

  const savedStudent = await upsertStudyPlanStudent({
    ...studentInput,
    intakeYear,
    intakeLevel: getDefaultIntakeLevel(
      studentInput.programmeCode,
      studentInput.intakeLevel,
      studentInput.programmeType
    ),
    intakeTerm,
    graduateTerm,
    studentStatus,
  });

  if (!savedStudent.id) {
    throw new Error("Failed to save student profile.");
  }

  const savedStudentId = savedStudent.id;

  const mergedProgrammeType =
    studentInput.programmeType ?? savedStudent.programmeType;

  const studentWithType = mergedProgrammeType
    ? { ...savedStudent, programmeType: mergedProgrammeType }
    : await attachProgrammeTypeToStudent({
        ...savedStudent,
        programmeType: mergedProgrammeType,
      });

  const reconciledModules = options?.skipDegreeReconcile
    ? modules
    : await reconcileDegreeStudyPlanModules(studentWithType, modules);

  const moduleMetadataMap =
    options?.batch?.moduleMetadataMap ??
    (await loadModuleMetadataForPlan(
      studentWithType.programmeCode,
      studentWithType.programmeStream,
      reconciledModules.map((module) => ({
        moduleCode: module.moduleCode,
        programmeCode: module.programmeCode || studentWithType.programmeCode,
        programmeStream:
          module.programmeStream || studentWithType.programmeStream,
        moduleTerm: module.moduleTerm,
        moduleTermPattern: module.moduleTermPattern,
      }))
    ));

  const enrichedModules = reconciledModules.map((module) =>
    enrichStudyPlanModuleWithMetadata(
      {
        ...module,
        programmeCode: module.programmeCode || studentWithType.programmeCode,
        programmeStream: normalizeStream(
          module.programmeStream || studentWithType.programmeStream
        ),
        moduleTerm: module.moduleTerm || module.moduleTermPattern,
        moduleTermPattern: module.moduleTerm || module.moduleTermPattern,
      },
      studentWithType,
      moduleMetadataMap
    )
  );

  const moduleMissingCode = enrichedModules.find(
    (module) => !String(module.moduleCode ?? "").trim()
  );

  if (moduleMissingCode) {
    throw new Error(
      "Each module row must have a module code before saving the study plan."
    );
  }

  const dedupedModules = dedupeStudyPlanModulesByPersistKey(
    enrichedModules,
    studentWithType
  );

  const modulesReadyToSave = await attachExistingStudyPlanModuleIds(
    savedStudentId,
    dedupedModules,
    studentWithType
  );

  await persistStudyPlanModulesForStudent(
    studentWithType,
    savedStudentId,
    modulesReadyToSave,
    { isDegreeProgramme: options?.batch?.isDegreeProgramme }
  );

  if (!options?.skipPostSync) {
    try {
      await recalculateActualStudentNumbers();
      await syncActualStudentNumbersToTimetable();
    } catch (error) {
      throw new Error(
        formatStudyPlanSaveError(
          error,
          "Study plan modules were saved, but syncing timetable student numbers failed."
        )
      );
    }
  }

  return savedStudent;
}

/** Saves profile + modules (bulk upload and legacy callers). */
export async function saveStudyPlan(
  student: StudyPlanStudent,
  modules: StudyPlanModule[],
  options?: {
    skipPostSync?: boolean;
    skipDegreeReconcile?: boolean;
    batch?: StudyPlanSaveBatchOptions;
  }
) {
  return saveStudyPlanModules(student, modules, options);
}

export async function syncStudyPlanPostSave() {
  await recalculateActualStudentNumbers();
  await syncActualStudentNumbersToTimetable();
}

export async function buildStudyPlanModuleFieldsFromCode(params: {
  moduleCode: string;
  programmeCode?: string;
  programmeStream?: string;
  current?: Partial<StudyPlanModule>;
}): Promise<Partial<StudyPlanModule>> {
  const storedCode = String(params.moduleCode ?? "").trim().toUpperCase();

  if (!storedCode) {
    return {};
  }

  let metadata = await lookupStudyPlanModuleMetadataByCode({
    moduleCode: storedCode,
    programmeCode: params.programmeCode,
    programmeStream: params.programmeStream,
  });

  if (!metadata) {
    const baseCode = getBaseModuleCode(storedCode);
    if (baseCode && baseCode !== storedCode) {
      metadata = await lookupStudyPlanModuleMetadataByCode({
        moduleCode: baseCode,
        programmeCode: params.programmeCode,
        programmeStream: params.programmeStream,
      });
    }
  }

  if (!metadata) {
    return {
      moduleCode: storedCode,
      moduleName: "",
      moduleYear: undefined,
      moduleTerm: undefined,
      moduleTermPattern: undefined,
      sourceModuleId: undefined,
    };
  }

  const current = params.current;

  return {
    moduleCode: storedCode,
    moduleName: metadata.moduleName,
    moduleYear: metadata.moduleYear,
    moduleTerm: metadata.moduleTerm,
    moduleTermPattern: metadata.moduleTermPattern ?? metadata.moduleTerm,
    sourceModuleId: metadata.sourceModuleId,
    enrolledModuleInstanceCode:
      current?.enrolledModuleInstanceCode ?? undefined,
    programmeCode: metadata.programmeCode ?? current?.programmeCode,
    programmeStream: metadata.programmeStream ?? current?.programmeStream,
  };
}

export async function deleteStudyPlanModuleById(moduleId: string): Promise<void> {
  const { error } = await supabase
    .from("study_plan_modules")
    .delete()
    .eq("id", moduleId);

  if (error) throw error;
}

export async function upsertStudyPlanModuleRow(
  student: StudyPlanStudent,
  module: StudyPlanModule
): Promise<{ id: string; module: StudyPlanModule }> {
  const studentWithType = await attachProgrammeTypeToStudent(student);

  if (!studentWithType.id) {
    throw new Error("Save the student profile before updating a module row.");
  }

  if (!String(module.moduleCode ?? "").trim()) {
    throw new Error("Module code is required.");
  }

  if (module.status === "planned" && !module.studyTerm) {
    throw new Error(
      `Module ${module.moduleCode} is planned but has no study term.`
    );
  }

  const reconciledModules = await reconcileDegreeStudyPlanModules(
    studentWithType,
    [module]
  );

  const moduleToSave = reconciledModules[0] ?? module;
  const userModuleCode = String(module.moduleCode ?? moduleToSave.moduleCode ?? "")
    .trim()
    .toUpperCase();

  const moduleMetadataMap = await loadModuleMetadataForPlan(
    studentWithType.programmeCode,
    studentWithType.programmeStream,
    [
      {
        moduleCode: moduleToSave.moduleCode,
        programmeCode: moduleToSave.programmeCode || studentWithType.programmeCode,
        programmeStream:
          moduleToSave.programmeStream || studentWithType.programmeStream,
        moduleTerm: moduleToSave.moduleTerm,
        moduleTermPattern: moduleToSave.moduleTermPattern,
      },
    ]
  );

  const enrichedModule = enrichStudyPlanModuleWithMetadata(
    {
      ...moduleToSave,
      moduleCode: userModuleCode,
      programmeCode: moduleToSave.programmeCode || studentWithType.programmeCode,
      programmeStream: normalizeStream(
        moduleToSave.programmeStream || studentWithType.programmeStream
      ),
      moduleTerm: moduleToSave.moduleTerm || moduleToSave.moduleTermPattern,
      moduleTermPattern: moduleToSave.moduleTerm || moduleToSave.moduleTermPattern,
    },
    studentWithType,
    moduleMetadataMap
  );

  const row = toModuleRow(
    { ...enrichedModule, moduleCode: userModuleCode },
    studentWithType,
    studentWithType.id
  );

  let savedId = String(module.id ?? "").trim();

  if (module.id) {
    const { error } = await supabase
      .from("study_plan_modules")
      .upsert(row, { onConflict: "id" });

    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from("study_plan_modules")
      .upsert(row, { onConflict: STUDY_PLAN_MODULE_ROW_UNIQUE_CONFLICT })
      .select("id")
      .single();

    if (error) throw error;

    savedId = String(data.id ?? "").trim();
  }

  if (!savedId) {
    throw new Error("Failed to save module row (no id returned).");
  }

  const { data: savedRow, error: readError } = await supabase
    .from("study_plan_modules")
    .select("*")
    .eq("id", savedId)
    .single();

  if (readError) throw readError;

  return {
    id: savedId,
    module: {
      ...fromModuleRow(savedRow),
      moduleCode: userModuleCode,
    },
  };
}

/**
 * Load programme modules from modules table.
 *
 * Correct relationship:
 * programmes.programme_code   -> modules.programme_code
 * programmes.programme_stream -> modules.stream_code
 *
 * Important:
 * Also load common modules where modules.stream_code = 'nil'.
 *
 * Module identity rule:
 * module_code + programme_code + programme_stream
 *
 * Important:
 * modules table currently does NOT have module_sequence.
 */
/**
 * All distinct module codes for a programme (any stream), for upload templates.
 */
export async function loadProgrammeModuleCatalogForTemplate(
  programmeCode: string
): Promise<StudyPlanModule[]> {
  const code = String(programmeCode ?? "").trim();

  if (!code) {
    return [];
  }

  const { data, error } = await supabase
    .from("modules")
    .select(
      `
      id,
      module_code,
      module_name,
      module_year,
      module_term,
      programme_code,
      stream_code
      `
    )
    .eq("programme_code", code)
    .order("module_year", { ascending: true })
    .order("module_term", { ascending: true })
    .order("module_code", { ascending: true });

  if (error) {
    console.error(
      "[StudyPlanService] Failed to load programme module catalog:",
      error
    );
    throw error;
  }

  const moduleMap = new Map<string, any>();

  for (const row of data ?? []) {
    const moduleCode = String(row.module_code ?? "").trim();

    if (!moduleCode) continue;

    if (!moduleMap.has(moduleCode)) {
      moduleMap.set(moduleCode, row);
    }
  }

  const sortedRows = sortModuleRowsForDisplay(Array.from(moduleMap.values()));

  return sortedRows.map((row: any): StudyPlanModule => {
    const moduleTerm = row.module_term ?? undefined;

    return {
      sourceModuleId: row.id ?? undefined,
      programmeCode: row.programme_code,
      programmeStream: row.stream_code ?? "nil",
      moduleCode: row.module_code,
      moduleName: row.module_name ?? row.module_code,
      moduleYear: normalizeProgrammeYear(row.module_year) ?? undefined,
      moduleTerm,
      moduleTermPattern: moduleTerm,
      planStage: "programme",
      status: "planned",
      isExempted: false,
      isFailed: false,
      isLocked: false,
    };
  });
}

export async function loadProgrammeModules(
  programmeCode: string,
  programmeStream?: string
): Promise<StudyPlanModule[]> {
  const code = String(programmeCode ?? "").trim();
  const stream = normalizeStream(programmeStream);

  if (!code) {
    return [];
  }

  const streamValues = Array.from(
    new Set([stream, "nil"].map((value) => cleanStream(value)).filter(Boolean))
  );

  const { data, error } = await supabase
    .from("modules")
    .select(
      `
      id,
      module_code,
      module_name,
      module_year,
      module_term,
      module_type,
      programme_code,
      stream_code
      `
    )
    .eq("programme_code", code)
    .in("stream_code", streamValues)
    .order("module_year", { ascending: true })
    .order("module_term", { ascending: true })
    .order("module_code", { ascending: true });

  if (error) {
    console.error("[StudyPlanService] Failed to load modules:", error);
    throw error;
  }

  /**
   * De-duplicate by:
   * module_code + programme_code + programme_stream
   */
  const moduleMap = new Map<string, any>();

  for (const row of data ?? []) {
    const moduleCode = String(row.module_code ?? "").trim();

    if (!moduleCode) continue;

    const key = buildModuleRowIdentityKey(row);
    const existing = moduleMap.get(key);

    if (!existing) {
      moduleMap.set(key, row);
      continue;
    }

    const existingStream = cleanStream(existing.stream_code);
    const rowStream = cleanStream(row.stream_code);

    /**
     * Prefer selected stream row over common 'nil' row only when
     * they are the same module identity.
     */
    if (existingStream === "nil" && rowStream === stream) {
      moduleMap.set(key, row);
    }
  }

  const sortedRows = sortModuleRowsForDisplay(Array.from(moduleMap.values()));

  return sortedRows.map((row: any): StudyPlanModule => {
    const moduleTerm = row.module_term ?? undefined;

    return {
      sourceModuleId: row.id ?? undefined,

      programmeCode: row.programme_code ?? code,
      programmeStream: row.stream_code ?? stream,

      moduleCode: row.module_code,
      moduleName: row.module_name ?? row.module_code,
      moduleYear: normalizeProgrammeYear(row.module_year) ?? undefined,

      moduleTerm,
      moduleTermPattern: moduleTerm,
      moduleType: normalizeModuleType(row.module_type),

      enrolledModuleInstanceCode: undefined,

      /**
       * modules table does not have module_sequence.
       * Keep this undefined when loading programme modules.
       */
      moduleSequence: undefined,

      planStage: "programme",
      status: "planned",
      studyTerm: undefined,

      isExempted: false,
      isFailed: false,
      isLocked: false,
    };
  });
}

export async function getStudyPlanSettings(): Promise<StudyPlanSettings> {
  const [currentAcademicYear, currentStudyTerm] = await Promise.all([
    getCurrentAcademicYear(),
    getCurrentStudyTerm(),
  ]);

  return {
    currentAcademicYear,
    currentStudyTerm,
  };
}

export async function getStudyPlanSettingsCached(): Promise<StudyPlanSettings> {
  if (cachedStudyPlanSettings) {
    return cachedStudyPlanSettings;
  }

  cachedStudyPlanSettings = await getStudyPlanSettings();

  return cachedStudyPlanSettings;
}

export async function updateStudyPlanSettings(
  settings: StudyPlanSettings,
  updatedBy?: string
) {
  const rows = [
    {
      setting_key: "current_academic_year",
      setting_value: settings.currentAcademicYear,
      updated_at: new Date().toISOString(),
    },
    {
      setting_key: "current_study_term",
      setting_value: settings.currentStudyTerm,
      updated_at: new Date().toISOString(),
    },
  ];

  const { error } = await supabase
    .from("study_plan_settings")
    .upsert(rows, {
      onConflict: "setting_key",
    });

  if (error) throw error;

  if (updatedBy) {
    await setCurrentAcademicYearValue({
      academicYear: settings.currentAcademicYear,
      updatedBy,
    });

    await setCurrentStudyTermValue({
      studyTerm: settings.currentStudyTerm,
      updatedBy,
    });
  }
}

export async function recalculateAllStudentStatuses(
  currentStudyTerm?: string
) {
  const term = currentStudyTerm ?? (await getCurrentStudyTerm());

  const { data: students, error: studentError } = await supabase
    .from("study_plan_students")
    .select("id, programme_code");

  if (studentError) throw studentError;

  const programmeTypeByCode = new Map<string, string>();

  const programmeCodes = Array.from(
    new Set(
      (students ?? [])
        .map((row) => String(row.programme_code ?? "").trim())
        .filter(Boolean)
    )
  );

  if (programmeCodes.length > 0) {
    const { data: programmeRows, error: programmeError } = await supabase
      .from("programmes")
      .select("programme_code, programme_type")
      .in("programme_code", programmeCodes);

    if (programmeError) throw programmeError;

    for (const row of programmeRows ?? []) {
      const code = String(row.programme_code ?? "").trim().toUpperCase();

      if (!code || programmeTypeByCode.has(code)) {
        continue;
      }

      programmeTypeByCode.set(
        code,
        String(row.programme_type ?? "").trim() || "Unknown"
      );
    }
  }

  const { data: moduleRows, error: moduleError } = await supabase
    .from("study_plan_modules")
    .select("student_profile_id, plan_stage, status, study_term");

  if (moduleError) throw moduleError;

  const modulesByStudent = new Map<string, StudyPlanModule[]>();

  for (const row of moduleRows ?? []) {
    const profileId = String(row.student_profile_id ?? "").trim();

    if (!profileId) continue;

    const existing = modulesByStudent.get(profileId) ?? [];

    existing.push({
      planStage: row.plan_stage,
      status: row.status,
      studyTerm: row.study_term,
    } as StudyPlanModule);

    modulesByStudent.set(profileId, existing);
  }

  const updates = (students ?? []).map((student) => {
    const modules = modulesByStudent.get(student.id) ?? [];
    const programmeType = programmeTypeByCode.get(
      String(student.programme_code ?? "").trim().toUpperCase()
    );
    const studentStatus = calculateStudentStatus(modules, term, programmeType);

    return supabase
      .from("study_plan_students")
      .update({
        student_status: studentStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", student.id);
  });

  await Promise.all(updates);
}

export async function recalculateActualStudentNumbers() {
  try {
    const [moduleRows, studentRows] = await Promise.all([
      fetchAllPaginatedRows<{
        module_code: string;
        module_name: string | null;
        programme_code: string;
        programme_stream: string | null;
        study_term: string;
        status: string;
        plan_stage: string;
        student_profile_id: string;
      }>({
        fetchPage: ({ from, to }) =>
          supabase
            .from("study_plan_modules")
            .select(
              "module_code, module_name, programme_code, programme_stream, study_term, status, plan_stage, student_profile_id"
            )
            .eq("status", "planned")
            .eq("plan_stage", "programme")
            .not("study_term", "is", null)
            .order("id", { ascending: true })
            .range(from, to),
      }),
      fetchAllPaginatedRows<{ id: string; study_mode: string | null }>({
        fetchPage: ({ from, to }) =>
          supabase
            .from("study_plan_students")
            .select("id, study_mode")
            .order("id", { ascending: true })
            .range(from, to),
      }),
    ]);

    const studyModeByProfileId = new Map<string, string>();

    for (const student of studentRows) {
      studyModeByProfileId.set(
        String(student.id),
        String(student.study_mode ?? "").trim()
      );
    }

    const counts = new Map<string, any>();

    for (const row of moduleRows) {
      const studyTerm = String(row.study_term ?? "").trim();
      const academicYear = studyTermToAcademicYear(studyTerm);
      const programmeStream = normalizeStream(row.programme_stream);
      const studyMode =
        studyModeByProfileId.get(String(row.student_profile_id ?? "")) ?? "";

      const key = buildStudyPlanActualAggregateKey({
        academic_year: academicYear,
        study_term: studyTerm,
        module_code: row.module_code,
        programme_code: row.programme_code,
        programme_stream: programmeStream,
        study_mode: studyMode,
      });

      const existing = counts.get(key);

      if (existing) {
        existing.actual_student_number += 1;
      } else {
        counts.set(key, {
          academic_year: normalizeAcademicYear(academicYear),
          study_term: studyTerm,
          module_code: row.module_code,
          module_name: row.module_name,
          programme_code: row.programme_code,
          programme_stream: programmeStream,
          study_mode: studyMode,
          actual_student_number: 1,
          updated_at: new Date().toISOString(),
        });
      }
    }

    const rows = Array.from(counts.values()) as StudyPlanActualAggregateRow[];

    // if (debug) { ... console.table / academic_year · study_term totals ... }

    if (rows.length > 0) {
      for (
        let offset = 0;
        offset < rows.length;
        offset += RECALCULATE_UPSERT_BATCH_SIZE
      ) {
        const batch = rows.slice(offset, offset + RECALCULATE_UPSERT_BATCH_SIZE);
        const { error: upsertError } = await supabase
          .from("study_plan_actual_student_numbers")
          .upsert(batch, {
            onConflict: STUDY_PLAN_ACTUAL_UPSERT_CONFLICT,
          });

        if (upsertError) throw upsertError;
      }
    }

    await deleteStudyPlanActualOrphanRows(rows);
  } catch (error) {
    console.error("[recalculateActualStudentNumbers] failed:", error);
    throw error;
  }
}

export async function syncActualStudentNumbersToTimetable() {
  const data = await fetchAllPaginatedRows<Record<string, unknown>>({
    fetchPage: ({ from, to }) =>
      supabase
        .from("study_plan_actual_student_numbers")
        .select("*")
        .order("id", { ascending: true })
        .range(from, to),
  });

  const actualByModuleTerm = new Map<string, number>();
  const academicYears = new Set<string>();

  for (const row of data) {
    const studyTerm = String(row.study_term ?? "").trim();
    const academicYear = normalizeAcademicYear(String(row.academic_year ?? ""));

    if (!academicYear || !studyTerm) {
      continue;
    }

    academicYears.add(academicYear);

    const programmeStream = normalizeStream(
      String(row.programme_stream ?? "").trim()
    );

    const key = [
      academicYear,
      String(row.programme_code ?? "").trim(),
      String(row.module_code ?? "").trim(),
      programmeStream,
      studyTerm,
    ].join("|");

    actualByModuleTerm.set(
      key,
      (actualByModuleTerm.get(key) ?? 0) +
        Number(row.actual_student_number ?? 0)
    );
  }

  if (actualByModuleTerm.size === 0) return;

  const yearVariants = Array.from(academicYears).flatMap((year) =>
    getAcademicYearVariants(year)
  );

  const { data: timetableRows, error: timetableError } = await supabase
    .from("timetable_student_numbers")
    .select("*")
    .in("academic_year", Array.from(new Set(yearVariants)));

  if (timetableError) throw timetableError;

  const rowsForUpsert: Array<Record<string, unknown>> = [];

  for (const row of timetableRows ?? []) {
    const academicYear = normalizeAcademicYear(String(row.academic_year ?? ""));
    const studyTerm = String(row.study_term ?? "").trim();
    const lookupKey = [
      academicYear,
      String(row.programme_code ?? "").trim(),
      String(row.module_code ?? "").trim(),
      normalizeStream(String(row.programme_stream ?? "").trim()),
      studyTerm,
    ].join("|");

    const actual = actualByModuleTerm.get(lookupKey);

    if (actual === undefined) {
      continue;
    }

    const previousActual = Number(row.actual_student_number ?? 0);

    rowsForUpsert.push({
      academic_year: academicYear,
      module_code: row.module_code,
      module_term: row.module_term,
      programme_code: row.programme_code,
      programme_stream: normalizeStream(row.programme_stream),
      study_term: studyTerm,
      expected_student_number: resolveExpectedStudentNumberOnSync({
        existingExpected: row.expected_student_number,
        existingActual: previousActual,
        newActual: actual,
      }),
      actual_student_number: actual,
      updated_at: new Date().toISOString(),
    });
  }

  if (rowsForUpsert.length === 0) return;

  const { error: upsertError } = await supabase
    .from("timetable_student_numbers")
    .upsert(rowsForUpsert, {
      onConflict:
        "academic_year,module_code,programme_code,programme_stream,study_term",
    });

  if (upsertError) {
    throw new Error(
      formatStudyPlanSaveError(
        upsertError,
        "Failed to sync actual student numbers to timetable_student_numbers."
      )
    );
  }
}

export async function getStudyPlanReports() {
  const { data, error } = await supabase
    .from("study_plan_students")
    .select("*");

  if (error) throw error;

  const map = new Map<string, any>();

  for (const row of data ?? []) {
    const programmeStream = normalizeStream(row.programme_stream);

    const key = [
      row.programme_code,
      programmeStream,
      row.intake_year ?? "",
      row.intake_level ?? "",
      row.study_mode ?? "",
      row.student_status ?? "",
      row.intake_term ?? "",
      row.graduate_term ?? "",
    ].join("|");

    if (!map.has(key)) {
      map.set(key, {
        programmeCode: row.programme_code,
        programmeStream,
        intakeYear: row.intake_year ?? "",
        intakeLevel: normalizeIntakeLevel(row.intake_level) ?? "",
        studyMode: row.study_mode ?? "",
        studentStatus: row.student_status ?? "",
        intakeTerm: row.intake_term ?? "",
        graduateTerm: row.graduate_term ?? "",
        studentCount: 0,
      });
    }

    map.get(key).studentCount += 1;
  }

  return Array.from(map.values());
}

export async function getIntakeList(
  term: string,
  programmeCode?: string,
  stream?: string
) {
  let query = supabase
    .from("study_plan_students")
    .select("*")
    .eq("intake_term", term);

  if (programmeCode) {
    query = query.eq("programme_code", programmeCode);
  }

  if (stream !== undefined && stream !== "") {
    query = query.eq("programme_stream", cleanStream(stream));
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []).map(fromStudentRow);
}

export async function getGraduateList(
  term: string,
  programmeCode?: string,
  stream?: string
) {
  let query = supabase
    .from("study_plan_students")
    .select("*")
    .eq("graduate_term", term);

  if (programmeCode) {
    query = query.eq("programme_code", programmeCode);
  }

  if (stream !== undefined && stream !== "") {
    query = query.eq("programme_stream", cleanStream(stream));
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []).map(fromStudentRow);
}

export interface ProgrammeOption {
  programmeCode: string;
  programmeName?: string;

  /**
   * programmes.programme_stream.
   *
   * This value is used directly to query modules.stream_code.
   */
  programmeStream: string;

  programmeType?: string;

  /**
   * Articulation setting.
   *
   * Current real data design:
   * - For HD programme rows, this stores target Degree programme codes.
   *
   * Examples:
   * UWLCS
   * UWLBS/WUBM
   */
  articulation?: string;

}


/**
 * Load programme options from programmes table.
 *
 * Correct mapping:
 * programmes.programme_code   -> modules.programme_code
 * programmes.programme_stream -> modules.stream_code
 *
 * stream_abbr is intentionally ignored.
 */
/**
 * Load programme options from programmes table.
 *
 * Correct mapping:
 * programmes.programme_code   -> modules.programme_code
 * programmes.programme_stream -> modules.stream_code
 *
 * stream_abbr is intentionally ignored.
 *
 * Degree articulation:
 * programmes.articulation records which HD programme/stream combinations
 * can articulate into this degree programme.
 */
/**
 * Resolve whether a programme code is a Degree programme
 * using programmes.programme_type from the database.
 */
export async function isDegreeProgrammeByCode(
  programmeCode: string
): Promise<boolean> {
  const programmeType = await getProgrammeTypeByCode(programmeCode);

  if (!programmeType) {
    return false;
  }

  return isDegreeProgrammeType(programmeType);
}

/**
 * Resolve whether a programme code is an HD programme
 * using programmes.programme_type from the database.
 */
export async function isHDProgrammeByCode(
  programmeCode: string
): Promise<boolean> {
  const programmeType = await getProgrammeTypeByCode(programmeCode);

  if (!programmeType) {
    return false;
  }

  return isHDProgrammeType(programmeType);
}

export async function listProgrammeOptions(): Promise<ProgrammeOption[]> {
  const { data, error } = await supabase
    .from("programmes")
    .select(
      `
      programme_type,
      programme_code,
      programme_name,
      programme_stream,
      articulation
      `
    )
    .order("programme_code", { ascending: true })
    .order("programme_stream", { ascending: true });

  if (error) {
    console.error("[StudyPlanService] Failed to load programme options:", error);
    throw error;
  }

  const map = new Map<string, ProgrammeOption>();

  for (const row of data ?? []) {
    const programmeCode = String(row.programme_code ?? "").trim();

    if (!programmeCode) continue;

    programmeTypeByCodeCache.set(
      programmeCode,
      row.programme_type ?? null
    );

    const programmeName = String(row.programme_name ?? "").trim();
    const programmeStream = normalizeStream(row.programme_stream);

    const key = [programmeCode, programmeStream].join("|");

    if (!map.has(key)) {
      map.set(key, {
        programmeCode,
        programmeName,
        programmeStream,
        programmeType: row.programme_type ?? undefined,
        articulation: row.articulation ?? undefined,
      });
    }
  }

  return Array.from(map.values());
}

export async function getProgrammeOption(params: {
  programmeCode: string;
  programmeStream?: string;
}): Promise<ProgrammeOption | undefined> {
  const programmeCode = String(params.programmeCode ?? "").trim();
  const programmeStream = normalizeStream(params.programmeStream);

  if (!programmeCode) return undefined;

  const { data, error } = await supabase
    .from("programmes")
    .select(
      `
      programme_type,
      programme_code,
      programme_name,
      programme_stream,
      articulation
      `
    )
    .eq("programme_code", programmeCode)
    .eq("programme_stream", programmeStream)
    .maybeSingle();

  if (error) {
    console.error("[StudyPlanService] Failed to load programme option:", error);
    throw error;
  }

  if (!data) return undefined;

  return {
    programmeCode: String(data.programme_code ?? "").trim(),
    programmeName: String(data.programme_name ?? "").trim(),
    programmeStream: normalizeStream(data.programme_stream),
    programmeType: data.programme_type ?? undefined,
    articulation: data.articulation ?? undefined,
  };
}

/**
 * Load allowed bridging module options for a degree programme.
 *
 * Rule:
 * - programmes.articulation defines which HD programme + stream can articulate
 *   into this degree programme.
 * - Bridging module dropdown can only select modules from those HD programmes.
 * - For each HD stream, also include common modules where stream_code = 'nil'.
 *
 * Example:
 * Degree programme UWLC articulation:
 * HDEE:nil;HDCS:Cyber Security
 *
 * Then allowed bridging options are:
 * - modules where programme_code = HDEE and stream_code in ['nil']
 * - modules where programme_code = HDCS and stream_code in ['Cyber Security', 'nil']
 */
/**
 * Load allowed bridging module options for a Degree programme.
 *
 * Current articulation design:
 * - programmes.articulation is stored on HD programme/stream rows.
 * - It means "this HD programme stream can articulate to these Degree programmes".
 *
 * Example 1:
 * programmes row:
 * programme_code = HDC
 * programme_stream = Cyber Security
 * articulation = UWLCS
 *
 * Then when selected Degree programme is UWLCS:
 * - HDC Cyber Security is a valid articulation source.
 * - Bridging module dropdown should include:
 *   modules.programme_code = HDC
 *   modules.stream_code in ['Cyber Security', 'nil']
 *
 * Example 2:
 * programmes row:
 * programme_code = HDBA
 * programme_stream = Management
 * articulation = UWLBS/WUBM
 *
 * Then both UWLBS and WUBM can use HDBA Management modules as bridging options.
 */
export async function loadBridgingModuleOptionsForDegree(params: {
  degreeProgrammeCode: string;
  degreeProgrammeStream?: string;
}): Promise<StudyPlanModule[]> {
  const degreeProgrammeCode = String(params.degreeProgrammeCode ?? "")
    .trim()
    .toUpperCase();

  if (!degreeProgrammeCode) {
    return [];
  }

  const cacheKey = `${degreeProgrammeCode}|${normalizeStream(
    params.degreeProgrammeStream
  )}`;
  const cached = bridgingModuleOptionsCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  /**
   * Step 1:
   * Load programme rows that have articulation values.
   *
   * We intentionally parse in TypeScript instead of using SQL ilike,
   * because articulation may contain multiple Degree codes:
   * - UWLBS/WUBM
   * - UWLBS;WUBM
   * - UWLBS, WUBM
   */
  const { data: programmeRows, error: programmeError } = await supabase
    .from("programmes")
    .select(
      `
      programme_type,
      programme_code,
      programme_name,
      programme_stream,
      articulation
      `
    )
    .not("articulation", "is", null);

  if (programmeError) {
    console.error(
      "[StudyPlanService] Failed to load programme articulation rows:",
      programmeError
    );
    throw programmeError;
  }

  /**
   * Step 2:
   * Find HD programme/stream rows that articulate to selected Degree.
   *
   * Example:
   * selected Degree = WUBM
   * HDBA Management articulation = UWLBS/WUBM
   * => matched
   */
  const articulationSources = (programmeRows ?? [])
    .map((row: any) => ({
      programmeType: String(row.programme_type ?? "").trim(),
      programmeCode: String(row.programme_code ?? "").trim(),
      programmeName: String(row.programme_name ?? "").trim(),
      programmeStream: normalizeStream(row.programme_stream),
      articulation: String(row.articulation ?? "").trim(),
    }))
    .filter((row) => row.programmeCode)
    .filter((row) =>
      doesProgrammeRowArticulateToDegree({
        articulation: row.articulation,
        degreeProgrammeCode,
      })
    );

  if (articulationSources.length === 0) {
    console.warn("[StudyPlanService] No articulation source rows found.", {
      degreeProgrammeCode,
      programmeRowsWithArticulation: programmeRows,
    });

    return [];
  }

  /**
   * Step 3:
   * For each matched HD programme/stream row, load modules from modules table.
   *
   * Include:
   * - specific HD stream, e.g. Cyber Security / Management
   * - common modules where stream_code = 'nil'
   */
  const collectedRows: any[] = [];

  for (const source of articulationSources) {
    const sourceProgrammeCode = String(source.programmeCode ?? "").trim();
    const sourceProgrammeStream = normalizeStream(source.programmeStream);

    if (!sourceProgrammeCode) continue;

    const streamValues = Array.from(
      new Set(
        [sourceProgrammeStream, "nil"]
          .map((value) => cleanStream(value))
          .filter(Boolean)
      )
    );

    const { data: moduleRows, error: moduleError } = await supabase
      .from("modules")
      .select(
        `
        id,
        module_code,
        module_name,
        module_year,
        module_term,
        programme_code,
        stream_code
        `
      )
      .eq("programme_code", sourceProgrammeCode)
      .in("stream_code", streamValues)
      .order("module_year", { ascending: true })
      .order("module_term", { ascending: true })
      .order("module_code", { ascending: true });

    if (moduleError) {
      console.error("[StudyPlanService] Failed to load source HD modules:", {
        degreeProgrammeCode,
        sourceProgrammeCode,
        sourceProgrammeStream,
        streamValues,
        moduleError,
      });

      throw moduleError;
    }

    collectedRows.push(...(moduleRows ?? []));
  }

  if (collectedRows.length === 0) {
    console.warn(
      "[StudyPlanService] Articulation sources exist, but no modules were found.",
      {
        degreeProgrammeCode,
        articulationSources,
      }
    );

    return [];
  }

  /**
   * Step 4:
   * De-duplicate using existing module identity rule:
   * module_code + programme_code + programme_stream + module_term
   */
  const moduleMap = new Map<string, any>();

  for (const row of collectedRows) {
    const moduleCode = String(row.module_code ?? "").trim();

    if (!moduleCode) continue;

    const key = buildModuleRowIdentityKey(row);
    const existing = moduleMap.get(key);

    if (!existing) {
      moduleMap.set(key, row);
      continue;
    }

    /**
     * If duplicate exists, prefer stream-specific row over common nil row.
     */
    const existingStream = cleanStream(existing.stream_code);
    const rowStream = cleanStream(row.stream_code);

    if (existingStream === "nil" && rowStream !== "nil") {
      moduleMap.set(key, row);
    }
  }

  const sortedRows = sortModuleRowsForDisplay(Array.from(moduleMap.values()));

  const result = sortedRows.map((row: any): StudyPlanModule => {
    const moduleTerm = row.module_term ?? undefined;

    return {
      sourceModuleId: row.id ?? undefined,

      /**
       * Important:
       * Bridging module belongs to the source HD programme/stream,
       * not the selected Degree programme.
       */
      programmeCode: row.programme_code,
      programmeStream: row.stream_code ?? "nil",

      moduleCode: row.module_code,
      moduleName: row.module_name ?? row.module_code,
      moduleYear: normalizeProgrammeYear(row.module_year) ?? undefined,

      moduleTerm,
      moduleTermPattern: moduleTerm,

      enrolledModuleInstanceCode: undefined,
      moduleSequence: undefined,

      planStage: "bridging",
      status: "planned",
      studyTerm: undefined,

      isExempted: false,
      isFailed: false,
      isLocked: false,
    };
  });

  bridgingModuleOptionsCache.set(cacheKey, result);

  return result;
}


export function buildBridgingModulesFromUploadRow(params: {
  row: Record<string, any>;
  bridgingOptions: StudyPlanModule[];
  student: StudyPlanStudent;
}): StudyPlanModule[] {
  const { row, bridgingOptions, student } = params;

  const result: StudyPlanModule[] = [];

  for (let i = 1; i <= 7; i += 1) {
    const moduleCode = String(row[`bridging_module_${i}_code`] ?? "").trim();

    const studyTerm = String(
      row[`bridging_module_${i}_study_term`] ?? ""
    )
      .trim()
      .toUpperCase();

    /**
     * Both empty means this bridging slot is unused.
     */
    if (!moduleCode && !studyTerm) {
      continue;
    }

    /**
     * One filled but the other empty is invalid.
     */
    if (moduleCode && !studyTerm) {
      throw new Error(
        `Student ${student.studentId}: Bridging module ${i} has module code but no study term.`
      );
    }

    if (!moduleCode && studyTerm) {
      throw new Error(
        `Student ${student.studentId}: Bridging module ${i} has study term but no module code.`
      );
    }

    /**
     * Validate study term format.
     */
    if (!/^T\d{4}[ABC]$/i.test(studyTerm)) {
      throw new Error(
        `Student ${student.studentId}: Bridging module ${i} has invalid study term "${studyTerm}". Expected format like T2027A.`
      );
    }

    /**
     * Match by moduleCode.
     *
     * Note:
     * If the same moduleCode can appear in multiple terms, this will prefer
     * exact moduleCode only. If your bridging Excel later includes module_term,
     * we can strengthen this match by moduleCode + moduleTerm.
     */
    const matched = bridgingOptions.find(
      (module) =>
        String(module.moduleCode ?? "").trim().toLowerCase() ===
        moduleCode.toLowerCase()
    );

    if (!matched) {
      throw new Error(
        `Student ${student.studentId}: Bridging module ${moduleCode} is not allowed by articulation setting.`
      );
    }

    result.push({
      ...matched,

      id: undefined,
      studentId: student.studentId,
      studentProfileId: student.id,

      planStage: "bridging",
      status: "planned",
      studyTerm,

      isExempted: false,
      isFailed: false,
      isLocked: false,
    });
  }

  return result;
}

export async function listProgrammeStreamsByProgramme(
  programmeCode: string
): Promise<ProgrammeOption[]> {
  const options = await listProgrammeOptions();

  return options.filter((item) => item.programmeCode === programmeCode);
}
