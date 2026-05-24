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
  intakeTermToIntakeYear,
  studyTermToAcademicYear,
} from "../pages/programme-leader/make-study-plan/helpers";

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
 * Module identity rule:
 *
 * module_code + programme_code + programme_stream + term
 *
 * Important:
 * Do NOT identify a module only by module_code.
 * Example:
 * UWLC Project Feb and UWLC Project Sep may have the same module_code,
 * but they are different module instances.
 */
function buildModuleIdentityKey(input: {
  moduleCode?: string | null;
  programmeCode?: string | null;
  programmeStream?: string | null;
  moduleTerm?: string | null;
  moduleTermPattern?: string | null;
}) {
  const term = input.moduleTerm || input.moduleTermPattern || "";

  return [
    input.moduleCode,
    input.programmeCode,
    normalizeStream(input.programmeStream),
    term,
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
    moduleTerm: row.module_term,
    moduleTermPattern: row.module_term_pattern,
  });
}

/**
 * Build identity key from StudyPlanModule.
 */
function buildStudyPlanModuleIdentityKey(module: StudyPlanModule) {
  return buildModuleIdentityKey({
    moduleCode: module.moduleCode,
    programmeCode: module.programmeCode,
    programmeStream: module.programmeStream,
    moduleTerm: module.moduleTerm,
    moduleTermPattern: module.moduleTermPattern,
  });
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
      student.intakeLevel
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
    studentStatus: row.student_status,
    intakeTerm: row.intake_term ?? undefined,
    graduateTerm: row.graduate_term ?? undefined,
  };
}

