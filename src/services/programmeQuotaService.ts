import { supabase } from "../lib/supabase";
import {
  getAcademicYearVariants,
  getPreviousAcademicYear,
  offeredTermToStudyTerm,
  normalizeAcademicYear,
} from "../lib/utils";
import type { AppUser } from "../types/auth";
import type { ProgrammeRow } from "../types";
import { listProgrammes } from "./programmeService";
import { getProgrammeTypeByCode } from "./studyPlanService";
import { compareStudyTerm, isHDProgrammeType } from "../pages/programme-leader/make-study-plan/helpers";

function canonicalAcademicYear(academicYear: string) {
  return normalizeAcademicYear(academicYear);
}

export interface ProgrammeQuotaSummary {
  academicYear: string;
  programmeCode: string;
  programmeName: string | null;
  programmeLeader: string | null;
  ftQuota: number;
  ptQuota: number;
  actualFt: number;
  actualPt: number;
  isOverFtQuota: boolean;
  isOverPtQuota: boolean;
  savedAt: string | null;
  savedBy: string | null;
}

export interface ProgrammeQuotaListItem {
  programmeCode: string;
  programmeName: string | null;
  programmeLeader: string | null;
  ftQuota: number;
  ptQuota: number;
  actualFt: number;
  actualPt: number;
  isOverFtQuota: boolean;
  isOverPtQuota: boolean;
  hasQuota: boolean;
}

export interface ProgrammeStudentCounts {
  ft: number;
  pt: number;
  total: number;
}

function normalizeProgrammeCode(value: string) {
  return String(value ?? "").trim();
}

function normalizeStudyMode(value: string | null | undefined) {
  const mode = String(value ?? "").trim().toUpperCase();

  return mode === "PT" ? "PT" : "FT";
}

function groupProgrammesByCode(programmes: ProgrammeRow[]) {
  const map = new Map<
    string,
    {
      programmeCode: string;
      programmeName: string | null;
      programmeLeader: string | null;
    }
  >();

  for (const row of programmes) {
    const code = normalizeProgrammeCode(row.programme_code);

    if (!code) continue;

    if (!map.has(code)) {
      map.set(code, {
        programmeCode: code,
        programmeName: row.programme_name ?? null,
        programmeLeader: row.programme_leader ?? null,
      });
    }
  }

  return map;
}

async function loadConfirmationRow(academicYear: string, programmeCode: string) {
  const { data, error } = await supabase
    .from("programme_quota_confirmations")
    .select("*")
    .eq("academic_year", academicYear)
    .eq("programme_code", programmeCode)
    .maybeSingle();

  if (error) throw error;

  return data;
}

export async function getProgrammeStudentCountsByStudyMode(
  academicYear: string,
  programmeCode: string
): Promise<ProgrammeStudentCounts> {
  academicYear = canonicalAcademicYear(academicYear);
  const code = normalizeProgrammeCode(programmeCode);

  const programmeType = await getProgrammeTypeByCode(code);
  if (isHDProgrammeType(programmeType)) {
    return getHDProgrammeStudentCountsByStudyMode(academicYear, code);
  }

  const yearVariants = getAcademicYearVariants(academicYear);

  const { data, error } = await supabase
    .from("study_plan_students")
    .select("study_mode, intake_year")
    .eq("programme_code", code);

  if (error) throw error;

  let ft = 0;
  let pt = 0;

  for (const row of data ?? []) {
    const intakeYear = normalizeAcademicYear(String(row.intake_year ?? ""));

    if (intakeYear && !yearVariants.includes(intakeYear)) {
      continue;
    }

    if (normalizeStudyMode(row.study_mode) === "PT") {
      pt += 1;
    } else {
      ft += 1;
    }
  }

  return { ft, pt, total: ft + pt };
}

