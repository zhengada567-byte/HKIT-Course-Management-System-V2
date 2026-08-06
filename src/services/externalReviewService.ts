import { normalizeAcademicYear } from "../lib/utils";
import { supabase } from "../lib/supabase";
import type { ModuleTerm } from "../types";

export const EXTERNAL_REVIEW_ROLE_TYPES = [
  "external_examiner",
  "external_advisor",
  "class_visit",
] as const;

export type ExternalReviewRoleType =
  (typeof EXTERNAL_REVIEW_ROLE_TYPES)[number];

export type ExternalReviewDefaultRateRow = {
  id: string;
  role_type: ExternalReviewRoleType;
  amount_per_module: number;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ExternalReviewModuleRow = {
  id: string;
  engagement_id: string;
  module_name: string;
  amount: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ExternalReviewEngagementRow = {
  id: string;
  academic_year: string;
  module_term: ModuleTerm;
  programme_code: string;
  role_type: ExternalReviewRoleType;
  person_name: string;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  modules?: ExternalReviewModuleRow[];
};

export type ExternalReviewModuleInput = {
  moduleName: string;
  amount: number | string;
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

function normalizeRoleType(value: string): ExternalReviewRoleType {
  const role = String(value ?? "").trim() as ExternalReviewRoleType;
  if (!EXTERNAL_REVIEW_ROLE_TYPES.includes(role)) {
    throw new Error("Invalid external review role type.");
  }
  return role;
}

function parseAmount(value: number | string, field = "Amount") {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }
  return Math.round(n * 100) / 100;
}

export function engagementModulesTotal(
  modules: Array<{ amount: number | string }>
) {
  return Math.round(
    modules.reduce((sum, row) => sum + (Number(row.amount) || 0), 0) * 100
  ) / 100;
}

export async function listExternalReviewDefaultRates() {
  const { data, error } = await supabase
    .from("external_review_default_rates")
    .select("*")
    .order("role_type");

  if (error) throw error;
  return (data ?? []) as ExternalReviewDefaultRateRow[];
}

export async function upsertExternalReviewDefaultRate(params: {
  roleType: ExternalReviewRoleType;
  amountPerModule: number | string;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const payload = {
    role_type: normalizeRoleType(params.roleType),
    amount_per_module: parseAmount(
      params.amountPerModule,
      "Default amount per module"
    ),
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("external_review_default_rates")
    .upsert(payload, { onConflict: "role_type" })
    .select("*")
    .single();

  if (error) throw error;
  return data as ExternalReviewDefaultRateRow;
}

export async function listExternalReviewEngagements(params: {
  academicYear: string;
  moduleTerm?: ModuleTerm | string;
  programmeCode?: string;
  roleType?: ExternalReviewRoleType;
}) {
  const year = normalizeAcademicYear(params.academicYear);
  let query = supabase
    .from("external_review_engagements")
    .select("*")
    .eq("academic_year", year)
    .order("programme_code")
    .order("role_type")
    .order("person_name");

  if (params.moduleTerm) {
    query = query.eq("module_term", normalizeModuleTerm(String(params.moduleTerm)));
  }
  if (params.programmeCode) {
    query = query.eq(
      "programme_code",
      normalizeProgrammeCode(params.programmeCode)
    );
  }
  if (params.roleType) {
    query = query.eq("role_type", normalizeRoleType(params.roleType));
  }

  const { data, error } = await query;
  if (error) throw error;

  const engagements = (data ?? []) as ExternalReviewEngagementRow[];
  if (engagements.length === 0) return [];

  const ids = engagements.map((row) => row.id);
  const { data: modules, error: moduleError } = await supabase
    .from("external_review_modules")
    .select("*")
    .in("engagement_id", ids)
    .order("sort_order");

  if (moduleError) throw moduleError;

  const byEngagement = new Map<string, ExternalReviewModuleRow[]>();
  for (const row of (modules ?? []) as ExternalReviewModuleRow[]) {
    const list = byEngagement.get(row.engagement_id) ?? [];
    list.push(row);
    byEngagement.set(row.engagement_id, list);
  }

  return engagements.map((row) => ({
    ...row,
    modules: byEngagement.get(row.id) ?? [],
  }));
}

export async function upsertExternalReviewEngagement(params: {
  id?: string;
  academicYear: string;
  moduleTerm: ModuleTerm | string;
  programmeCode: string;
  roleType: ExternalReviewRoleType;
  personName: string;
  modules: ExternalReviewModuleInput[];
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const personName = String(params.personName ?? "").trim();
  if (!personName) throw new Error("Person name is required.");

  const cleanedModules = params.modules
    .map((row, index) => ({
      module_name: String(row.moduleName ?? "").trim(),
      amount: parseAmount(row.amount || "0", "Module amount"),
      sort_order: index,
    }))
    .filter((row) => row.module_name.length > 0);

  if (cleanedModules.length === 0) {
    throw new Error("Add at least one module.");
  }

  const engagementPayload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    module_term: normalizeModuleTerm(String(params.moduleTerm)),
    programme_code: normalizeProgrammeCode(params.programmeCode),
    role_type: normalizeRoleType(params.roleType),
    person_name: personName,
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  let engagementId = params.id ?? "";

  if (engagementId) {
    const { data, error } = await supabase
      .from("external_review_engagements")
      .update(engagementPayload)
      .eq("id", engagementId)
      .select("*")
      .single();
    if (error) throw error;
    engagementId = (data as ExternalReviewEngagementRow).id;

    const { error: deleteError } = await supabase
      .from("external_review_modules")
      .delete()
      .eq("engagement_id", engagementId);
    if (deleteError) throw deleteError;
  } else {
    const { data, error } = await supabase
      .from("external_review_engagements")
      .insert(engagementPayload)
      .select("*")
      .single();
    if (error) throw error;
    engagementId = (data as ExternalReviewEngagementRow).id;
  }

  const modulePayload = cleanedModules.map((row) => ({
    engagement_id: engagementId,
    module_name: row.module_name,
    amount: row.amount,
    sort_order: row.sort_order,
    updated_at: new Date().toISOString(),
  }));

  const { data: modules, error: moduleError } = await supabase
    .from("external_review_modules")
    .insert(modulePayload)
    .select("*");

  if (moduleError) throw moduleError;

  return {
    ...(engagementPayload as unknown as ExternalReviewEngagementRow),
    id: engagementId,
    modules: (modules ?? []) as ExternalReviewModuleRow[],
  };
}

export async function deleteExternalReviewEngagement(id: string) {
  const { error } = await supabase
    .from("external_review_engagements")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
