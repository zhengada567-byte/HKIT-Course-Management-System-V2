import { supabase } from "../lib/supabase";
import {
  getModuleTermOrder,
  getModuleYearOrder,
  normalizeStream,
} from "../lib/utils";
import type { ModuleAdjustmentRow, ModuleRow, ModuleTerm } from "../types";

export interface CourseSearchRow {
  module_id: string;
  programme_code: string;
  stream_code: string;
  module_code: string;
  module_name: string | null;
  original_module_year: string | null;
  original_module_term: ModuleTerm;
  adjusted_module_year: string | null;
  adjusted_module_term: ModuleTerm | null;
  final_module_year: string | null;
  final_module_term: ModuleTerm;
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
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