async function getHDProgrammeStudentCountsByStudyMode(
  academicYear: string,
  programmeCode: string
): Promise<ProgrammeStudentCounts> {
  const code = normalizeProgrammeCode(programmeCode);

  const sepTerm = offeredTermToStudyTerm(academicYear, "Sep").toUpperCase();
  const febTerm = offeredTermToStudyTerm(academicYear, "Feb").toUpperCase();
  const juneTerm = offeredTermToStudyTerm(academicYear, "Jun").toUpperCase();

  const allowedFirstTerms = new Set([sepTerm, febTerm, juneTerm]);

  const { data: students, error: studentsError } = await supabase
    .from("study_plan_students")
    .select("id,study_mode")
    .eq("programme_code", code);

  if (studentsError) throw studentsError;

  const studentIds = (students ?? [])
    .map((s: any) => String(s?.id ?? "").trim())
    .filter(Boolean);

  const studentsById = new Map<
    string,
    {
      studyMode: string | null;
    }
  >();

  for (const s of students ?? []) {
    const id = String(s?.id ?? "").trim();
    if (!id) continue;
    studentsById.set(id, { studyMode: s?.study_mode ?? null });
  }

  const chunkSize = 100;
  let ft = 0;
  let pt = 0;

  for (let index = 0; index < studentIds.length; index += chunkSize) {
    const profileChunk = studentIds.slice(index, index + chunkSize);

    const { data: moduleRows, error: modulesError } = await supabase
      .from("study_plan_modules")
      .select("student_profile_id,plan_stage,status,study_term")
      .in("student_profile_id", profileChunk);

    if (modulesError) throw modulesError;

    const earliestProgrammeTermByProfileId = new Map<string, string>();

    for (const m of moduleRows ?? []) {
      const planStage = String(m?.plan_stage ?? "").trim();
      const status = String(m?.status ?? "").trim();

      if (planStage !== "programme") continue;
      if (status !== "planned") continue;

      const profileId = String(m?.student_profile_id ?? "").trim();
      if (!profileId) continue;

      const studyTerm = String(m?.study_term ?? "").trim().toUpperCase();
      if (!studyTerm) continue;

      const existing = earliestProgrammeTermByProfileId.get(profileId);
      if (!existing || compareStudyTerm(studyTerm, existing) < 0) {
        earliestProgrammeTermByProfileId.set(profileId, studyTerm);
      }
    }

    for (const profileId of profileChunk) {
      const earliestTerm = earliestProgrammeTermByProfileId.get(profileId);
      if (!earliestTerm) continue;
      if (!allowedFirstTerms.has(earliestTerm)) continue;

      const student = studentsById.get(profileId);
      const mode = normalizeStudyMode(student?.studyMode);

      if (mode === "PT") {
        pt += 1;
      } else {
        ft += 1;
      }
    }
  }

  return { ft, pt, total: ft + pt };
}

function readFtPtQuota(confirmation: Record<string, unknown> | null) {
  const ft = Number(confirmation?.ft_quota ?? confirmation?.programme_quota ?? 0);
  const pt = Number(confirmation?.pt_quota ?? 0);

  return {
    ftQuota: Math.max(0, Math.floor(ft)),
    ptQuota: Math.max(0, Math.floor(pt)),
  };
}

export async function listQuotaProgrammesForUser(
  user: AppUser,
  academicYear: string
): Promise<ProgrammeQuotaListItem[]> {
  academicYear = canonicalAcademicYear(academicYear);
  const programmes = await listProgrammes();
  const grouped = groupProgrammesByCode(programmes);
  const codes = Array.from(grouped.keys());

  if (codes.length === 0) {
    return [];
  }

  const { data: confirmations, error } = await supabase
    .from("programme_quota_confirmations")
    .select("*")
    .eq("academic_year", academicYear)
    .in("programme_code", codes);

  if (error) throw error;

  const confirmationByCode = new Map(
    (confirmations ?? []).map((row) => [
      normalizeProgrammeCode(row.programme_code),
      row,
    ])
  );

  const items: ProgrammeQuotaListItem[] = [];

  for (const code of codes) {
    const meta = grouped.get(code)!;
    const confirmation = confirmationByCode.get(code);
    const { ftQuota, ptQuota } = readFtPtQuota(confirmation);
    const counts = await getProgrammeStudentCountsByStudyMode(academicYear, code);

    items.push({
      programmeCode: code,
      programmeName: meta.programmeName,
      programmeLeader: meta.programmeLeader,
      ftQuota,
      ptQuota,
      actualFt: counts.ft,
      actualPt: counts.pt,
      isOverFtQuota: ftQuota > 0 && counts.ft > ftQuota,
      isOverPtQuota: ptQuota > 0 && counts.pt > ptQuota,
      hasQuota: ftQuota > 0 || ptQuota > 0,
    });
  }

  return items.sort((a, b) => a.programmeCode.localeCompare(b.programmeCode));
}

export async function getProgrammeQuotaDetail(
  academicYear: string,
  programmeCode: string,
  _user: AppUser
): Promise<ProgrammeQuotaSummary> {
  academicYear = canonicalAcademicYear(academicYear);
  const code = normalizeProgrammeCode(programmeCode);
  const programmes = await listProgrammes();
  const streamsForProgramme = programmes.filter(
    (row) => normalizeProgrammeCode(row.programme_code) === code
  );

  if (streamsForProgramme.length === 0) {
    throw new Error(`找不到課程「${code}」。請先在課程管理（programmes）中建立。`);
  }

  let confirmation = await loadConfirmationRow(academicYear, code);

  if (!confirmation) {
    const copied = await copyQuotaFromPreviousYear(academicYear, code, _user);

    if (copied) {
      confirmation = await loadConfirmationRow(academicYear, code);
    }
  }

  const { ftQuota, ptQuota } = readFtPtQuota(confirmation);
  const counts = await getProgrammeStudentCountsByStudyMode(academicYear, code);

  return {
    academicYear,
    programmeCode: code,
    programmeName: streamsForProgramme[0]?.programme_name ?? null,
    programmeLeader: streamsForProgramme[0]?.programme_leader ?? null,
    ftQuota,
    ptQuota,
    actualFt: counts.ft,
    actualPt: counts.pt,
    isOverFtQuota: ftQuota > 0 && counts.ft > ftQuota,
    isOverPtQuota: ptQuota > 0 && counts.pt > ptQuota,
    savedAt: confirmation?.updated_at ?? confirmation?.confirmed_at ?? null,
    savedBy: confirmation?.confirmed_by ?? null,
  };
}

