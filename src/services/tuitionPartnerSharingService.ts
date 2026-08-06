import { isDegreeProgrammeType } from "../pages/programme-leader/make-study-plan/helpers";
import { normalizeAcademicYear, offeredTermToStudyTerm } from "../lib/utils";
import { supabase } from "../lib/supabase";
import type { ModuleTerm } from "../types";

export type TuitionIncomeRow = {
  id: string;
  academic_year: string;
  programme_code: string;
  module_term: ModuleTerm;
  amount: number;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PartnerSharingFeeRow = {
  id: string;
  academic_year: string;
  programme_code: string;
  fee_per_student: number;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Partner U individual fee is shared by programme-code prefix groups. */
export type PartnerUFeeGroupKey = "UWL" | "WU";

export const PARTNER_U_FEE_GROUPS: Array<{
  key: PartnerUFeeGroupKey;
  /** Prefix matched against programme_code (UWL checked before WU). */
  prefix: string;
}> = [
  { key: "UWL", prefix: "UWL" },
  { key: "WU", prefix: "WU" },
];

/**
 * UWL* → UWL group fee; WU* → WU group fee.
 * Check UWL before WU so codes like UWLCS never match WU.
 */
export function resolvePartnerUFeeGroup(
  programmeCode: string
): PartnerUFeeGroupKey | null {
  const code = String(programmeCode ?? "").trim().toUpperCase();
  if (!code) return null;
  if (code.startsWith("UWL")) return "UWL";
  if (code.startsWith("WU")) return "WU";
  return null;
}

export function partnerUFeeStorageCode(
  programmeOrGroup: string
): string {
  const code = normalizeProgrammeCode(programmeOrGroup);
  if (code === "UWL" || code === "WU") return code;
  return resolvePartnerUFeeGroup(code) ?? code;
}

export type PartnerSharingRecordRow = {
  id: string;
  academic_year: string;
  programme_code: string;
  module_term: ModuleTerm;
  study_term: string | null;
  ft_student_count: number;
  fee_per_student: number;
  total_sharing_fee: number;
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

function normalizeModuleTerm(value: string): ModuleTerm {
  const term = String(value ?? "").trim();
  if (term === "Sep" || term === "Feb" || term === "Jun") return term;
  throw new Error("Term must be Sep, Feb, or Jun.");
}

export async function listTuitionIncome(academicYear: string) {
  const year = normalizeAcademicYear(academicYear);
  const { data, error } = await supabase
    .from("tuition_income")
    .select("*")
    .eq("academic_year", year)
    .order("programme_code")
    .order("module_term");

  if (error) throw error;
  return (data ?? []) as TuitionIncomeRow[];
}

export async function upsertTuitionIncome(params: {
  id?: string;
  academicYear: string;
  programmeCode: string;
  moduleTerm: ModuleTerm | string;
  amount: number | string;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const payload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    programme_code: normalizeProgrammeCode(params.programmeCode),
    module_term: normalizeModuleTerm(String(params.moduleTerm)),
    amount: parseAmount(params.amount),
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  if (params.id) {
    const { data, error } = await supabase
      .from("tuition_income")
      .update(payload)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as TuitionIncomeRow;
  }

  const { data, error } = await supabase
    .from("tuition_income")
    .upsert(payload, {
      onConflict: "academic_year,programme_code,module_term",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as TuitionIncomeRow;
}

export async function deleteTuitionIncome(id: string) {
  const { error } = await supabase.from("tuition_income").delete().eq("id", id);
  if (error) throw error;
}

export async function getPartnerSharingFee(params: {
  academicYear: string;
  programmeCode: string;
}) {
  const year = normalizeAcademicYear(params.academicYear);
  const programmeCode = partnerUFeeStorageCode(params.programmeCode);

  const { data, error } = await supabase
    .from("partner_sharing_fees")
    .select("*")
    .eq("academic_year", year)
    .eq("programme_code", programmeCode)
    .maybeSingle();

  if (error) throw error;
  return (data as PartnerSharingFeeRow | null) ?? null;
}

export async function listPartnerSharingFees(academicYear: string) {
  const year = normalizeAcademicYear(academicYear);
  const { data, error } = await supabase
    .from("partner_sharing_fees")
    .select("*")
    .eq("academic_year", year)
    .order("programme_code");

  if (error) throw error;
  return (data ?? []) as PartnerSharingFeeRow[];
}

export async function upsertPartnerSharingFee(params: {
  academicYear: string;
  programmeCode: string;
  feePerStudent: number | string;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const payload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    programme_code: partnerUFeeStorageCode(params.programmeCode),
    fee_per_student: parseAmount(params.feePerStudent, "Fee per student"),
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("partner_sharing_fees")
    .upsert(payload, { onConflict: "academic_year,programme_code" })
    .select("*")
    .single();

  if (error) throw error;
  return data as PartnerSharingFeeRow;
}

export async function listPartnerSharingRecords(academicYear: string) {
  const year = normalizeAcademicYear(academicYear);
  const { data, error } = await supabase
    .from("partner_sharing_records")
    .select("*")
    .eq("academic_year", year)
    .order("programme_code")
    .order("module_term");

  if (error) throw error;
  return (data ?? []) as PartnerSharingRecordRow[];
}

export async function upsertPartnerSharingRecord(params: {
  id?: string;
  academicYear: string;
  programmeCode: string;
  moduleTerm: ModuleTerm | string;
  studyTerm?: string | null;
  ftStudentCount: number | string;
  feePerStudent: number | string;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const feePerStudent = parseAmount(params.feePerStudent, "Fee per student");
  const ftStudentCount = Math.max(
    0,
    Math.round(Number(params.ftStudentCount) || 0)
  );
  const moduleTerm = normalizeModuleTerm(String(params.moduleTerm));
  const academicYear = normalizeAcademicYear(params.academicYear);
  const studyTerm =
    String(params.studyTerm ?? "").trim() ||
    offeredTermToStudyTerm(academicYear, moduleTerm);

  const payload = {
    academic_year: academicYear,
    programme_code: normalizeProgrammeCode(params.programmeCode),
    module_term: moduleTerm,
    study_term: studyTerm,
    ft_student_count: ftStudentCount,
    fee_per_student: feePerStudent,
    total_sharing_fee: Math.round(ftStudentCount * feePerStudent * 100) / 100,
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  if (params.id) {
    const { data, error } = await supabase
      .from("partner_sharing_records")
      .update(payload)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as PartnerSharingRecordRow;
  }

  const { data, error } = await supabase
    .from("partner_sharing_records")
    .upsert(payload, {
      onConflict: "academic_year,programme_code,module_term",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as PartnerSharingRecordRow;
}

export async function deletePartnerSharingRecord(id: string) {
  const { error } = await supabase
    .from("partner_sharing_records")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

/**
 * Count distinct FT students on the programme who have at least one enrolled
 * study-plan module in the given offered term (Sep/Feb/Jun → study term).
 */
export async function countEnrolledFtStudentsForProgrammeTerm(params: {
  programmeCode: string;
  academicYear: string;
  moduleTerm: ModuleTerm | string;
}) {
  const programmeCode = normalizeProgrammeCode(params.programmeCode);
  const academicYear = normalizeAcademicYear(params.academicYear);
  const moduleTerm = normalizeModuleTerm(String(params.moduleTerm));
  const studyTerm = offeredTermToStudyTerm(academicYear, moduleTerm);

  const { data: students, error: studentError } = await supabase
    .from("study_plan_students")
    .select("id, study_mode")
    .eq("programme_code", programmeCode);

  if (studentError) throw studentError;

  const ftProfileIds = (students ?? [])
    .filter(
      (row) => String(row.study_mode ?? "").trim().toUpperCase() !== "PT"
    )
    .map((row) => String(row.id ?? "").trim())
    .filter(Boolean);

  if (ftProfileIds.length === 0) {
    return { studyTerm, count: 0 };
  }

  // Chunk IN queries to avoid URL limits.
  const enrolledProfileIds = new Set<string>();
  const chunkSize = 200;

  for (let i = 0; i < ftProfileIds.length; i += chunkSize) {
    const chunk = ftProfileIds.slice(i, i + chunkSize);
    const { data: modules, error: moduleError } = await supabase
      .from("study_plan_modules")
      .select("student_profile_id, enrolled_module_instance_code")
      .eq("programme_code", programmeCode)
      .eq("study_term", studyTerm)
      .in("student_profile_id", chunk)
      .not("enrolled_module_instance_code", "is", null);

    if (moduleError) throw moduleError;

    for (const row of modules ?? []) {
      const profileId = String(row.student_profile_id ?? "").trim();
      const enrolled = String(row.enrolled_module_instance_code ?? "").trim();
      if (profileId && enrolled) {
        enrolledProfileIds.add(profileId);
      }
    }
  }

  return { studyTerm, count: enrolledProfileIds.size };
}

export async function programmeIsDegree(programmeCode: string) {
  const code = normalizeProgrammeCode(programmeCode);
  const { data, error } = await supabase
    .from("programmes")
    .select("programme_type")
    .eq("programme_code", code)
    .limit(1);

  if (error) throw error;
  const programmeType = data?.[0]?.programme_type ?? null;
  return isDegreeProgrammeType(programmeType);
}

export type PartnerSharingSpecialType = "partner_individual" | "flu";

export type PartnerSharingSpecialRow = {
  id: string;
  academic_year: string;
  programme_code: string;
  sharing_type: PartnerSharingSpecialType;
  student_count: number;
  tuition_fee_per_student: number;
  partner_u_fee_per_student: number;
  teacher_cost: number;
  lab_technician_cost: number;
  other_cost: number;
  calculated_total: number;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

/** UWLCFI → Partner 个人 */
export function isPartnerIndividualProgramme(programmeCode: string) {
  return normalizeProgrammeCode(programmeCode) === "UWLCFI";
}

/** HDEE / HDEEI → Sharing to FLU */
export function isFluSharingProgramme(programmeCode: string) {
  const code = normalizeProgrammeCode(programmeCode);
  return code === "HDEE" || code === "HDEEI" || code.startsWith("HDEE");
}

/**
 * (n × 2/6 × (tuition − partnerU) / 2 − teacher) / 2
 */
export function calculatePartnerIndividualTotal(params: {
  studentCount: number;
  tuitionFeePerStudent: number;
  partnerUFeePerStudent: number;
  teacherCost: number;
}) {
  const n = Math.max(0, Number(params.studentCount) || 0);
  const tuition = Math.max(0, Number(params.tuitionFeePerStudent) || 0);
  const partnerU = Math.max(0, Number(params.partnerUFeePerStudent) || 0);
  const teacher = Math.max(0, Number(params.teacherCost) || 0);
  const base = (n * (2 / 6) * (tuition - partnerU)) / 2;
  return Math.round(((base - teacher) / 2) * 100) / 100;
}

/**
 * (n × 2/8 × tuition / 2 − teacher − lab − other) / 2
 * (no Partner U fee)
 */
export function calculateFluSharingTotal(params: {
  studentCount: number;
  tuitionFeePerStudent: number;
  teacherCost: number;
  labTechnicianCost: number;
  otherCost: number;
}) {
  const n = Math.max(0, Number(params.studentCount) || 0);
  const tuition = Math.max(0, Number(params.tuitionFeePerStudent) || 0);
  const teacher = Math.max(0, Number(params.teacherCost) || 0);
  const lab = Math.max(0, Number(params.labTechnicianCost) || 0);
  const other = Math.max(0, Number(params.otherCost) || 0);
  const base = (n * (2 / 8) * tuition) / 2;
  return Math.round(((base - teacher - lab - other) / 2) * 100) / 100;
}

export async function listPartnerSharingSpecialRecords(academicYear: string) {
  const year = normalizeAcademicYear(academicYear);
  const { data, error } = await supabase
    .from("partner_sharing_special_records")
    .select("*")
    .eq("academic_year", year)
    .order("programme_code")
    .order("sharing_type");

  if (error) throw error;
  return (data ?? []) as PartnerSharingSpecialRow[];
}

export async function upsertPartnerSharingSpecialRecord(params: {
  id?: string;
  academicYear: string;
  programmeCode: string;
  sharingType: PartnerSharingSpecialType;
  studentCount: number | string;
  tuitionFeePerStudent: number | string;
  partnerUFeePerStudent?: number | string;
  teacherCost?: number | string;
  labTechnicianCost?: number | string;
  otherCost?: number | string;
  notes?: string | null;
  updatedBy?: string | null;
}) {
  const studentCount = Math.max(0, Math.round(Number(params.studentCount) || 0));
  const tuitionFeePerStudent = parseAmount(
    params.tuitionFeePerStudent,
    "Tuition fee"
  );
  const partnerUFeePerStudent =
    params.sharingType === "flu"
      ? 0
      : parseAmount(params.partnerUFeePerStudent ?? 0, "Partner U fee");
  const teacherCost = parseAmount(params.teacherCost ?? 0, "Teacher cost");
  const labTechnicianCost = parseAmount(
    params.labTechnicianCost ?? 0,
    "Lab technician cost"
  );
  const otherCost = parseAmount(params.otherCost ?? 0, "Other cost");

  const calculatedTotal =
    params.sharingType === "flu"
      ? calculateFluSharingTotal({
          studentCount,
          tuitionFeePerStudent,
          teacherCost,
          labTechnicianCost,
          otherCost,
        })
      : calculatePartnerIndividualTotal({
          studentCount,
          tuitionFeePerStudent,
          partnerUFeePerStudent,
          teacherCost,
        });

  const payload = {
    academic_year: normalizeAcademicYear(params.academicYear),
    programme_code: normalizeProgrammeCode(params.programmeCode),
    sharing_type: params.sharingType,
    student_count: studentCount,
    tuition_fee_per_student: tuitionFeePerStudent,
    partner_u_fee_per_student: partnerUFeePerStudent,
    teacher_cost: teacherCost,
    lab_technician_cost: labTechnicianCost,
    other_cost: otherCost,
    calculated_total: calculatedTotal,
    notes: String(params.notes ?? "").trim() || null,
    updated_by: params.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  if (params.id) {
    const { data, error } = await supabase
      .from("partner_sharing_special_records")
      .update(payload)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as PartnerSharingSpecialRow;
  }

  const { data, error } = await supabase
    .from("partner_sharing_special_records")
    .upsert(payload, {
      onConflict: "academic_year,programme_code,sharing_type",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as PartnerSharingSpecialRow;
}

export async function deletePartnerSharingSpecialRecord(id: string) {
  const { error } = await supabase
    .from("partner_sharing_special_records")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
