import { normalizeAcademicYear } from "../lib/utils";
import { supabase } from "../lib/supabase";

export const FT_STAFF_MONTH_KEYS = [
  "Sep",
  "Oct",
  "Nov",
  "Dec",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
] as const;

export type FtStaffMonthKey = (typeof FT_STAFF_MONTH_KEYS)[number];

export type FtStaffCostRow = {
  id: string;
  academic_year: string;
  programme_code: string;
  month_key: FtStaffMonthKey;
  total_cost: number;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

function parseAmount(value: number | string, field = "Amount") {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }
  return Math.round(n * 100) / 100;
}

function normalizeProgrammeCode(value: string) {
  const code = String(value ?? "").trim().toUpperCase();
  if (!code) throw new Error("Programme code is required.");
  return code;
}

export async function listFtStaffCosts(params: {
  academicYear: string;
  programmeCode?: string;
}) {
  const year = normalizeAcademicYear(params.academicYear);
  let query = supabase
    .from("programme_ft_staff_costs")
    .select("*")
    .eq("academic_year", year)
    .order("programme_code");

  if (params.programmeCode) {
    query = query.eq(
      "programme_code",
      normalizeProgrammeCode(params.programmeCode)
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FtStaffCostRow[];
}

export async function upsertFtStaffCost(params: {
  id?: string;
  academicYear: string;
  programmeCode: string;
  monthKey: FtStaffMonthKey | string;
  totalCost: number | string;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const monthKey = String(params.monthKey ?? "").trim() as FtStaffMonthKey;
  if (!FT_STAFF_MONTH_KEYS.includes(monthKey)) {
    throw new Error("Month must be Sep–Aug within the academic year.");
  }

  const payload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    programme_code: normalizeProgrammeCode(params.programmeCode),
    month_key: monthKey,
    total_cost: parseAmount(params.totalCost, "Total cost"),
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  if (params.id) {
    const { data, error } = await supabase
      .from("programme_ft_staff_costs")
      .update(payload)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as FtStaffCostRow;
  }

  const { data, error } = await supabase
    .from("programme_ft_staff_costs")
    .upsert(payload, {
      onConflict: "academic_year,programme_code,month_key",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as FtStaffCostRow;
}

export async function deleteFtStaffCost(id: string) {
  const { error } = await supabase
    .from("programme_ft_staff_costs")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