export async function saveProgrammeQuota(params: {
  academicYear: string;
  programmeCode: string;
  ftQuota: number;
  ptQuota: number;
  user: AppUser;
}) {
  params = { ...params, academicYear: canonicalAcademicYear(params.academicYear) };
  const code = normalizeProgrammeCode(params.programmeCode);
  const ftQuota = Math.max(0, Math.floor(params.ftQuota));
  const ptQuota = Math.max(0, Math.floor(params.ptQuota));
  const now = new Date().toISOString();
  const legacyTotal = ftQuota + ptQuota;

  const { error } = await supabase.from("programme_quota_confirmations").upsert(
    {
      academic_year: params.academicYear,
      programme_code: code,
      programme_quota: legacyTotal,
      ft_quota: ftQuota,
      pt_quota: ptQuota,
      confirmed_at: now,
      confirmed_by: params.user.username,
      updated_at: now,
    },
    { onConflict: "academic_year,programme_code" }
  );

  if (error) throw error;
}

/** @deprecated Timetable no longer requires quota confirmation. */
export async function isProgrammeQuotaConfirmed(
  academicYear: string,
  programmeCode: string
) {
  academicYear = canonicalAcademicYear(academicYear);
  const row = await loadConfirmationRow(
    academicYear,
    normalizeProgrammeCode(programmeCode)
  );

  const { ftQuota, ptQuota } = readFtPtQuota(row);

  return ftQuota > 0 || ptQuota > 0;
}

export async function copyQuotaFromPreviousYear(
  academicYear: string,
  programmeCode: string,
  user: AppUser
): Promise<boolean> {
  academicYear = canonicalAcademicYear(academicYear);
  const code = normalizeProgrammeCode(programmeCode);
  const previousYear = getPreviousAcademicYear(academicYear);
  const previousConfirmation = await loadConfirmationRow(previousYear, code);

  if (!previousConfirmation) {
    return false;
  }

  const { ftQuota, ptQuota } = readFtPtQuota(previousConfirmation);

  await saveProgrammeQuota({
    academicYear,
    programmeCode: code,
    ftQuota,
    ptQuota,
    user,
  });

  return true;
}

export async function ensureQuotaCopiedForAcademicYear(
  academicYear: string,
  user: AppUser
) {
  academicYear = canonicalAcademicYear(academicYear);
  const programmes = await listQuotaProgrammesForUser(user, academicYear);

  for (const row of programmes) {
    if (!row.hasQuota) {
      await copyQuotaFromPreviousYear(academicYear, row.programmeCode, user);
    }
  }
}

export function getQuotaStatusMessage(academicYear: string) {
  return `學年 ${canonicalAcademicYear(academicYear)}：設定 FT / PT 收生人數上限，並與 Study Plan 實際人數比對（僅供參考，不影響製作時間表）。`;
}

// --- Legacy exports (stream quota removed; kept for gradual cleanup) ---

export interface ProgrammeQuotaStreamRow {
  programmeStream: string;
  streamQuota: number;
}

export async function saveProgrammeQuotaDraft(params: {
  academicYear: string;
  programmeCode: string;
  programmeQuota: number;
  streams: ProgrammeQuotaStreamRow[];
  user: AppUser;
}) {
  await saveProgrammeQuota({
    academicYear: params.academicYear,
    programmeCode: params.programmeCode,
    ftQuota: params.programmeQuota,
    ptQuota: 0,
    user: params.user,
  });
}

export async function confirmProgrammeQuota(params: {
  academicYear: string;
  programmeCode: string;
  programmeQuota: number;
  streams: ProgrammeQuotaStreamRow[];
  user: AppUser;
}) {
  const ft = Math.max(0, Math.floor(params.programmeQuota));
  const pt = params.streams.reduce(
    (sum, row) => sum + Math.max(0, Math.floor(row.streamQuota)),
    0
  );

  await saveProgrammeQuota({
    academicYear: params.academicYear,
    programmeCode: params.programmeCode,
    ftQuota: ft,
    ptQuota: pt > 0 ? pt : 0,
    user: params.user,
  });
}

export async function adminUnlockProgrammeQuota(_params: {
  academicYear: string;
  programmeCode: string;
  unlockUntil: string;
  adminUser: AppUser;
}) {
  // Quota locking removed; no-op for compatibility.
}
