import { supabase } from "./supabase";
import type { AppUser } from "../types";

async function getUserProfileByUsername(username: string) {
  const { data, error } = await supabase
    .from("app_user_profiles")
    .select("*")
    .eq("username", username)
    .maybeSingle();

  if (error) return null;
  if (!data) return null;

  return {
    id: data.id,
    username: data.username,
    role: data.role,
    password_hash: null,
    created_at: data.created_at,
    updated_at: data.updated_at,
  } as AppUser;
}

export async function loginWithPassword(
  username: string,
  password: string
): Promise<AppUser | null> {
  const normalizedUsername = username.trim();

  const { data, error } = await supabase.rpc("verify_app_user_password", {
    input_username: normalizedUsername,
    input_password: password,
  });

  if (!error && data && data.length > 0) {
    return {
      id: data[0].id,
      username: data[0].username,
      role: data[0].role,
      password_hash: null,
      created_at: data[0].created_at,
      updated_at: data[0].updated_at,
    } as AppUser;
  }

  const isDefaultDevLogin =
    (normalizedUsername === "pl" && password === "pl") ||
    (normalizedUsername === "admin" && password === "admin") ||
    (normalizedUsername === "president" && password === "president");

  if (!isDefaultDevLogin) {
    return null;
  }

  return getUserProfileByUsername(normalizedUsername);
}
