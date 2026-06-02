import { supabase } from "../lib/supabase";
import {
  addDays,
  generateAcademicCalendar,
  normalizeHolidayIsoDate,
  parseIsoDate,
  toIsoDateString,
  type IsoDateString,
} from "../lib/academicCalendar";
import { normalizeAcademicYear } from "../lib/utils";
import {
  getPublishedAcademicCalendar,
  listAcademicCalendarBreaks,
  listHkPublicHolidays,
} from "./academicCalendarService";

export type TimetableRoomType = "normal" | "computer";
export type TimetableScheduleTerm = "Sep" | "Feb";

/** Extra seats allowed for computer rooms (e.g. SSP-103: 65 + 10). */
export const COMPUTER_ROOM_EXTRA_SEATS = 10;

export function effectiveRoomCapacity(
  room: TimetableClassroomRow,
  requiresComputer: boolean
) {
  const base = Number(room.room_size ?? 0);
  if (requiresComputer && room.room_type === "computer") {
    return base + COMPUTER_ROOM_EXTRA_SEATS;
  }
  return base;
}

export interface TimetableClassroomRow {
  room_code: string;
  room_size: number;
  room_type: TimetableRoomType;
}

export interface TimetableSessionRow {
  id: string;
  academic_year: string;
  timetable_module_id: string;
  module_instance_code: string;
  module_code: string;
  module_name: string | null;
  session_date: string;
  start_time: string;
  end_time: string;
  room_code: string;
  status: "normal" | "cancel" | "make_up";
  session_number: number | null;
  teacher_name: string | null;
  module_size: number | null;
}

export function defaultClassroomsForHKIT(): TimetableClassroomRow[] {
  return [
    { room_code: "SSP-101", room_size: 29, room_type: "normal" },
    { room_code: "SSP-104", room_size: 29, room_type: "normal" },
    { room_code: "SSP-201", room_size: 29, room_type: "normal" },
    { room_code: "SSP-204", room_size: 29, room_type: "computer" },
    { room_code: "SSP-203", room_size: 80, room_type: "normal" },
    { room_code: "SSP-303", room_size: 110, room_type: "normal" },
    { room_code: "SSP-103", room_size: 65, room_type: "computer" },
  ];
}

export async function ensureDefaultTimetableClassrooms() {
  const now = new Date().toISOString();
  const payload = defaultClassroomsForHKIT().map((room) => ({
    room_code: room.room_code,
    room_size: room.room_size,
    room_type: room.room_type,
    updated_at: now,
  }));

  const { error } = await supabase
    .from("timetable_classrooms")
    .upsert(payload, { onConflict: "room_code" });

  if (error) throw error;
}

export async function listTimetableClassrooms(): Promise<TimetableClassroomRow[]> {
  const { data, error } = await supabase
    .from("timetable_classrooms")
    .select("room_code, room_size, room_type")
    .order("room_code", { ascending: true });

  if (error) {
    try {
      await ensureDefaultTimetableClassrooms();
      const { data: retryData, error: retryError } = await supabase
        .from("timetable_classrooms")
        .select("room_code, room_size, room_type")
        .order("room_code", { ascending: true });
      if (!retryError && retryData && retryData.length > 0) {
        return retryData as TimetableClassroomRow[];
      }
    } catch {
      // Fall through to in-memory defaults.
    }
    return defaultClassroomsForHKIT();
  }

  if (!data || data.length === 0) {
    await ensureDefaultTimetableClassrooms();
    const { data: refreshed, error: refreshError } = await supabase
      .from("timetable_classrooms")
      .select("room_code, room_size, room_type")
      .order("room_code", { ascending: true });

    if (refreshError || !refreshed || refreshed.length === 0) {
      return defaultClassroomsForHKIT();
    }

    return refreshed as TimetableClassroomRow[];
  }

  return (data ?? []) as TimetableClassroomRow[];
}

