import { supabase } from "../lib/supabase";
import { normalizeStream } from "../lib/utils";
import type { ModuleRow, ModuleTerm } from "../types";

export interface ModuleInput {
  module_code: string;
  module_name?: string | null;
  module_year?: string | null;
  module_term: ModuleTerm;
  programme_code: string;
  stream_code?: string | null;
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

export async function upsertModule(input: ModuleInput) {
  const payload = {
    module_code: input.module_code.trim(),
    module_name: input.module_name?.trim() || null,
    module_year: input.module_year?.trim() || null,
    module_term: input.module_term,
    programme_code: input.programme_code.trim(),
    stream_code: normalizeStream(input.stream_code),
  };

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
