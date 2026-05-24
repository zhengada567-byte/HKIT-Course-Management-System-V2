import { supabase } from "../lib/supabase";
import { normalizeOptionalText, normalizeStream } from "../lib/utils";
import type { ProgrammeRow } from "../types";

export interface ProgrammeInput {
  id?: string;
  programme_type: string;
  programme_code: string;
  programme_name?: string | null;
  programme_stream?: string | null;
  stream_abbr?: string | null;
  programme_leader?: string | null;

  /**
   * Degree articulation rule.
   *
   * Recommended format:
   * HDBC:nil
   * HDBC:nil;HDAI:Artificial Intelligence
   */
  articulation?: string | null;
}

export async function listProgrammes() {
  const { data, error } = await supabase
    .from("programmes")
    .select("*")
    .order("programme_type")
    .order("programme_code")
    .order("programme_stream");

  if (error) throw error;

  return (data ?? []) as ProgrammeRow[];
}

export async function upsertProgramme(input: ProgrammeInput) {
  const payload = {
    programme_type: input.programme_type.trim(),
    programme_code: input.programme_code.trim(),
    programme_name: input.programme_name?.trim() || null,
    programme_stream: normalizeStream(input.programme_stream),
    stream_abbr: normalizeOptionalText(input.stream_abbr),
    programme_leader: input.programme_leader?.trim() || null,

    /**
     * Important:
     * This must be included in the actual Supabase upsert payload,
     * otherwise programmes.articulation will remain null.
     */
    articulation: normalizeOptionalText(input.articulation),
  };

  console.log("[ProgrammeService] Upserting programme:", payload);

  if (input.id) {
    const { data, error } = await supabase
      .from("programmes")
      .update(payload)
      .eq("id", input.id)
      .select()
      .single();

    if (error) throw error;

    return data as ProgrammeRow;
  }

  const { data, error } = await supabase
    .from("programmes")
    .upsert(payload, {
      onConflict: "programme_code,programme_stream",
    })
    .select()
    .single();

  if (error) throw error;

  return data as ProgrammeRow;
}

export async function deleteProgramme(id: string) {
  const { error } = await supabase.from("programmes").delete().eq("id", id);

  if (error) throw error;
}
