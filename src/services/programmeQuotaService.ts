import { supabase } from "../lib/supabase";
import {
  academicYearToStartYear,
  getPreviousAcademicYear,
  isQuotaEditableByProgrammeLeader,
  normalizeAcademicYear,
  normalizeStream,
  offeredTermToStudyTerm,
} from "../lib/utils";
import type { AppUser } from "../types/auth";
import type { ProgrammeRow } from "../types";
import { listProgrammes } from "./programmeService";
import {
  bulkUpsertStudentNumbers,
  listStudentNumbers,
  type StudentNumberInputRow,
} from "./studentNumberService";
import { ensureTimetablePlanningModules } from "./timetableService";

function canonicalAcademicYear(academicYear: string) {
  return normalizeAcademicYear(academicYear);
}

export interface ProgrammeQuotaStreamRow {
  programmeStream: string;
  streamQuota: number;
}

export interface ProgrammeQuotaSummary {
  academicYear: string;
  programmeCode: string;
  programmeName: string | null;
  programmeLeader: string | null;
  programmeQuota: number;
  streams: ProgrammeQuotaStreamRow[];
  streamQuotaTotal: number;
  confirmedAt: string | null;
  confirmedBy: string | null;
  adminUnlockedUntil: string | null;
  editableByProgrammeLeader: boolean;
  isConfirmed: boolean;
}

export interface ProgrammeQuotaListItem {
  programmeCode: string;
  programmeName: string | null;
  programmeLeader: string | null;
  programmeQuota: number;
  streamCount: number;
  streamQuotaTotal: number;
  confirmedAt: string | null;
  editableByProgrammeLeader: boolean;
  isConfirmed: boolean;
  needsReview: boolean;
}

function normalizeProgrammeCode(value: string) {
  return String(value ?? "").trim();
}

function sumStreamQuotas(streams: ProgrammeQuotaStreamRow[]) {
  return streams.reduce((total, row) => total + (row.streamQuota || 0), 0);
}

