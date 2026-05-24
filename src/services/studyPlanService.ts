import { supabase } from "../lib/supabase";

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

import {
  generateStudyPlanForStudent,
  getDegreeStartTermAfterBridging,
} from "../pages/programme-leader/make-study-plan/studyPlanRules";

import {
  getBaseModuleCode,
  inferPlanStageFromModuleCode,
  isHdStyleModuleCode,
} from "../lib/studyPlanModuleCode";

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

  return "Unknown error while saving study plan.";
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
    moduleYear: metadata.module_year ?? module.moduleYear,
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
    updated_at: new Date().toISOString(),
  };
}

function fromStudentRow(row: any): StudyPlanStudent {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    intakeYear: row.intake_year ?? undefined,
    intakeLevel: row.intake_level ?? undefined,
    studyMode: row.study_mode,
    programmeCode: row.programme_code,
    programmeStream: row.programme_stream ?? "",
    programmeType: row.programme_type ?? undefined,
    studentStatus: row.student_status,
    intakeTerm: row.intake_term ?? undefined,
    graduateTerm: row.graduate_term ?? undefined,
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

  const programmeCode = isBridging
    ? String(module.programmeCode ?? "").trim()
    : String(module.programmeCode || student.programmeCode).trim();

  const programmeStream = isBridging
    ? normalizeStream(module.programmeStream)
    : normalizeStream(module.programmeStream || student.programmeStream);

  if (isBridging && !programmeCode) {
    throw new Error(
      `Bridging module ${module.moduleCode} is missing HD programme code.`
    );
  }

  const moduleTerm = module.moduleTerm || module.moduleTermPattern || null;

  return {
    student_id: student.studentId,
    student_profile_id: profileId,

    /**
     * Module identity fields.
     */
    programme_code: programmeCode,
    programme_stream: programmeStream,

    module_code: module.moduleCode,
    module_name: module.moduleName,
    module_year: module.moduleYear ?? null,

    /**
     * Store term explicitly.
     *
     * For backward compatibility, also keep module_term_pattern populated.
     * In this project, module_term_pattern is used by old UI display logic.
     */
    module_term: moduleTerm,
    module_term_pattern: moduleTerm,

    delivery_mode: module.deliveryMode ?? null,

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
    moduleYear: row.module_year ?? undefined,

    moduleTerm,
    moduleTermPattern: moduleTerm,

    deliveryMode: row.delivery_mode ?? undefined,
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
async function loadModuleMetadataForPlan(
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

async function lookupHdModuleMetadataByCode(
  moduleCode: string
): Promise<StudyPlanModule | null> {
  const normalizedCode = getBaseModuleCode(moduleCode);

  if (!normalizedCode) {
    return null;
  }

  const { data: moduleRows, error: moduleError } = await supabase
    .from("modules")
    .select(
      "id, module_code, module_name, module_year, module_term, programme_code, stream_code"
    )
    .eq("module_code", normalizedCode)
    .limit(20);

  if (moduleError) {
    console.error(
      "[StudyPlanService] Failed to lookup HD module metadata:",
      moduleError
    );
    return null;
  }

  if (!moduleRows?.length) {
    return null;
  }

  const programmeCodes = Array.from(
    new Set(
      moduleRows
        .map((row) => String(row.programme_code ?? "").trim())
        .filter(Boolean)
    )
  );

  const { data: programmeRows, error: programmeError } = await supabase
    .from("programmes")
    .select("programme_code, programme_type")
    .in("programme_code", programmeCodes);

  if (programmeError) {
    console.error(
      "[StudyPlanService] Failed to lookup programme type for HD module:",
      programmeError
    );
  }

  const hdProgrammeCodes = new Set(
    (programmeRows ?? [])
      .filter((row) => isHDProgrammeType(String(row.programme_type ?? "")))
      .map((row) => String(row.programme_code ?? "").trim())
      .filter(Boolean)
  );

  const matchedRow =
    moduleRows.find((row) =>
      hdProgrammeCodes.has(String(row.programme_code ?? "").trim())
    ) ?? moduleRows[0];

  return {
    moduleCode: String(matchedRow.module_code ?? normalizedCode).trim(),
    moduleName: String(matchedRow.module_name ?? normalizedCode).trim(),
    moduleYear: matchedRow.module_year ?? undefined,
    moduleTerm: matchedRow.module_term ?? undefined,
    moduleTermPattern: matchedRow.module_term ?? undefined,
    programmeCode: String(matchedRow.programme_code ?? "").trim(),
    programmeStream: normalizeStream(matchedRow.stream_code),
    sourceModuleId: matchedRow.id ?? undefined,
    planStage: "bridging",
    status: "planned",
  };
}

/**
 * Reconcile Degree study plan rows that were saved as programme modules
 * under the Degree programme code (legacy / HD-style upload).
 *
 * - Match module codes against articulation HD bridging catalog
 * - Fall back to code structure when catalog lookup misses:
 *   HD-style (2 letters + 3 digits) -> bridging, length > 5 -> programme
 * - Restore planStage, HD programme identity, and module metadata
 * - Drop duplicate programme rows for the same bridging module code
 * - Auto-generate missing Degree programme modules for edit view
 */
async function reconcileDegreeStudyPlanModules(
  student: StudyPlanStudent,
  modules: StudyPlanModule[]
): Promise<StudyPlanModule[]> {
  const studentWithType = await attachProgrammeTypeToStudent(student);

  if (!isDegreeProgramme(studentWithType.programmeCode, studentWithType.programmeType)) {
    return modules;
  }

  const bridgingCatalog = await loadBridgingModuleOptionsForDegree({
    degreeProgrammeCode: studentWithType.programmeCode,
    degreeProgrammeStream: studentWithType.programmeStream,
  });

  const bridgingByCode = buildBridgingCatalogByModuleCode(bridgingCatalog);
  const bridgingCodes = new Set(bridgingByCode.keys());
  const hdMetadataCache = new Map<string, StudyPlanModule | null>();

  let reconciled = await Promise.all(
    modules.map(async (module) => {
      const moduleCode = getBaseModuleCode(module.moduleCode);
      const catalogMatch = bridgingByCode.get(moduleCode);

      if (catalogMatch) {
        return {
          ...module,
          planStage: "bridging" as const,
          programmeCode: catalogMatch.programmeCode,
          programmeStream: normalizeStream(catalogMatch.programmeStream),
          sourceModuleId: catalogMatch.sourceModuleId ?? module.sourceModuleId,
          moduleName:
            catalogMatch.moduleName ?? module.moduleName ?? module.moduleCode,
          moduleYear: catalogMatch.moduleYear ?? module.moduleYear,
          moduleTerm: catalogMatch.moduleTerm ?? module.moduleTerm,
          moduleTermPattern:
            catalogMatch.moduleTermPattern ??
            catalogMatch.moduleTerm ??
            module.moduleTermPattern ??
            module.moduleTerm,
        };
      }

      if (
        module.planStage === "bridging" ||
        isHdStyleModuleCode(moduleCode) ||
        inferPlanStageFromModuleCode(moduleCode) === "bridging"
      ) {
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
        };
      }

      return module;
    })
  );

  reconciled = reconciled.filter((module) => {
    if (module.planStage !== "programme") {
      return true;
    }

    return !bridgingCodes.has(
      getBaseModuleCode(module.moduleCode)
    );
  });

  reconciled = reconciled.filter((module) => {
    if (module.planStage !== "programme") {
      return true;
    }

    return !isHdStyleModuleCode(module.moduleCode);
  });

  const hasProgrammeModules = reconciled.some(
    (module) => module.planStage === "programme"
  );

  if (!hasProgrammeModules && studentWithType.intakeTerm) {
    const bridgingModules = reconciled.filter(
      (module) => module.planStage === "bridging"
    );

    const programmeTemplate = await loadProgrammeModules(
      studentWithType.programmeCode,
      studentWithType.programmeStream
    );

    if (programmeTemplate.length > 0) {
      const startTerm = getDegreeStartTermAfterBridging(
        bridgingModules,
        studentWithType.intakeTerm
      );

      const generatedProgrammeModules = generateStudyPlanForStudent({
        student: studentWithType,
        modules: programmeTemplate.map((module) => ({
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

  const { data: moduleRows, error: moduleError } = await supabase
    .from("study_plan_modules")
    .select("*")
    .in("student_profile_id", profileIds)
    .order("plan_stage", { ascending: false })
    .order("module_year", { ascending: true })
    .order("module_term", { ascending: true })
    .order("module_sequence", { ascending: true })
    .order("module_code", { ascending: true });

  if (moduleError) throw moduleError;

  const modulesByProfileId = new Map<string, StudyPlanModule[]>();

  for (const row of moduleRows ?? []) {
    const profileId = String(row.student_profile_id ?? "");

    if (!profileId) continue;

    const existing = modulesByProfileId.get(profileId) ?? [];
    existing.push(fromModuleRow(row));
    modulesByProfileId.set(profileId, existing);
  }

  const metadataInputs = studentsWithType.flatMap((student) => {
    if (!student.id) return [];

    return (modulesByProfileId.get(student.id) ?? []).map((module) => ({
      moduleCode: module.moduleCode,
      programmeCode: module.programmeCode || student.programmeCode,
      programmeStream: module.programmeStream || student.programmeStream,
      moduleTerm: module.moduleTerm,
      moduleTermPattern: module.moduleTermPattern,
    }));
  });

  const moduleMetadataMap = await loadModuleMetadataForPlan(
    studentsWithType[0]?.programmeCode ?? "",
    studentsWithType[0]?.programmeStream,
    metadataInputs
  );

  return studentsWithType.map((student) => {
    const savedModules = student.id
      ? modulesByProfileId.get(student.id) ?? []
      : [];

    const enrichedModules = savedModules.map((module) =>
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

  if (error) throw error;

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

export async function saveStudyPlan(
  student: StudyPlanStudent,
  modules: StudyPlanModule[],
  options?: {
    skipPostSync?: boolean;
  }
) {
  const studentInput = await attachProgrammeTypeToStudent(student);
  const settings = await getStudyPlanSettings();

  const intakeTerm = studentInput.intakeTerm || getEarliestStudyTerm(modules);
  const intakeYear = deriveIntakeYearFromTerm(intakeTerm);

  const graduateTerm = getLatestStudyTerm(modules);

  const studentStatus = calculateStudentStatus(
    modules,
    settings.currentStudyTerm
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

  const studentWithType = await attachProgrammeTypeToStudent({
    ...savedStudent,
    programmeType: studentInput.programmeType ?? savedStudent.programmeType,
  });

  const reconciledModules = await reconcileDegreeStudyPlanModules(
    studentWithType,
    modules
  );

  const moduleMetadataMap = await loadModuleMetadataForPlan(
    studentWithType.programmeCode,
    studentWithType.programmeStream,
    reconciledModules.map((module) => ({
      moduleCode: module.moduleCode,
      programmeCode: module.programmeCode || studentWithType.programmeCode,
      programmeStream: module.programmeStream || studentWithType.programmeStream,
      moduleTerm: module.moduleTerm,
      moduleTermPattern: module.moduleTermPattern,
    }))
  );

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

  const rows = enrichedModules.map((module) =>
    toModuleRow(
      module,
      studentWithType,
      savedStudent.id
    )
  );

  if (rows.length > 0) {
    const { error } = await supabase
      .from("study_plan_modules")
      .upsert(rows, {
        onConflict:
          "student_profile_id,module_code,programme_code,programme_stream,plan_stage",
      });

    if (error) throw error;
  }

  if (await isDegreeProgrammeByCode(studentWithType.programmeCode)) {
    const bridgingModuleCodes = Array.from(
      new Set(
        enrichedModules
          .filter((module) => module.planStage === "bridging")
          .map((module) => String(module.moduleCode ?? "").trim())
          .filter(Boolean)
      )
    );

    if (bridgingModuleCodes.length > 0) {
      const { error: cleanupError } = await supabase
        .from("study_plan_modules")
        .delete()
        .eq("student_profile_id", savedStudent.id)
        .eq("plan_stage", "programme")
        .eq("programme_code", studentWithType.programmeCode)
        .in("module_code", bridgingModuleCodes);

      if (cleanupError) throw cleanupError;
    }
  }

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

export async function syncStudyPlanPostSave() {
  await recalculateActualStudentNumbers();
  await syncActualStudentNumbersToTimetable();
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

  console.log("[StudyPlanService] Loading modules from modules table:", {
    programmeCode: code,
    programmeStream: stream,
    includedStreams: streamValues,
    query: {
      programme_code: code,
      stream_code_in: streamValues,
    },
  });

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
    .in("stream_code", streamValues)
    .order("module_year", { ascending: true })
    .order("module_term", { ascending: true })
    .order("module_code", { ascending: true });

  if (error) {
    console.error("[StudyPlanService] Failed to load modules:", error);
    throw error;
  }

  console.log("[StudyPlanService] Raw modules loaded:", data);

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

  console.log(
    "[StudyPlanService] Modules after identity de-duplicate and sort:",
    sortedRows
  );

  return sortedRows.map((row: any): StudyPlanModule => {
    const moduleTerm = row.module_term ?? undefined;

    return {
      sourceModuleId: row.id ?? undefined,

      programmeCode: row.programme_code ?? code,
      programmeStream: row.stream_code ?? stream,

      moduleCode: row.module_code,
      moduleName: row.module_name ?? row.module_code,
      moduleYear: row.module_year ?? undefined,

      moduleTerm,
      moduleTermPattern: moduleTerm,

      deliveryMode: undefined,

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
    .select("id");

  if (studentError) throw studentError;

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
    const studentStatus = calculateStudentStatus(modules, term);

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
  const [{ data: moduleRows, error: moduleError }, { data: studentRows, error: studentError }] =
    await Promise.all([
      supabase
        .from("study_plan_modules")
        .select(
          "module_code, module_name, programme_code, programme_stream, study_term, status, plan_stage, student_profile_id"
        )
        .eq("status", "planned")
        .eq("plan_stage", "programme")
        .not("study_term", "is", null),
      supabase.from("study_plan_students").select("id, study_mode"),
    ]);

  if (moduleError) throw moduleError;
  if (studentError) throw studentError;

  const studyModeByProfileId = new Map<string, string>();

  for (const student of studentRows ?? []) {
    studyModeByProfileId.set(
      String(student.id),
      String(student.study_mode ?? "").trim()
    );
  }

  const counts = new Map<string, any>();

  for (const row of moduleRows ?? []) {
    const studyTerm = row.study_term as string;
    const academicYear = studyTermToAcademicYear(studyTerm);
    const programmeStream = normalizeStream(row.programme_stream);
    const studyMode =
      studyModeByProfileId.get(String(row.student_profile_id ?? "")) ?? "";

    const key = [
      academicYear,
      studyTerm,
      row.module_code,
      row.programme_code,
      programmeStream,
      studyMode,
    ].join("|");

    const existing = counts.get(key);

    if (existing) {
      existing.actual_student_number += 1;
    } else {
      counts.set(key, {
        academic_year: academicYear,
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

  const { error: deleteError } = await supabase
    .from("study_plan_actual_student_numbers")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (deleteError) throw deleteError;

  const rows = Array.from(counts.values());

  if (rows.length === 0) return;

  const { error: insertError } = await supabase
    .from("study_plan_actual_student_numbers")
    .insert(rows);

  if (insertError) throw insertError;
}

export async function syncActualStudentNumbersToTimetable() {
  const { data, error } = await supabase
    .from("study_plan_actual_student_numbers")
    .select("*");

  if (error) throw error;

  const grouped = new Map<string, any>();

  for (const row of data ?? []) {
    const programmeStream = normalizeStream(row.programme_stream);
    const studyTerm = String(row.study_term ?? "").trim();

    const key = [
      row.academic_year,
      studyTerm,
      row.module_code,
      row.programme_code,
      programmeStream,
    ].join("|");

    const existing = grouped.get(key);

    if (existing) {
      existing.actual_student_number += row.actual_student_number;
      existing.updated_at = new Date().toISOString();
    } else {
      grouped.set(key, {
        academic_year: row.academic_year,
        module_code: row.module_code,
        programme_code: row.programme_code,
        programme_stream: programmeStream,
        study_term: studyTerm,
        actual_student_number: row.actual_student_number,
        updated_at: new Date().toISOString(),
      });
    }
  }

  const rows = Array.from(grouped.values());

  if (rows.length === 0) return;

  const moduleCodes = Array.from(
    new Set(rows.map((row) => String(row.module_code ?? "").trim()).filter(Boolean))
  );

  const { data: moduleRows } = await supabase
    .from("modules")
    .select("module_code, programme_code, stream_code, module_term")
    .in("module_code", moduleCodes);

  const catalogTermMap = new Map<string, string>();

  for (const moduleRow of moduleRows ?? []) {
    const key = buildModuleIdentityKey({
      moduleCode: moduleRow.module_code,
      programmeCode: moduleRow.programme_code,
      programmeStream: moduleRow.stream_code,
    });

    catalogTermMap.set(key, moduleRow.module_term);
  }

  const DEFAULT_CATALOG_MODULE_TERM = "Sep";

  const rowsForUpsert = rows
    .map((row) => {
      const moduleTerm =
        resolveCatalogModuleTermFromMap(
          {
            moduleCode: String(row.module_code ?? "").trim(),
            programmeCode: String(row.programme_code ?? "").trim(),
            programmeStream: row.programme_stream,
          },
          catalogTermMap
        ) ?? DEFAULT_CATALOG_MODULE_TERM;

      return {
        academic_year: row.academic_year,
        module_code: row.module_code,
        programme_code: row.programme_code,
        programme_stream: row.programme_stream,
        study_term: row.study_term,
        module_term: moduleTerm,
        expected_student_number: 0,
        actual_student_number: row.actual_student_number,
        updated_at: row.updated_at,
      };
    })
    .filter((row) => {
      const academicYear = String(row.academic_year ?? "").trim();
      const studyTerm = String(row.study_term ?? "").trim();
      return Boolean(academicYear && studyTerm);
    });

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
        intakeLevel: row.intake_level ?? "",
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

  console.log("[StudyPlanService] Loading bridging options for Degree:", {
    degreeProgrammeCode,
    degreeProgrammeStream: params.degreeProgrammeStream,
  });

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

  console.log("[StudyPlanService] Articulation sources found:", {
    degreeProgrammeCode,
    articulationSources,
  });

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

    console.log("[StudyPlanService] Querying source HD modules:", {
      degreeProgrammeCode,
      sourceProgrammeCode,
      sourceProgrammeStream,
      streamValues,
    });

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

    console.log("[StudyPlanService] Source HD modules loaded:", {
      degreeProgrammeCode,
      sourceProgrammeCode,
      sourceProgrammeStream,
      streamValues,
      count: moduleRows?.length ?? 0,
      moduleRows,
    });

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
      moduleYear: row.module_year ?? undefined,

      moduleTerm,
      moduleTermPattern: moduleTerm,

      deliveryMode: undefined,
      moduleSequence: undefined,

      planStage: "bridging",
      status: "planned",
      studyTerm: undefined,

      isExempted: false,
      isFailed: false,
      isLocked: false,
    };
  });

  console.log("[StudyPlanService] Final bridging module options:", {
    degreeProgrammeCode,
    count: result.length,
    result,
  });

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
