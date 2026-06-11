import { supabase } from "../lib/supabase";
import { filterActivePlanningModules } from "../lib/timetablePlanningOffering";
import type { ModuleTerm, TimetablePlanningModuleRow } from "../types";
import { createManualCombineGroup } from "./manualCombineService";

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function normalizeCodePart(value: string | null | undefined) {
  return normalizeText(value)
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toUpperCase();
}

function normalizeStreamKey(value: string | null | undefined) {
  const text = normalizeText(value).toLowerCase();

  return text === "" ? "nil" : text;
}

function isCommonStream(streamCode: string | null | undefined) {
  const text = normalizeStreamKey(streamCode);

  return text === "nil";
}

export interface ProgrammeIntraStreamCombineCandidate {
  academic_year: string;
  programme_code: string;
  module_code: string;
  module_term: string;
  combined_code: string;
  modules: TimetablePlanningModuleRow[];
}

function buildDetectionKey(row: TimetablePlanningModuleRow) {
  return [
    row.academic_year,
    normalizeCodePart(row.programme_code),
    normalizeCodePart(row.module_code),
    normalizeCodePart(row.module_term),
  ].join("|");
}

/**
 * Same programme + same module_code + same term + 2+ distinct streams (per-stream rows only).
 */
export function detectProgrammeIntraStreamCombineCandidates(
  planningModules: TimetablePlanningModuleRow[]
) {
  const map = new Map<string, TimetablePlanningModuleRow[]>();

  for (const module of planningModules) {
    if (isCommonStream(module.stream_code)) {
      continue;
    }

    if (module.manual_combine_group_id) {
      continue;
    }

    const key = buildDetectionKey(module);
    const bucket = map.get(key) ?? [];
    bucket.push(module);
    map.set(key, bucket);
  }

  const candidates: ProgrammeIntraStreamCombineCandidate[] = [];

  for (const modules of map.values()) {
    const distinctStreams = new Set(
      modules.map((module) => normalizeStreamKey(module.stream_code))
    );

    if (distinctStreams.size < 2 || modules.length < 2) {
      continue;
    }

    const first = modules[0];

    candidates.push({
      academic_year: first.academic_year,
      programme_code: first.programme_code,
      module_code: first.module_code,
      module_term: first.module_term,
      combined_code: normalizeCodePart(first.module_code),
      modules,
    });
  }

  return candidates.sort((a, b) =>
    a.combined_code.localeCompare(b.combined_code)
  );
}

export interface ApplyProgrammeIntraStreamAutoCombineResult {
  appliedCount: number;
}

export async function applyProgrammeIntraStreamAutoCombine(params: {
  academicYear: string;
  programmeCode: string;
  moduleTerm?: ModuleTerm;
  createdBy: string;
}): Promise<ApplyProgrammeIntraStreamAutoCombineResult> {
  const programmeCode = normalizeText(params.programmeCode);

  if (!programmeCode) {
    return { appliedCount: 0 };
  }

  let query = supabase
    .from("timetable_planning_modules")
    .select("*")
    .eq("academic_year", params.academicYear)
    .eq("programme_code", programmeCode);

  if (params.moduleTerm) {
    query = query.eq("module_term", params.moduleTerm);
  }

  const { data, error } = await query;

  if (error) throw error;

  const planningModules = filterActivePlanningModules(
    (data ?? []) as TimetablePlanningModuleRow[]
  );
  const candidates = detectProgrammeIntraStreamCombineCandidates(planningModules);

  let appliedCount = 0;

  for (const candidate of candidates) {
    await createManualCombineGroup({
      selectedModules: candidate.modules,
      createdBy: params.createdBy,
      combinedCodeBase: candidate.module_code,
    });

    appliedCount += 1;
  }

  return { appliedCount };
}