function groupProgrammesByCode(programmes: ProgrammeRow[]) {
  const map = new Map<
    string,
    {
      programmeCode: string;
      programmeName: string | null;
      programmeLeader: string | null;
      streams: string[];
    }
  >();

  for (const row of programmes) {
    const code = normalizeProgrammeCode(row.programme_code);

    if (!code) continue;

    const existing = map.get(code) ?? {
      programmeCode: code,
      programmeName: row.programme_name ?? null,
      programmeLeader: row.programme_leader ?? null,
      streams: [],
    };

    existing.streams.push(normalizeStream(row.programme_stream));
    map.set(code, existing);
  }

  for (const entry of map.values()) {
    entry.streams = Array.from(new Set(entry.streams)).sort((a, b) =>
      a.localeCompare(b)
    );
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

async function loadStreamQuotaRows(academicYear: string, programmeCode: string) {
  const { data, error } = await supabase
    .from("programme_stream_quotas")
    .select("programme_stream, stream_quota")
    .eq("academic_year", academicYear)
    .eq("programme_code", programmeCode)
    .order("programme_stream");

  if (error) throw error;

  return (data ?? []).map((row) => ({
    programmeStream: normalizeStream(row.programme_stream),
    streamQuota: Number(row.stream_quota ?? 0),
  }));
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

  const [{ data: confirmations, error: confirmationError }, { data: streamRows, error: streamError }] =
    await Promise.all([
      supabase
        .from("programme_quota_confirmations")
        .select("*")
        .eq("academic_year", academicYear)
        .in("programme_code", codes),
      supabase
        .from("programme_stream_quotas")
        .select("programme_code, programme_stream, stream_quota")
        .eq("academic_year", academicYear)
        .in("programme_code", codes),
    ]);

  if (confirmationError) throw confirmationError;
  if (streamError) throw streamError;

  const confirmationByCode = new Map(
    (confirmations ?? []).map((row) => [
      normalizeProgrammeCode(row.programme_code),
      row,
    ])
  );

  const streamsByCode = new Map<string, ProgrammeQuotaStreamRow[]>();

  for (const row of streamRows ?? []) {
    const code = normalizeProgrammeCode(row.programme_code);
    const existing = streamsByCode.get(code) ?? [];

    existing.push({
      programmeStream: normalizeStream(row.programme_stream),
      streamQuota: Number(row.stream_quota ?? 0),
    });
    streamsByCode.set(code, existing);
  }

  return codes
    .map((code) => {
      const meta = grouped.get(code)!;
      const confirmation = confirmationByCode.get(code);
      const streams = streamsByCode.get(code) ?? [];
      const streamQuotaTotal = sumStreamQuotas(streams);
      const editableByProgrammeLeader = isQuotaEditableByProgrammeLeader(
        academicYear,
        confirmation?.admin_unlocked_until
      );
      const isConfirmed = Boolean(confirmation?.confirmed_at);

      return {
        programmeCode: code,
        programmeName: meta.programmeName,
        programmeLeader: meta.programmeLeader,
        programmeQuota: Number(confirmation?.programme_quota ?? 0),
        streamCount: meta.streams.length,
        streamQuotaTotal,
        confirmedAt: confirmation?.confirmed_at ?? null,
        editableByProgrammeLeader,
        isConfirmed,
        needsReview: !isConfirmed,
      };
    })
    .sort((a, b) => a.programmeCode.localeCompare(b.programmeCode));
}

export async function getProgrammeQuotaDetail(
  academicYear: string,
  programmeCode: string,
  user: AppUser
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

  const confirmation = await loadConfirmationRow(academicYear, code);
  let streamRows = await loadStreamQuotaRows(academicYear, code);

  const expectedStreams = Array.from(
    new Set(streamsForProgramme.map((row) => normalizeStream(row.programme_stream)))
  ).sort((a, b) => a.localeCompare(b));

  if (streamRows.length === 0 && expectedStreams.length > 0) {
    const copied = await copyQuotaFromPreviousYear(academicYear, code, user);

    if (copied) {
      streamRows = copied.streams;
    } else {
      const programmeQuota = 0;
      const even = expectedStreams.length
        ? Math.floor(programmeQuota / expectedStreams.length)
        : 0;

      streamRows = expectedStreams.map((stream, index) => {
        const remainder =
          index === expectedStreams.length - 1
            ? programmeQuota - even * (expectedStreams.length - 1)
            : even;

        return {
          programmeStream: stream,
          streamQuota: remainder,
        };
      });
    }
  } else {
    const existingStreams = new Set(streamRows.map((row) => row.programmeStream));

    for (const stream of expectedStreams) {
      if (!existingStreams.has(stream)) {
        streamRows.push({ programmeStream: stream, streamQuota: 0 });
      }
    }

    streamRows.sort((a, b) => a.programmeStream.localeCompare(b.programmeStream));
  }

  const programmeQuota = Number(confirmation?.programme_quota ?? 0);
  const editableByProgrammeLeader = isQuotaEditableByProgrammeLeader(
    academicYear,
    confirmation?.admin_unlocked_until
  );

  return {
    academicYear,
    programmeCode: code,
    programmeName: streamsForProgramme[0]?.programme_name ?? null,
    programmeLeader: streamsForProgramme[0]?.programme_leader ?? null,
    programmeQuota,
    streams: streamRows,
    streamQuotaTotal: sumStreamQuotas(streamRows),
    confirmedAt: confirmation?.confirmed_at ?? null,
    confirmedBy: confirmation?.confirmed_by ?? null,
    adminUnlockedUntil: confirmation?.admin_unlocked_until ?? null,
    editableByProgrammeLeader,
    isConfirmed: Boolean(confirmation?.confirmed_at),
  };
}

export async function saveProgrammeQuotaDraft(params: {
  academicYear: string;
  programmeCode: string;
  programmeQuota: number;
  streams: ProgrammeQuotaStreamRow[];
  user: AppUser;
}) {
  params = { ...params, academicYear: canonicalAcademicYear(params.academicYear) };
  const detail = await getProgrammeQuotaDetail(
    params.academicYear,
    params.programmeCode,
    params.user
  );

  if (
    params.user.role === "programme_leader" &&
    !detail.editableByProgrammeLeader
  ) {
    throw new Error("此學年 Quota 已鎖定，請聯絡 Admin 解鎖。");
  }

  const programmeQuota = Math.max(0, Math.floor(params.programmeQuota));
  const streams = params.streams.map((row) => ({
    programmeStream: normalizeStream(row.programmeStream),
    streamQuota: Math.max(0, Math.floor(row.streamQuota)),
  }));

  const streamTotal = sumStreamQuotas(streams);

  if (streamTotal !== programmeQuota) {
    throw new Error(
      `Stream 總和（${streamTotal}）必須等於 Programme Quota（${programmeQuota}）。`
    );
  }

  const now = new Date().toISOString();

  const { error: confirmationError } = await supabase
    .from("programme_quota_confirmations")
    .upsert(
      {
        academic_year: params.academicYear,
        programme_code: detail.programmeCode,
        programme_quota: programmeQuota,
        confirmed_at: null,
        confirmed_by: null,
        updated_at: now,
      },
      { onConflict: "academic_year,programme_code" }
    );

  if (confirmationError) throw confirmationError;

  const streamPayload = streams.map((row) => ({
    academic_year: params.academicYear,
    programme_code: detail.programmeCode,
    programme_stream: row.programmeStream,
    programme_quota: programmeQuota,
    stream_quota: row.streamQuota,
    updated_at: now,
  }));

  if (streamPayload.length > 0) {
    const { error: streamError } = await supabase
      .from("programme_stream_quotas")
      .upsert(streamPayload, {
        onConflict: "academic_year,programme_code,programme_stream",
      });

    if (streamError) throw streamError;
  }
}

export async function confirmProgrammeQuota(params: {
  academicYear: string;
  programmeCode: string;
  programmeQuota: number;
  streams: ProgrammeQuotaStreamRow[];
  user: AppUser;
}) {
  params = { ...params, academicYear: canonicalAcademicYear(params.academicYear) };
  await saveProgrammeQuotaDraft({
    academicYear: params.academicYear,
    programmeCode: params.programmeCode,
    programmeQuota: params.programmeQuota,
    streams: params.streams,
    user: params.user,
  });

  const programmeQuota = Math.max(0, Math.floor(params.programmeQuota));
  const streams = params.streams.map((row) => ({
    programmeStream: normalizeStream(row.programmeStream),
    streamQuota: Math.max(0, Math.floor(row.streamQuota)),
  }));

  const detail = await getProgrammeQuotaDetail(
    params.academicYear,
    params.programmeCode,
    params.user
  );

  if (
    params.user.role === "programme_leader" &&
    !detail.editableByProgrammeLeader
  ) {
    throw new Error("此學年 Quota 已鎖定，請聯絡 Admin 解鎖。");
  }

  const now = new Date().toISOString();

  const { error } = await supabase
    .from("programme_quota_confirmations")
    .upsert(
      {
        academic_year: params.academicYear,
        programme_code: detail.programmeCode,
        programme_quota: programmeQuota,
        confirmed_at: now,
        confirmed_by: params.user.username,
        admin_unlocked_until: null,
        admin_unlocked_by: null,
        updated_at: now,
      },
      { onConflict: "academic_year,programme_code" }
    );

  if (error) throw error;

  await generateModuleExpectedFromQuota({
    academicYear: params.academicYear,
    programmeCode: detail.programmeCode,
    streams,
    programmeQuota,
    createdBy: params.user.id,
  });
}

export async function isProgrammeQuotaConfirmed(
  academicYear: string,
  programmeCode: string
) {
  academicYear = canonicalAcademicYear(academicYear);
  const row = await loadConfirmationRow(
    academicYear,
    normalizeProgrammeCode(programmeCode)
  );

  return Boolean(row?.confirmed_at);
}

export async function copyQuotaFromPreviousYear(
  academicYear: string,
  programmeCode: string,
  user: AppUser
): Promise<ProgrammeQuotaSummary | null> {
  academicYear = canonicalAcademicYear(academicYear);
  const code = normalizeProgrammeCode(programmeCode);
  const previousYear = getPreviousAcademicYear(academicYear);

  const previousConfirmation = await loadConfirmationRow(previousYear, code);

  if (!previousConfirmation) {
    return null;
  }

  const previousStreams = await loadStreamQuotaRows(previousYear, code);
  const now = new Date().toISOString();

  const { error: confirmationError } = await supabase
    .from("programme_quota_confirmations")
    .upsert(
      {
        academic_year: academicYear,
        programme_code: code,
        programme_quota: Number(previousConfirmation.programme_quota ?? 0),
        confirmed_at: null,
        confirmed_by: null,
        admin_unlocked_until: null,
        admin_unlocked_by: null,
        updated_at: now,
      },
      { onConflict: "academic_year,programme_code" }
    );

  if (confirmationError) throw confirmationError;

  if (previousStreams.length > 0) {
    const { error: streamError } = await supabase
      .from("programme_stream_quotas")
      .upsert(
        previousStreams.map((row) => ({
          academic_year: academicYear,
          programme_code: code,
          programme_stream: row.programmeStream,
          programme_quota: Number(previousConfirmation.programme_quota ?? 0),
          stream_quota: row.streamQuota,
          updated_at: now,
        })),
        { onConflict: "academic_year,programme_code,programme_stream" }
      );

    if (streamError) throw streamError;
  }

  return getProgrammeQuotaDetail(academicYear, code, user);
}

export async function ensureQuotaCopiedForAcademicYear(
  academicYear: string,
  user: AppUser
) {
  academicYear = canonicalAcademicYear(academicYear);
  const programmes = await listQuotaProgrammesForUser(user, academicYear);
  const needsCopy = programmes.filter(
    (row) => !row.isConfirmed && row.programmeQuota === 0 && row.streamQuotaTotal === 0
  );

  for (const row of needsCopy) {
    await copyQuotaFromPreviousYear(academicYear, row.programmeCode, user);
  }
}

export async function adminUnlockProgrammeQuota(params: {
  academicYear: string;
  programmeCode: string;
  unlockUntil: string;
  adminUser: AppUser;
}) {
  params = { ...params, academicYear: canonicalAcademicYear(params.academicYear) };
  if (params.adminUser.role !== "admin") {
    throw new Error("只有 Admin 可以解鎖 Quota。");
  }

  const code = normalizeProgrammeCode(params.programmeCode);
  const existing = await loadConfirmationRow(params.academicYear, code);

  if (!existing) {
    throw new Error("找不到該學年的 Quota 記錄。");
  }

  const { error } = await supabase
    .from("programme_quota_confirmations")
    .update({
      admin_unlocked_until: params.unlockUntil,
      admin_unlocked_by: params.adminUser.username,
      confirmed_at: null,
      confirmed_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("academic_year", params.academicYear)
    .eq("programme_code", code);

  if (error) throw error;
}

async function generateModuleExpectedFromQuota(params: {
  academicYear: string;
  programmeCode: string;
  programmeQuota: number;
  streams: ProgrammeQuotaStreamRow[];
  createdBy: string;
}) {
  await ensureTimetablePlanningModules({
    academicYear: params.academicYear,
    programmeCode: params.programmeCode,
    createdBy: params.createdBy,
  });

  const streamQuotaByKey = new Map(
    params.streams.map((row) => [row.programmeStream, row.streamQuota])
  );

  const { data: modules, error: moduleError } = await supabase
    .from("modules")
    .select("module_code, module_name, module_term, programme_code, stream_code")
    .eq("programme_code", params.programmeCode)
    .order("module_code");

  if (moduleError) throw moduleError;

  const existingRows = await listStudentNumbers(params.academicYear);
  const existingByKey = new Map(
    existingRows
      .filter((row) => row.programme_code === params.programmeCode)
      .map((row) => [
        [
          row.module_code,
          normalizeStream(row.programme_stream),
          row.study_term,
        ].join("|"),
        row,
      ])
  );

  const inputRows: StudentNumberInputRow[] = [];

  for (const module of modules ?? []) {
    const programmeStream = normalizeStream(module.stream_code);
    const studyTerm = offeredTermToStudyTerm(
      params.academicYear,
      String(module.module_term ?? "")
    );

    if (!studyTerm) {
      continue;
    }

    const expected =
      streamQuotaByKey.get(programmeStream) ??
      (programmeStream === "nil" ? params.programmeQuota : 0);

    const key = [
      module.module_code,
      programmeStream,
      studyTerm,
    ].join("|");

    const existing = existingByKey.get(key);

    inputRows.push({
      academic_year: params.academicYear,
      module_code: module.module_code,
      module_name: module.module_name ?? null,
      module_term: module.module_term ?? null,
      programme_code: params.programmeCode,
      programme_stream: programmeStream,
      study_term: studyTerm,
      streams_included: [programmeStream],
      expected_student_number: expected,
      actual_student_number: existing?.actual_student_number ?? 0,
    });
  }

  if (inputRows.length > 0) {
    await bulkUpsertStudentNumbers({
      rows: inputRows,
      createdBy: params.createdBy,
    });
  }
}

export function getQuotaStatusMessage(academicYear: string) {
  const startYear = academicYearToStartYear(academicYear);

  return `學年 ${academicYear} 的 Quota 須在 ${startYear} 年 6 月 30 日或之前確認；${startYear} 年 7 月 1 日起鎖定（Admin 可解鎖）。`;
}
