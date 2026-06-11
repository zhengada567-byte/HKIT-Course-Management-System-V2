import { normalizeProgrammeYear } from "../lib/programmeYear";
import { supabase } from "../lib/supabase";
import { assertFeatureUpdatesAllowed } from "./featureLockService";
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
  module_year: string | null;
  module_term: ModuleTerm;
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
  academicYear?: string;
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

  const { data: modules, error: moduleError } = await moduleQuery;

  if (moduleError) throw moduleError;

  const rawSelectedStream = normalizeText(params.streamCode);

  const selectedStream = rawSelectedStream
    ? normalizeStream(rawSelectedStream)
    : "";

  const filteredModules = ((modules ?? []) as ModuleRow[]).filter((module) => {
    if (!selectedStream) {
      return true;
    }

    if (isCommonStreamModule(module.stream_code)) {
      return true;
    }

    const moduleStream = normalizeStream(module.stream_code);

    return moduleStream === selectedStream;
  });

  const rows = filteredModules.map<CourseSearchRow>((module) => ({
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
    module_year: normalizeProgrammeYear(module.module_year),
    module_term: module.module_term,
  }));

  rows.sort((a, b) => {
    const yearDiff =
      getModuleYearOrder(a.module_year) - getModuleYearOrder(b.module_year);

    if (yearDiff !== 0) return yearDiff;

    const termDiff =
      getModuleTermOrder(a.module_term) - getModuleTermOrder(b.module_term);

    if (termDiff !== 0) return termDiff;

    return a.module_code.localeCompare(b.module_code);
  });

  return rows;
}

export function buildCourseSearchDraft(row: CourseSearchRow): CourseSearchModuleDraft {
  return {
    module_id: row.module_id,
    module_code: row.module_code,
    programme_code: row.programme_code,
    stream_code: row.stream_code,
    module_name: row.module_name ?? "",
    module_year: row.module_year ?? "",
    module_term: row.module_term,
    uses_computer: row.uses_computer,
    module_type: row.module_type,
    module_teaching_contact_hours: row.module_teaching_contact_hours,
    module_tutorial_contact_hours: row.module_tutorial_contact_hours,
  };
}

export async function saveCourseSearchModule(params: {
  draft: CourseSearchModuleDraft;
}) {
  await assertFeatureUpdatesAllowed("courseSearch");

  const { draft } = params;
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
  await assertFeatureUpdatesAllowed("courseSearch");

  await deleteModuleRelatedEnrollmentRows({
    module_code: row.module_code,
    programme_code: row.programme_code,
    stream_code: row.stream_code,
    module_term: row.module_term,
  });

  await deleteModuleRelatedDefaultAssignments({
    module_code: row.module_code,
    programme_code: row.programme_code,
    stream_code: row.stream_code,
    module_term: row.module_term,
  });

  await deleteModule(row.module_id);
}
