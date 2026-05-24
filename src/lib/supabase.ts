import { createClient } from "@supabase/supabase-js";

const env =
  typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env
    : process.env;

const supabaseUrl =
  (env.VITE_SUPABASE_URL as string | undefined) ?? process.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  (env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error("Missing VITE_SUPABASE_URL");
}

if (!supabaseAnonKey) {
  throw new Error("Missing VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