export async function listTimetableSessions(params: {
  academicYear: string;
}): Promise<TimetableSessionRow[]> {
  const { data, error } = await supabase
    .from("timetable_sessions")
    .select("*")
    .eq("academic_year", params.academicYear)
    .order("session_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    return [];
  }

  return (data ?? []) as TimetableSessionRow[];
}

export async function listScheduledTimetableModuleIds(params: {
  academicYear: string;
}): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("timetable_sessions")
    .select("timetable_module_id, status")
    .eq("academic_year", params.academicYear);

  if (error) {
    throw error;
  }

  const result = new Set<string>();
  for (const row of (data ?? []) as Array<{
    timetable_module_id?: string;
    status?: string;
  }>) {
    if (row.status === "cancel") continue;
    const id = String(row.timetable_module_id ?? "").trim();
    if (id) result.add(id);
  }

  return result;
}

const SESSION_DELETE_BATCH_SIZE = 80;
const SESSION_INSERT_BATCH_SIZE = 200;

function chunkValues<T>(values: T[], batchSize: number): T[][] {
  if (values.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += batchSize) {
    chunks.push(values.slice(i, i + batchSize));
  }
  return chunks;
}

export function normalizeSessionTime(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "00:00:00";

  const parts = raw.split(":");
  const hh = parts[0]?.padStart(2, "0") ?? "00";
  const mm = parts[1]?.padStart(2, "0") ?? "00";
  const ss = (parts[2] ?? "00").padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function normalizeSessionDate(value: string): string {
  return String(value ?? "").trim().slice(0, 10);
}

async function deleteTimetableSessionsInBatches(params: {
  column: "timetable_module_id" | "module_instance_code";
  values: string[];
}) {
  const values = Array.from(
    new Set(params.values.map((value) => String(value ?? "").trim()).filter(Boolean))
  );
  if (values.length === 0) return;

  for (const batch of chunkValues(values, SESSION_DELETE_BATCH_SIZE)) {
    const { error } = await supabase
      .from("timetable_sessions")
      .delete()
      .in(params.column, batch);

    if (error) throw error;
  }
}

export async function deleteTimetableSessionsForModuleIds(params: {
  timetableModuleIds: string[];
}) {
  await deleteTimetableSessionsInBatches({
    column: "timetable_module_id",
    values: params.timetableModuleIds,
  });
}

export async function deleteTimetableSessionsForInstanceCodes(params: {
  moduleInstanceCodes: string[];
}) {
  await deleteTimetableSessionsInBatches({
    column: "module_instance_code",
    values: params.moduleInstanceCodes,
  });
}

function sessionInsertIdentityKey(row: {
  timetable_module_id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  room_code: string;
}) {
  return [
    row.timetable_module_id,
    normalizeSessionDate(row.session_date),
    normalizeSessionTime(row.start_time),
    normalizeSessionTime(row.end_time),
    String(row.room_code ?? "").trim(),
  ].join("|");
}

function isSessionConflictError(error: {
  code?: string;
  message?: string;
  status?: number;
}) {
  const message = String(error.message ?? "").toLowerCase();
  return (
    error.code === "23505" ||
    error.status === 409 ||
    message.includes("duplicate key") ||
    message.includes("unique constraint") ||
    message.includes("already exists")
  );
}

async function insertTimetableSessionBatches(payload: Array<Record<string, unknown>>) {
  for (const batch of chunkValues(payload, SESSION_INSERT_BATCH_SIZE)) {
    const { error } = await supabase.from("timetable_sessions").insert(batch);
    if (!error) continue;

    if (error.code === "23503") {
      throw new Error(
        "A scheduled room is missing from timetable_classrooms. Syncing default HKIT rooms — please try auto schedule again."
      );
    }

    if (!isSessionConflictError(error)) {
      throw error;
    }

    const moduleIds = Array.from(
      new Set(
        batch
          .map((row) => String(row.timetable_module_id ?? "").trim())
          .filter(Boolean)
      )
    );
    const instanceCodes = Array.from(
      new Set(
        batch
          .map((row) => String(row.module_instance_code ?? "").trim())
          .filter(Boolean)
      )
    );

    await deleteTimetableSessionsForModuleIds({ timetableModuleIds: moduleIds });
    await deleteTimetableSessionsForInstanceCodes({
      moduleInstanceCodes: instanceCodes,
    });

    const { error: retryError } = await supabase
      .from("timetable_sessions")
      .insert(batch);
    if (retryError) {
      if (isSessionConflictError(retryError)) {
        throw new Error(
          "Some timetable sessions already exist for the same module, date, time, and room. Try auto schedule again."
        );
      }
      throw retryError;
    }
  }
}

export async function createTimetableSessions(params: {
  academicYear: string;
  rows: Array<
    Omit<TimetableSessionRow, "id" | "created_at" | "updated_at"> & {
      created_by?: string | null;
    }
  >;
}) {
  if (params.rows.length === 0) return;

  const academicYear = normalizeAcademicYear(params.academicYear);
  const seen = new Set<string>();
  const payload = params.rows
    .map((row) => ({
      ...row,
      academic_year: academicYear,
      session_date: normalizeSessionDate(row.session_date),
      start_time: normalizeSessionTime(row.start_time),
      end_time: normalizeSessionTime(row.end_time),
      room_code: String(row.room_code ?? "").trim(),
      module_instance_code: String(row.module_instance_code ?? "").trim(),
      updated_at: new Date().toISOString(),
    }))
    .filter((row) => {
      const key = sessionInsertIdentityKey(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (payload.length === 0) return;

  await ensureDefaultTimetableClassrooms();

  const moduleIds = payload.map((row) => row.timetable_module_id);
  const instanceCodes = payload.map((row) => row.module_instance_code);

  await deleteTimetableSessionsForModuleIds({ timetableModuleIds: moduleIds });
  await deleteTimetableSessionsForInstanceCodes({
    moduleInstanceCodes: instanceCodes,
  });

  await insertTimetableSessionBatches(payload);
}

function isWithinClosedRange(date: Date, start: Date, end: Date): boolean {
  const t = date.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

export async function buildExcludedIsoDatesForAcademicYear(academicYear: string) {
  const calendar = await getPublishedAcademicCalendar(academicYear);

  if (!calendar) {
    throw new Error(
      `No published academic calendar found for ${academicYear}. Please publish it first.`
    );
  }

  const start = parseIsoDate(calendar.start_date);

  if (!start) {
    throw new Error(`Invalid academic calendar start_date: ${calendar.start_date}`);
  }

  // Use an inclusive 1-year range from start_date for now.
  const end = addDays(start, 365);

  const breaks = await listAcademicCalendarBreaks(academicYear);

  const holidayRange = {
    fromInclusive: toIsoDateString(start),
    toInclusive: toIsoDateString(end),
  };

  const publicHolidays = await listHkPublicHolidays(holidayRange);

  const publicHolidayIsoDates = new Set<IsoDateString>();
  for (const holiday of publicHolidays) {
    const iso = normalizeHolidayIsoDate(holiday.holiday_date);
    if (iso) publicHolidayIsoDates.add(iso);
  }

  const schoolBreaks = breaks
    .map((br) => ({
      start: parseIsoDate(br.start_date),
      end: parseIsoDate(br.end_date),
    }))
    .filter((br): br is { start: Date; end: Date } => Boolean(br.start && br.end));

  const christmasStart = parseIsoDate(calendar.christmas_start ?? "");
  const christmasEnd = parseIsoDate(calendar.christmas_end ?? "");
  const cnyStart = parseIsoDate(calendar.cny_start ?? "");
  const cnyEnd = parseIsoDate(calendar.cny_end ?? "");

  return {
    start,
    end,
    publicHolidayIsoDates,
    schoolBreaks,
    christmasStart: christmasStart ?? null,
    christmasEnd: christmasEnd ?? null,
    cnyStart: cnyStart ?? null,
    cnyEnd: cnyEnd ?? null,
  };
}

export async function buildExcludedIsoDatesForTerm(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
}) {
  const calendarRow = await getPublishedAcademicCalendar(params.academicYear);

  if (!calendarRow) {
    throw new Error(
      `No published academic calendar found for ${params.academicYear}. Please publish it first.`
    );
  }

  const startDate = parseIsoDate(calendarRow.start_date);

  if (!startDate) {
    throw new Error(`Invalid academic calendar start_date: ${calendarRow.start_date}`);
  }

  const breaks = await listAcademicCalendarBreaks(params.academicYear);
  const schoolBreaks = breaks
    .map((br) => ({
      start: parseIsoDate(br.start_date),
      end: parseIsoDate(br.end_date),
    }))
    .filter((br): br is { start: Date; end: Date } => Boolean(br.start && br.end));

  const christmasStart = parseIsoDate(calendarRow.christmas_start ?? "");
  const christmasEnd = parseIsoDate(calendarRow.christmas_end ?? "");
  const cnyStart = parseIsoDate(calendarRow.cny_start ?? "");
  const cnyEnd = parseIsoDate(calendarRow.cny_end ?? "");

  const calendar = generateAcademicCalendar({
    startDate,
    christmasStart: christmasStart ?? null,
    christmasEnd: christmasEnd ?? null,
    cnyStart: cnyStart ?? null,
    cnyEnd: cnyEnd ?? null,
    publicHolidayIsoDates: new Set<IsoDateString>(),
    schoolBreaks,
  });

  const termSummary = calendar.terms.find((t) => t.term === params.term);

  if (!termSummary) {
    throw new Error(`Failed to resolve term ${params.term} for ${params.academicYear}.`);
  }

  const start = termSummary.termStartDate;
  const end = termSummary.termEndDate;

  const publicHolidays = await listHkPublicHolidays({
    fromInclusive: toIsoDateString(start),
    toInclusive: toIsoDateString(end),
  });

  const publicHolidayIsoDates = new Set<IsoDateString>();
  for (const holiday of publicHolidays) {
    const iso = normalizeHolidayIsoDate(holiday.holiday_date);
    if (iso) publicHolidayIsoDates.add(iso);
  }

  return {
    start,
    end,
    publicHolidayIsoDates,
    schoolBreaks,
    christmasStart: christmasStart ?? null,
    christmasEnd: christmasEnd ?? null,
    cnyStart: cnyStart ?? null,
    cnyEnd: cnyEnd ?? null,
  };
}

export function isDateExcludedForTeaching(
  date: Date,
  excluded:
    | Awaited<ReturnType<typeof buildExcludedIsoDatesForAcademicYear>>
    | Awaited<ReturnType<typeof buildExcludedIsoDatesForTerm>>
): boolean {
  // Exclude Sundays. (Allow Saturday classes.)
  const jsDay = date.getDay();
  if (jsDay === 0) return true;

  const iso = toIsoDateString(date);
  if (excluded.publicHolidayIsoDates.has(iso)) return true;

  if (
    excluded.christmasStart &&
    excluded.christmasEnd &&
    isWithinClosedRange(date, excluded.christmasStart, excluded.christmasEnd)
  ) {
    return true;
  }

  if (
    excluded.cnyStart &&
    excluded.cnyEnd &&
    isWithinClosedRange(date, excluded.cnyStart, excluded.cnyEnd)
  ) {
    return true;
  }

  for (const br of excluded.schoolBreaks) {
    if (isWithinClosedRange(date, br.start, br.end)) {
      return true;
    }
  }

  return false;
}

function overlaps(a: { start: string; end: string }, b: { start: string; end: string }) {
  return a.start < b.end && b.start < a.end;
}

export async function listFreeDatesForSlot(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  weekday: 1 | 2 | 3 | 4 | 5 | 6; // Mon..Sat (JS: 1..6)
  roomCode: string;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
}): Promise<IsoDateString[]> {
  const excluded = await buildExcludedIsoDatesForTerm({
    academicYear: params.academicYear,
    term: params.term,
  });

  const sessions = await listTimetableSessions({ academicYear: params.academicYear });

  const results: IsoDateString[] = [];
  let cursor = new Date(excluded.start.getTime());

  while (cursor.getTime() <= excluded.end.getTime()) {
    const jsDay = cursor.getDay();

    if (jsDay === params.weekday && !isDateExcludedForTeaching(cursor, excluded)) {
      const iso = toIsoDateString(cursor);

      const occupied = sessions.some((s) => {
        if (s.room_code !== params.roomCode) return false;
        if (String(s.session_date).slice(0, 10) !== iso) return false;
        if (s.status === "cancel") return false;
        return overlaps(
          { start: params.startTime, end: params.endTime },
          { start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5) }
        );
      });

      if (!occupied) {
        results.push(iso);
      }
    }

    cursor = addDays(cursor, 1);
  }

  return results;
}

export function addHoursToTime(startTime: string, hours: number) {
  const [hh, mm] = String(startTime ?? "00:00")
    .slice(0, 5)
    .split(":");
  const totalMinutes = Number(hh) * 60 + Number(mm) + hours * 60;
  const nextH = Math.floor(totalMinutes / 60) % 24;
  const nextM = totalMinutes % 60;
  return `${String(nextH).padStart(2, "0")}:${String(nextM).padStart(2, "0")}`;
}

export async function buildTeachingDatesForWeekday(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  weekday: 1 | 2 | 3 | 4 | 5 | 6;
}) {
  const excluded = await buildExcludedIsoDatesForTerm({
    academicYear: params.academicYear,
    term: params.term,
  });

  const dates: IsoDateString[] = [];
  let cursor = new Date(excluded.start.getTime());

  while (cursor.getTime() <= excluded.end.getTime()) {
    const jsDay = cursor.getDay();
    if (jsDay === params.weekday && !isDateExcludedForTeaching(cursor, excluded)) {
      dates.push(toIsoDateString(cursor));
    }
    cursor = addDays(cursor, 1);
  }

  return dates;
}

export async function deleteWeeklyPlacementSessions(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  moduleInstanceCode: string;
  weekday: 1 | 2 | 3 | 4 | 5 | 6;
  startTime: string;
  endTime: string;
  roomCode: string;
}) {
  const code = String(params.moduleInstanceCode ?? "").trim();
  const roomCode = String(params.roomCode ?? "").trim();
  if (!code || !roomCode) return;

  const dates = await buildTeachingDatesForWeekday({
    academicYear: params.academicYear,
    term: params.term,
    weekday: params.weekday,
  });

  if (dates.length === 0) return;

  const startNorm = normalizeSessionTime(params.startTime);
  const endNorm = normalizeSessionTime(params.endTime);

  for (const batch of chunkValues(dates, 50)) {
    const { error } = await supabase
      .from("timetable_sessions")
      .delete()
      .eq("academic_year", normalizeAcademicYear(params.academicYear))
      .eq("module_instance_code", code)
      .eq("room_code", roomCode)
      .eq("start_time", startNorm)
      .eq("end_time", endNorm)
      .in("session_date", batch);

    if (error) throw error;
  }
}

export async function insertWeeklyPlacementSessions(params: {
  academicYear: string;
  rows: Array<
    Omit<TimetableSessionRow, "id" | "created_at" | "updated_at"> & {
      created_by?: string | null;
    }
  >;
}) {
  if (params.rows.length === 0) return;

  const academicYear = normalizeAcademicYear(params.academicYear);
  const seen = new Set<string>();
  const payload = params.rows
    .map((row) => ({
      ...row,
      academic_year: academicYear,
      session_date: normalizeSessionDate(row.session_date),
      start_time: normalizeSessionTime(row.start_time),
      end_time: normalizeSessionTime(row.end_time),
      room_code: String(row.room_code ?? "").trim(),
      module_instance_code: String(row.module_instance_code ?? "").trim(),
      updated_at: new Date().toISOString(),
    }))
    .filter((row) => {
      const key = sessionInsertIdentityKey(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (payload.length === 0) return;

  await ensureDefaultTimetableClassrooms();
  await insertTimetableSessionBatches(payload);
}