function toModuleRow(
  module: StudyPlanModule,
  student: StudyPlanStudent,
  profileId: string
) {
  const programmeCode = module.programmeCode || student.programmeCode;
  const programmeStream = normalizeStream(
    module.programmeStream || student.programmeStream
  );
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
  const code = String(programmeCode ?? "").trim();
  const stream = normalizeStream(programmeStream);

  const uniqueModuleCodes = Array.from(
    new Set(
      modules
        .map((item) => String(item.moduleCode ?? "").trim())
        .filter(Boolean)
    )
  );

  if (!code || uniqueModuleCodes.length === 0) {
    return new Map<string, any>();
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
      programme_code,
      stream_code
      `
    )
    .eq("programme_code", code)
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

    if (!existing) {
      map.set(rowKey, row);
      continue;
    }

    const existingStream = cleanStream(existing.stream_code);
    const rowStream = cleanStream(row.stream_code);

    /**
     * Prefer exact stream-specific metadata over common 'nil' metadata.
     */
    if (existingStream === "nil" && rowStream === stream) {
      map.set(rowKey, row);
    }
  }

  return map;
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

  const student = fromStudentRow(studentRow);
  const savedModules = (moduleRows ?? []).map(fromModuleRow);

  const moduleMetadataMap = await loadModuleMetadataForPlan(
    student.programmeCode,
    student.programmeStream,
    savedModules.map((module) => ({
      moduleCode: module.moduleCode,
      programmeCode: module.programmeCode || student.programmeCode,
      programmeStream: module.programmeStream || student.programmeStream,
      moduleTerm: module.moduleTerm,
      moduleTermPattern: module.moduleTermPattern,
    }))
  );

  const enrichedModules = savedModules.map((module) => {
    const key = buildStudyPlanModuleIdentityKey({
      ...module,
      programmeCode: module.programmeCode || student.programmeCode,
      programmeStream: module.programmeStream || student.programmeStream,
    });

    const metadata = moduleMetadataMap.get(key);

    if (!metadata) {
      return {
        ...module,
        moduleName: module.moduleName || module.moduleCode,
      };
    }

    const moduleTerm = metadata.module_term ?? module.moduleTerm;

    return {
      ...module,

      moduleName: metadata.module_name ?? module.moduleName ?? module.moduleCode,
      moduleYear: metadata.module_year ?? module.moduleYear,

      moduleTerm,
      moduleTermPattern: moduleTerm,

      /**
       * Do not read metadata.module_sequence.
       * modules table does not have this column.
       */
      moduleSequence: module.moduleSequence,

      programmeCode: module.programmeCode || metadata.programme_code,
      programmeStream: module.programmeStream,
      sourceModuleId: metadata.id ?? module.sourceModuleId,
    } as StudyPlanModule;
  });

  const sortedModules = [...enrichedModules].sort((a, b) => {
    const yearDiff =
      getModuleYearOrder(a.moduleYear) - getModuleYearOrder(b.moduleYear);

    if (yearDiff !== 0) return yearDiff;

    const termDiff =
      getModuleTermOrder(a.moduleTerm ?? a.moduleTermPattern) -
      getModuleTermOrder(b.moduleTerm ?? b.moduleTermPattern);

    if (termDiff !== 0) return termDiff;

    const sequenceDiff =
      Number(a.moduleSequence ?? 999) - Number(b.moduleSequence ?? 999);

    if (sequenceDiff !== 0) return sequenceDiff;

    return String(a.moduleCode ?? "").localeCompare(String(b.moduleCode ?? ""));
  });

  return {
    student,
    modules: sortedModules,
  };
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
  modules: StudyPlanModule[]
) {
  const settings = await getStudyPlanSettings();

  const intakeTerm = student.intakeTerm || getEarliestStudyTerm(modules);
  const intakeYear = deriveIntakeYearFromTerm(intakeTerm);

  const graduateTerm = getLatestStudyTerm(modules);

  const studentStatus = calculateStudentStatus(
    modules,
    settings.currentStudyTerm
  );

  const savedStudent = await upsertStudyPlanStudent({
    ...student,
    intakeYear,
    intakeLevel: getDefaultIntakeLevel(
      student.programmeCode,
      student.intakeLevel
    ),
    intakeTerm,
    graduateTerm,
    studentStatus,
  });

  if (!savedStudent.id) {
    throw new Error("Failed to save student profile.");
  }

  const moduleMetadataMap = await loadModuleMetadataForPlan(
    student.programmeCode,
    student.programmeStream,
    modules.map((module) => ({
      moduleCode: module.moduleCode,
      programmeCode: module.programmeCode || student.programmeCode,
      programmeStream: module.programmeStream || student.programmeStream,
      moduleTerm: module.moduleTerm,
      moduleTermPattern: module.moduleTermPattern,
    }))
  );

  const enrichedModules = modules.map((module) => {
    const normalizedModule: StudyPlanModule = {
      ...module,
      programmeCode: module.programmeCode || student.programmeCode,
      programmeStream: normalizeStream(
        module.programmeStream || student.programmeStream
      ),
      moduleTerm: module.moduleTerm || module.moduleTermPattern,
      moduleTermPattern: module.moduleTerm || module.moduleTermPattern,
    };

    const key = buildStudyPlanModuleIdentityKey(normalizedModule);
    const metadata = moduleMetadataMap.get(key);

    const moduleTerm =
      metadata?.module_term ??
      normalizedModule.moduleTerm ??
      normalizedModule.moduleTermPattern;

    return {
      ...normalizedModule,
      sourceModuleId: metadata?.id ?? normalizedModule.sourceModuleId,

      programmeCode: student.programmeCode,
      programmeStream: normalizeStream(student.programmeStream),

      moduleName:
        metadata?.module_name ??
        normalizedModule.moduleName ??
        normalizedModule.moduleCode,

      moduleYear:
        metadata?.module_year ??
        normalizedModule.moduleYear,

      moduleTerm,
      moduleTermPattern: moduleTerm,

      /**
       * Do not read metadata.module_sequence.
       * modules table does not have this column.
       */
      moduleSequence: normalizedModule.moduleSequence,
    };
  });

  const rows = enrichedModules.map((module) =>
    toModuleRow(
      module,
      savedStudent,
      savedStudent.id
    )
  );

  if (rows.length > 0) {
    const { error } = await supabase
      .from("study_plan_modules")
      .upsert(rows, {
        onConflict:
          "student_profile_id,module_code,programme_code,programme_stream,module_term,plan_stage",
      });

    if (error) throw error;
  }

  await recalculateActualStudentNumbers();
  await syncActualStudentNumbersToTimetable();

  return savedStudent;
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
 * module_code + programme_code + programme_stream + module_term
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
   * module_code + programme_code + programme_stream + module_term
   *
   * NOT only module_code.
   *
   * This preserves cases like:
   * - Project Sep
   * - Project Feb
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
  const { data, error } = await supabase
    .from("study_plan_settings")
    .select("*")
    .in("setting_key", ["current_academic_year", "current_study_term"]);

  if (error) throw error;

  const map = new Map<string, string>();

  for (const row of data ?? []) {
    map.set(row.setting_key, row.setting_value);
  }

  return {
    currentAcademicYear: map.get("current_academic_year") ?? "2025/26",
    currentStudyTerm: map.get("current_study_term") ?? "T2026A",
  };
}

export async function updateStudyPlanSettings(settings: StudyPlanSettings) {
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
}

export async function recalculateActualStudentNumbers() {
  const { data, error } = await supabase
    .from("study_plan_modules")
    .select(
      `
      module_code,
      module_name,
      programme_code,
      programme_stream,
      study_term,
      status,
      plan_stage,
      student_profile_id,
      study_plan_students!inner (
        study_mode
      )
    `
    )
    .eq("status", "planned")
    .eq("plan_stage", "programme")
    .not("study_term", "is", null);

  if (error) throw error;

  const counts = new Map<string, any>();

  for (const row of data ?? []) {
    const studyTerm = row.study_term as string;
    const academicYear = studyTermToAcademicYear(studyTerm);
    const programmeStream = normalizeStream(row.programme_stream);

    const joinedStudent = Array.isArray(row.study_plan_students)
      ? row.study_plan_students[0]
      : row.study_plan_students;

    const studyMode = joinedStudent?.study_mode ?? "";

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
    const key = [
      row.academic_year,
      row.study_term,
      row.module_code,
      row.programme_code,
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
        programme_stream: "all",
        module_term: row.study_term,
        actual_student_number: row.actual_student_number,
        updated_at: new Date().toISOString(),
      });
    }
  }

  const rows = Array.from(grouped.values());

  if (rows.length === 0) return;

  const { error: upsertError } = await supabase
    .from("timetable_student_numbers")
    .upsert(rows, {
      onConflict: "academic_year,module_code,programme_code,module_term",
    });

  if (upsertError) throw upsertError;
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
export async function listProgrammeOptions(): Promise<ProgrammeOption[]> {
  const { data, error } = await supabase
    .from("programmes")
    .select(
      `
      programme_type,
      programme_code,
      programme_name,
      programme_stream
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

    const programmeName = String(row.programme_name ?? "").trim();
    const programmeStream = normalizeStream(row.programme_stream);

    const key = [programmeCode, programmeStream].join("|");

    if (!map.has(key)) {
      map.set(key, {
        programmeCode,
        programmeName,
        programmeStream,
        programmeType: row.programme_type ?? undefined,
      });
    }
  }

  return Array.from(map.values());
}

export async function listProgrammeStreamsByProgramme(
  programmeCode: string
): Promise<ProgrammeOption[]> {
  const options = await listProgrammeOptions();

  return options.filter((item) => item.programmeCode === programmeCode);
}
