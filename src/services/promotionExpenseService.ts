import { normalizeAcademicYear } from "../lib/utils";
import { supabase } from "../lib/supabase";

export const SOCIAL_MEDIA_MONTH_KEYS = [
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

export type SocialMediaMonthKey = (typeof SOCIAL_MEDIA_MONTH_KEYS)[number];

export type PromotionOccurrenceType = "brochure" | "exhibition" | "other";

export type SocialMediaCostRow = {
  id: string;
  academic_year: string;
  programme_code: string;
  month_key: SocialMediaMonthKey;
  amount: number;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkshopCostRow = {
  id: string;
  academic_year: string;
  programme_code: string;
  workshop_title: string;
  speaker_fee: number;
  promotion_fee: number;
  expense_date: string | null;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PromotionOccurrenceCostRow = {
  id: string;
  academic_year: string;
  programme_code: string;
  cost_type: PromotionOccurrenceType;
  title: string | null;
  amount: number;
  expense_date: string | null;
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

export async function listSocialMediaCosts(params: {
  academicYear: string;
  programmeCode?: string;
}) {
  const year = normalizeAcademicYear(params.academicYear);
  let query = supabase
    .from("programme_social_media_costs")
    .select("*")
    .eq("academic_year", year)
    .order("programme_code")
    .order("month_key");

  if (params.programmeCode) {
    query = query.eq(
      "programme_code",
      normalizeProgrammeCode(params.programmeCode)
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as SocialMediaCostRow[];
}

export async function upsertSocialMediaCost(params: {
  id?: string;
  academicYear: string;
  programmeCode: string;
  monthKey: SocialMediaMonthKey | string;
  amount: number | string;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const monthKey = String(params.monthKey ?? "").trim() as SocialMediaMonthKey;
  if (!SOCIAL_MEDIA_MONTH_KEYS.includes(monthKey)) {
    throw new Error("Month must be Sep–Aug within the academic year.");
  }

  const payload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    programme_code: normalizeProgrammeCode(params.programmeCode),
    month_key: monthKey,
    amount: parseAmount(params.amount),
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  if (params.id) {
    const { data, error } = await supabase
      .from("programme_social_media_costs")
      .update(payload)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as SocialMediaCostRow;
  }

  const { data, error } = await supabase
    .from("programme_social_media_costs")
    .upsert(payload, {
      onConflict: "academic_year,programme_code,month_key",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as SocialMediaCostRow;
}

export async function deleteSocialMediaCost(id: string) {
  const { error } = await supabase
    .from("programme_social_media_costs")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function listWorkshopCosts(params: {
  academicYear: string;
  programmeCode?: string;
}) {
  const year = normalizeAcademicYear(params.academicYear);
  let query = supabase
    .from("programme_workshop_costs")
    .select("*")
    .eq("academic_year", year)
    .order("expense_date", { ascending: false, nullsFirst: false })
    .order("workshop_title");

  if (params.programmeCode) {
    query = query.eq(
      "programme_code",
      normalizeProgrammeCode(params.programmeCode)
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as WorkshopCostRow[];
}

export async function upsertWorkshopCost(params: {
  id?: string;
  academicYear: string;
  programmeCode: string;
  workshopTitle: string;
  speakerFee: number | string;
  promotionFee: number | string;
  expenseDate?: string | null;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const workshopTitle = String(params.workshopTitle ?? "").trim();
  if (!workshopTitle) throw new Error("Workshop title is required.");

  const payload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    programme_code: normalizeProgrammeCode(params.programmeCode),
    workshop_title: workshopTitle,
    speaker_fee: parseAmount(params.speakerFee, "Speaker fee"),
    promotion_fee: parseAmount(params.promotionFee, "Promotion fee"),
    expense_date: String(params.expenseDate ?? "").trim() || null,
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  if (params.id) {
    const { data, error } = await supabase
      .from("programme_workshop_costs")
      .update(payload)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as WorkshopCostRow;
  }

  const { data, error } = await supabase
    .from("programme_workshop_costs")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return data as WorkshopCostRow;
}

export async function deleteWorkshopCost(id: string) {
  const { error } = await supabase
    .from("programme_workshop_costs")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function listPromotionOccurrenceCosts(params: {
  academicYear: string;
  programmeCode?: string;
  costType?: PromotionOccurrenceType;
}) {
  const year = normalizeAcademicYear(params.academicYear);
  let query = supabase
    .from("programme_promotion_occurrence_costs")
    .select("*")
    .eq("academic_year", year)
    .order("expense_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (params.programmeCode) {
    query = query.eq(
      "programme_code",
      normalizeProgrammeCode(params.programmeCode)
    );
  }

  if (params.costType) {
    query = query.eq("cost_type", params.costType);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as PromotionOccurrenceCostRow[];
}

export async function upsertPromotionOccurrenceCost(params: {
  id?: string;
  academicYear: string;
  programmeCode: string;
  costType: PromotionOccurrenceType;
  title?: string | null;
  amount: number | string;
  expenseDate?: string | null;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  if (!["brochure", "exhibition", "other"].includes(params.costType)) {
    throw new Error("Invalid promotion cost type.");
  }

  const payload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    programme_code: normalizeProgrammeCode(params.programmeCode),
    cost_type: params.costType,
    title: String(params.title ?? "").trim() || null,
    amount: parseAmount(params.amount),
    expense_date: String(params.expenseDate ?? "").trim() || null,
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  if (params.id) {
    const { data, error } = await supabase
      .from("programme_promotion_occurrence_costs")
      .update(payload)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as PromotionOccurrenceCostRow;
  }

  const { data, error } = await supabase
    .from("programme_promotion_occurrence_costs")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return data as PromotionOccurrenceCostRow;
}

export async function deletePromotionOccurrenceCost(id: string) {
  const { error } = await supabase
    .from("programme_promotion_occurrence_costs")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
