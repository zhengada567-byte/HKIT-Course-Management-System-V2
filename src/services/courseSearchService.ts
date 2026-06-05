import { supabase } from "../lib/supabase";
import {
  deleteModule,
  normalizeModuleType,
  normalizeUsesComputerFlag,
  upsertModule,
  type ModuleInput,
} from "./moduleService";
import {
  getModuleTermOrder,
  getModuleYearOrder,
  normalizeStream,
} from "../lib/utils";
import type {
  ModuleAdjustmentRow,
  ModuleRow,
  ModuleTerm,
  ModuleType,
  ModuleUsesComputerFlag,
} from "../types";

export interface CourseSearchRow {
  module_id: string;
  programme_code: string;
  stream_code: string;
  module_code: string;
  module_name: string | null;
  uses_computer: ModuleUsesComputerFlag;
  module_type: ModuleType;
  module_teaching_contact_hours: number;
  module_tutorial_contact_hours: number;
  original_module_year: string | null;
  original_module_term: ModuleTerm;
  adjusted_module_year: string | null;
  adjusted_module_term: ModuleTerm | null;
  final_module_year: string | null;
  final_module_term: ModuleTerm;
}

export type CourseSearchModuleDraft = {
  module_id: string;
  module_code: string;
  programme_code: string;
  stream_code: string;
  module_name: string;
  module_year: string;
  module_term: ModuleTerm;
  uses_computer: ModuleUsesComputerFlag;
  module_type: ModuleType;
  module_teaching_contact_hours: number;
  module_tutorial_contact_hours: number;
  adjusted_module_year: string;
  adjusted_module_term: ModuleTerm;
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

export interface ModuleCatalogBreakdownBucket {
  label: string;
  yearOrder: number;
  termOrder: number;
  count: number;
}

export function formatModuleBreakdownYearLabel(
  year: string | null | undefined
): string {
  const order = getModuleYearOrder(year);

  if (order >= 1 && order <= 9) {
    return `Y${order}`;
  }

  const text = normalizeText(year);

  return text || "Unspecified";
}

const MODULE_BREAKDOWN_TERMS: ModuleTerm[] = ["Sep", "Feb", "Jun"];

export function buildModuleCatalogBreakdown(
  rows: Array<{
    module_year: string | null | undefined;
    module_term: ModuleTerm | string | null | undefined;
  }>
) {
  const counts = new Map<string, ModuleCatalogBreakdownBucket>();
  let unclassified = 0;

  for (const row of rows) {
    const year = normalizeText(row.module_year);
    const term = normalizeText(row.module_term) as ModuleTerm;

    if (!year || !MODULE_BREAKDOWN_TERMS.includes(term)) {
      unclassified += 1;
      continue;
    }

    const label = `${formatModuleBreakdownYearLabel(year)} ${term}`;
    const existing = counts.get(label);

    if (existing) {
      existing.count += 1;
      continue;
    }

    counts.set(label, {
      label,
      yearOrder: getModuleYearOrder(year),
      termOrder: getModuleTermOrder(term),
      count: 1,
    });
  }

  const buckets = Array.from(counts.values()).sort((a, b) => {
    if (a.yearOrder !== b.yearOrder) {
      return a.yearOrder - b.yearOrder;
    }

    return a.termOrder - b.termOrder;
  });

  return {
    total: rows.length,
    buckets,
    unclassified,
  };
}

function isCommonStreamModule(streamCode: string | null | undefined) {
  const text = normalizeText(streamCode).toLowerCase();

  return text === "" || text === "nil";
}

export async function searchCourses(params: {
  academicYear: string;
  programmeCode?: string;
  streamCode?: string;
}) {
  let moduleQuery = supabase
    .from("modules")
    .select("*")
    .order("programme_code")
    .order("stream_code")
    .order("module_code");

  if (params.programmeCode) {
    moduleQuery = moduleQuery.eq("programme_code", params.programmeCode);
  }

  /**
   * Business rule:
   * Blank/null/"nil" module.stream_code means the module is offered to all
   * streams under the same programme.
   *
   * Therefore, do not filter stream_code at database query level.
   * We first load all modules under the selected programme, then filter below.
   */

  const [
    { data: modules, error: moduleError },
    { data: adjustments, error: adjError },
  ] = await Promise.all([
    moduleQuery,
    supabase
      .from("module_adjustments")
      .select("*")
      .eq("academic_year", params.academicYear),
  ]);

  if (moduleError) throw moduleError;
  if (adjError) throw adjError;

  const rawSelectedStream = normalizeText(params.streamCode);

  const selectedStream = rawSelectedStream
    ? normalizeStream(rawSelectedStream)
    : "";

  const filteredModules = ((modules ?? []) as ModuleRow[]).filter((module) => {
    /**
     * If no stream is selected, show all modules under the selected programme.
     */
    if (!selectedStream) {
      return true;
    }

    /**
     * Blank/null/"nil" stream_code means this module is common to all streams.
     */
    if (isCommonStreamModule(module.stream_code)) {
      return true;
    }

    const moduleStream = normalizeStream(module.stream_code);

    return moduleStream === selectedStream;
  });

  const adjustmentMap = new Map<string, ModuleAdjustmentRow>();

  for (const adjustment of (adjustments ?? []) as ModuleAdjustmentRow[]) {
    adjustmentMap.set(adjustment.module_id, adjustment);
  }

  const rows = filteredModules.map<CourseSearchRow>((module) => {
    const adjustment = adjustmentMap.get(module.id);

    return {
      module_id: module.id,
      programme_code: module.programme_code,
      stream_code: module.stream_code,
      module_code: module.module_code,
      module_name: module.module_name,
      uses_computer: normalizeUsesComputerFlag(module.uses_computer),
      module_type: normalizeModuleType(module.module_type),
      module_teaching_contact_hours: Number(
        module.module_teaching_contact_hours ?? 0
      ),
      module_tutorial_contact_hours: Number(
        module.module_tutorial_contact_hours ?? 0
      ),
      original_module_year: module.module_year,
      original_module_term: module.module_term,
      adjusted_module_year: adjustment?.adjusted_module_year ?? null,
      adjusted_module_term: adjustment?.adjusted_module_term ?? null,
      final_module_year: adjustment?.adjusted_module_year ?? module.module_year,
      final_module_term: adjustment?.adjusted_module_term ?? module.module_term,
    };
  });

  rows.sort((a, b) => {
    const yearDiff =
      getModuleYearOrder(a.final_module_year) -
      getModuleYearOrder(b.final_module_year);

    if (yearDiff !== 0) return yearDiff;

    const termDiff =
      getModuleTermOrder(a.final_module_term) -
      getModuleTermOrder(b.final_module_term);

    if (termDiff !== 0) return termDiff;

    return a.module_code.localeCompare(b.module_code);
  });

  return rows;
}

export async function saveModuleAdjustment(input: {
  moduleId: string;
  academicYear: string;
  adjustedModuleYear?: string | null;
  adjustedModuleTerm?: ModuleTerm | null;
  updatedBy: string;
}) {
  const { error } = await supabase.from("module_adjustments").upsert(
    {
      module_id: input.moduleId,
      academic_year: input.academicYear,
      adjusted_module_year: input.adjustedModuleYear || null,
      adjusted_module_term: input.adjustedModuleTerm || null,
      updated_by: input.updatedBy,
    },
    {
      onConflict: "module_id,academic_year",
    }
  );

  if (error) throw error;
}

export async function clearModuleAdjustment(params: {
  moduleId: string;
  academicYear: string;
}) {
  const { error } = await supabase
    .from("module_adjustments")
    .delete()
    .eq("module_id", params.moduleId)
    .eq("academic_year", params.academicYear);

  if (error) throw error;
}

export function buildCourseSearchDraft(row: CourseSearchRow): CourseSearchModuleDraft {
  return {
    module_id: row.module_id,
    module_code: row.module_code,
    programme_code: row.programme_code,
    stream_code: row.stream_code,
    module_name: row.module_name ?? "",
    module_year: row.original_module_year ?? "",
    module_term: row.original_module_term,
    uses_computer: row.uses_computer,
    module_type: row.module_type,
    module_teaching_contact_hours: row.module_teaching_contact_hours,
    module_tutorial_contact_hours: row.module_tutorial_contact_hours,
    adjusted_module_year: row.adjusted_module_year ?? "",
    adjusted_module_term: row.adjusted_module_term ?? row.original_module_term,
  };
}

export async function saveCourseSearchModule(params: {
  draft: CourseSearchModuleDraft;
  academicYear: string;
  updatedBy: string;
}) {
  const { draft, academicYear, updatedBy } = params;
  const streamCode = normalizeStream(draft.stream_code);

  const moduleInput: ModuleInput = {
    id: draft.module_id,
    module_code: draft.module_code,
    module_name: draft.module_name || null,
    module_year: draft.module_year || null,
    module_term: draft.module_term,
    programme_code: draft.programme_code,
    stream_code: streamCode,
    uses_computer: draft.uses_computer,
    module_type: draft.module_type,
    module_teaching_contact_hours: draft.module_teaching_contact_hours,
    module_tutorial_contact_hours: draft.module_tutorial_contact_hours,
  };

  await upsertModule(moduleInput);

  const adjustedYear = normalizeText(draft.adjusted_module_year);
  const catalogYear = normalizeText(draft.module_year);
  const hasYearOverride = Boolean(adjustedYear && adjustedYear !== catalogYear);
  const hasTermOverride = draft.adjusted_module_term !== draft.module_term;

  if (hasYearOverride || hasTermOverride) {
    await saveModuleAdjustment({
      moduleId: draft.module_id,
      academicYear,
      adjustedModuleYear: hasYearOverride ? adjustedYear : null,
      adjustedModuleTerm: hasTermOverride ? draft.adjusted_module_term : null,
      updatedBy,
    });
  } else {
    await clearModuleAdjustment({
      moduleId: draft.module_id,
      academicYear,
    });
  }
}

async function deleteModuleRelatedEnrollmentRows(module: {
  module_code: string;
  programme_code: string;
  stream_code: string;
  module_term: ModuleTerm;
}) {
  const streamCode = normalizeStream(module.stream_code);

  const { error } = await supabase
    .from("module_enrollment")
    .delete()
    .eq("module_code", module.module_code)
    .eq("programme_code", module.programme_code)
    .eq("stream_code", streamCode)
    .eq("module_term", module.module_term);

  if (error) throw error;
}

async function deleteModuleRelatedDefaultAssignments(module: {
  module_code: string;
  programme_code: string;
  stream_code: string;
  module_term: ModuleTerm;
}) {
  const streamCode = normalizeStream(module.stream_code);

  const { error } = await supabase
    .from("module_default_assignments")
    .delete()
    .eq("module_code", module.module_code)
    .eq("programme_code", module.programme_code)
    .eq("stream_code", streamCode)
    .eq("module_term", module.module_term);

  if (error) throw error;
}

/** Removes module master row and related enrollment / default-assignment rows. */
export async function deleteCourseSearchModule(row: CourseSearchRow) {
  await deleteModuleRelatedEnrollmentRows({
    module_code: row.module_code,
    programme_code: row.programme_code,
    stream_code: row.stream_code,
    module_term: row.original_module_term,
  });

  await deleteModuleRelatedDefaultAssignments({
    module_code: row.module_code,
    programme_code: row.programme_code,
    stream_code: row.stream_code,
    module_term: row.original_module_term,
  });

  await deleteModule(row.module_id);
}
