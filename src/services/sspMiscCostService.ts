import { normalizeAcademicYear } from "../lib/utils";
import { supabase } from "../lib/supabase";
import type { ModuleTerm } from "../types";

export const SSP_MISC_CATEGORY_KEYS = [
  "govt_rent_rate",
  "waste_disposal",
  "repair_maintenance",
  "lift_maintenance",
  "fire_alarm_transmission",
  "electricity_charges",
  "water",
] as const;

export type SspMiscCategoryKey = (typeof SSP_MISC_CATEGORY_KEYS)[number];

export const SSP_MISC_CATEGORY_LABELS: Record<SspMiscCategoryKey, string> = {
  govt_rent_rate: "SSP - Gov't Rent & Rate",
  waste_disposal: "SSP - Waste Disposal",
  repair_maintenance: "SSP - Repair & Maintenance",
  lift_maintenance: "SSP - Lift Maintenance",
  fire_alarm_transmission: "SSP - Fire Alarm Transmission",
  electricity_charges: "SSP - Electricity Charges",
  water: "SSP - Water",
};

export type ProgrammeSspMiscCostRow = {
  id: string;
  academic_year: string;
  programme_code: string;
  module_term: ModuleTerm;
  category_key: SspMiscCategoryKey;
  amount: number;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

function normalizeProgrammeCode(value: string) {
  const code = String(value ?? "").trim().toUpperCase();
  if (!code) throw new Error("Programme code is required.");
  return code;
}

function normalizeModuleTerm(value: string): ModuleTerm {
  const term = String(value ?? "").trim();
  if (term === "Sep" || term === "Feb" || term === "Jun") return term;
  throw new Error("Term must be Sep, Feb, or Jun.");
}

function normalizeCategoryKey(value: string): SspMiscCategoryKey {
  const key = String(value ?? "").trim() as SspMiscCategoryKey;
  if (!SSP_MISC_CATEGORY_KEYS.includes(key)) {
    throw new Error("Invalid SSP misc category.");
  }
  return key;
}

function parseAmount(value: number | string, field = "Amount") {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }
  return Math.round(n * 100) / 100;
}

export async function listProgrammeSspMiscCosts(params: {
  academicYear: string;
  moduleTerm?: ModuleTerm | string;
  programmeCode?: string;
}) {
  const year = normalizeAcademicYear(params.academicYear);
  let query = supabase
    .from("programme_ssp_misc_costs")
    .select("*")
    .eq("academic_year", year)
    .order("programme_code")
    .order("category_key");

  if (params.moduleTerm) {
    query = query.eq(
      "module_term",
      normalizeModuleTerm(String(params.moduleTerm))
    );
  }
  if (params.programmeCode) {
    query = query.eq(
      "programme_code",
      normalizeProgrammeCode(params.programmeCode)
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProgrammeSspMiscCostRow[];
}

export async function upsertProgrammeSspMiscCost(params: {
  academicYear: string;
  programmeCode: string;
  moduleTerm: ModuleTerm | string;
  categoryKey: SspMiscCategoryKey;
  amount: number | string;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const payload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    programme_code: normalizeProgrammeCode(params.programmeCode),
    module_term: normalizeModuleTerm(String(params.moduleTerm)),
    category_key: normalizeCategoryKey(params.categoryKey),
    amount: parseAmount(params.amount, "SSP misc amount"),
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("programme_ssp_misc_costs")
    .upsert(payload, {
      onConflict: "academic_year,programme_code,module_term,category_key",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as ProgrammeSspMiscCostRow;
}

export async function upsertProgrammeSspMiscCostsBatch(params: {
  academicYear: string;
  programmeCode: string;
  moduleTerm: ModuleTerm | string;
  amounts: Partial<Record<SspMiscCategoryKey, number | string>>;
  updatedBy?: string | null;
}) {
  const results: ProgrammeSspMiscCostRow[] = [];
  for (const key of SSP_MISC_CATEGORY_KEYS) {
    const amount = params.amounts[key] ?? "0";
    results.push(
      await upsertProgrammeSspMiscCost({
        academicYear: params.academicYear,
        programmeCode: params.programmeCode,
        moduleTerm: params.moduleTerm,
        categoryKey: key,
        amount: amount === "" ? "0" : amount,
        updatedBy: params.updatedBy,
      })
    );
  }
  return results;
}
