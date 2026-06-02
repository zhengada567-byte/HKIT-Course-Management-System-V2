import { supabase } from "../lib/supabase";
import { normalizeStream } from "../lib/utils";
import type { ModuleRow, ModuleTerm, ModuleUsesComputerFlag } from "../types";

export interface ModuleInput {
  id?: string;
  module_code: string;
  module_name?: string | null;
  module_year?: string | null;
  module_term: ModuleTerm;
  programme_code: string;
  stream_code?: string | null;
  uses_computer?: ModuleUsesComputerFlag | null;
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
  const payload = {
    module_code: input.module_code.trim(),
    module_name: input.module_name?.trim() || null,
    module_year: input.module_year?.trim() || null,
    module_term: input.module_term,
    programme_code: input.programme_code.trim(),
    stream_code: normalizeStream(input.stream_code),
    uses_computer: normalizeUsesComputerFlag(input.uses_computer),
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
