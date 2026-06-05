import {
  normalizeModuleContactHours,
  normalizeModuleTutorialContactHours,
  resolveDefaultModuleTeachingTutorialHours,
  type ModuleTeachingTutorialHours,
} from "../lib/moduleContactHours";
import { normalizeProgrammeYear } from "../lib/programmeYear";
import { supabase } from "../lib/supabase";
import { normalizeStream } from "../lib/utils";
import { getProgrammeTypeByCode } from "./studyPlanService";
import type {
  ModuleRow,
  ModuleTerm,
  ModuleType,
  ModuleUsesComputerFlag,
} from "../types";

export interface ModuleInput {
  id?: string;
  module_code: string;
  module_name?: string | null;
  module_year?: string | null;
  module_term: ModuleTerm;
  programme_code: string;
  stream_code?: string | null;
  uses_computer?: ModuleUsesComputerFlag | null;
  module_type?: ModuleType | null;
  module_teaching_contact_hours?: number | null;
  module_tutorial_contact_hours?: number | null;
}

export async function resolveModuleTeachingTutorialHoursForUpsert(
  input: ModuleInput
): Promise<ModuleTeachingTutorialHours> {
  const teachingExplicit = normalizeModuleContactHours(
    input.module_teaching_contact_hours
  );
  const tutorialExplicit = normalizeModuleTutorialContactHours(
    input.module_tutorial_contact_hours
  );

  if (teachingExplicit !== null && tutorialExplicit !== null) {
    return {
      module_teaching_contact_hours: teachingExplicit,
      module_tutorial_contact_hours: tutorialExplicit,
    };
  }

  const programmeType = await getProgrammeTypeByCode(input.programme_code);
  const defaults = resolveDefaultModuleTeachingTutorialHours({
    programmeCode: input.programme_code,
    programmeType,
    moduleCode: input.module_code,
  });

  return {
    module_teaching_contact_hours:
      teachingExplicit ?? defaults.module_teaching_contact_hours,
    module_tutorial_contact_hours:
      tutorialExplicit ?? defaults.module_tutorial_contact_hours,
  };
}

export function normalizeModuleType(
  value: string | null | undefined
): ModuleType {
  const text = String(value ?? "").trim().toLowerCase();

  if (
    text === "optional" ||
    text === "opt" ||
    text === "elective" ||
    text === "選修"
  ) {
    return "optional";
  }

  return "core";
}

export function normalizeUsesComputerFlag(
  value: string | null | undefined
): ModuleUsesComputerFlag {
  const text = String(value ?? "")
    .trim()
    .toUpperCase();

  if (text === "Y" || text === "YES" || text === "TRUE" || text === "1") {
    return "Y";
  }

  return "N";
}

export function buildModuleCatalogKey(
  programmeCode: string,
  moduleCode: string
) {
  return `${String(programmeCode ?? "")
    .trim()
    .toUpperCase()}|${String(moduleCode ?? "")
    .trim()
    .toUpperCase()}`;
}

export async function listModules(filters?: {
  programme_code?: string;
  stream_code?: string;
}) {
  let query = supabase
    .from("modules")
    .select("*")
    .order("programme_code")
    .order("stream_code")
    .order("module_code")
    .order("module_term");

  if (filters?.programme_code) {
    query = query.eq("programme_code", filters.programme_code);
  }

  if (filters?.stream_code) {
    query = query.eq("stream_code", normalizeStream(filters.stream_code));
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []) as ModuleRow[];
}

/** programme|module_code → uses_computer (last row wins if duplicates). */
export async function loadModuleUsesComputerMap() {
  const { data, error } = await supabase
    .from("modules")
    .select("programme_code, module_code, uses_computer");

  if (error) throw error;

  const map = new Map<string, ModuleUsesComputerFlag>();

  for (const row of data ?? []) {
    const key = buildModuleCatalogKey(row.programme_code, row.module_code);
    map.set(key, normalizeUsesComputerFlag(row.uses_computer));
  }

  return map;
}

export async function upsertModule(input: ModuleInput) {
  const contactHours = await resolveModuleTeachingTutorialHoursForUpsert(input);

  const payload = {
    module_code: input.module_code.trim(),
    module_name: input.module_name?.trim() || null,
    module_year: normalizeProgrammeYear(input.module_year) ?? null,
    module_term: input.module_term,
    programme_code: input.programme_code.trim(),
    stream_code: normalizeStream(input.stream_code),
    uses_computer: normalizeUsesComputerFlag(input.uses_computer),
    module_type: normalizeModuleType(input.module_type),
    module_teaching_contact_hours: contactHours.module_teaching_contact_hours,
    module_tutorial_contact_hours: contactHours.module_tutorial_contact_hours,
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("modules")
      .update(payload)
      .eq("id", input.id)
      .select()
      .single();

    if (error) throw error;

    return data as ModuleRow;
  }

  const { data, error } = await supabase
    .from("modules")
    .upsert(payload, {
      onConflict: "module_code,programme_code,stream_code",
    })
    .select()
    .single();

  if (error) throw error;

  return data as ModuleRow;
}

export async function deleteModule(id: string) {
  const { error } = await supabase.from("modules").delete().eq("id", id);

  if (error) throw error;
}
