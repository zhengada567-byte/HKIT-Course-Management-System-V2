import { supabase } from "../lib/supabase";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { normalizeAcademicYear, sanitizeAcademicYearForFilename } from "../lib/utils";
import {
  generateAcademicCalendar,
  getMonthGridIsoRange,
  normalizeHolidayIsoDate,
  parseIsoDate,
  toIsoDateString,
  type AcademicCalendarResult,
  type IsoDateString,
  type WeekRange,
} from "../lib/academicCalendar";

export interface AcademicCalendarRow {
  id: string;
  academic_year: string;
  start_date: string;
  christmas_start: string | null;
  christmas_end: string | null;
  cny_start: string | null;
  cny_end: string | null;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AcademicCalendarBreakRow {
  id: string;
  academic_year: string;
  break_name: string;
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
}

export interface AcademicCalendarTimeBreakRow {
  id: string;
  academic_year: string;
  break_name: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  created_at: string;
  updated_at: string;
}

export interface HkPublicHolidayRow {
  holiday_date: string;
  holiday_name: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface PublicHolidayForDisplay {
  date: IsoDateString;
  name: string;
}

function asDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  return parseIsoDate(value) ?? null;
}

function requireDate(value: string, label: string): Date {
  const parsed = parseIsoDate(value);
  if (!parsed) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

export async function getAcademicCalendarDraft(
  academicYear: string
): Promise<AcademicCalendarRow | null> {
  const year = normalizeAcademicYear(academicYear);

  const { data, error } = await supabase
    .from("academic_calendars")
    .select("*")
    .eq("academic_year", year)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as AcademicCalendarRow | null;
}

export async function getPublishedAcademicCalendar(
  academicYear: string
): Promise<AcademicCalendarRow | null> {
  const year = normalizeAcademicYear(academicYear);

  const { data, error } = await supabase
    .from("academic_calendars")
    .select("*")
    .eq("academic_year", year)
    .not("published_at", "is", null)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as AcademicCalendarRow | null;
}

export async function upsertAcademicCalendarDraft(params: {
  academicYear: string;
  startDate: string;
  christmasStart?: string | null;
  christmasEnd?: string | null;
  cnyStart?: string | null;
  cnyEnd?: string | null;
  updatedBy?: string;
}) {
  const academicYear = normalizeAcademicYear(params.academicYear);

  // Basic validation (YYYY-MM-DD).
  requireDate(params.startDate, "start_date");
  if (params.christmasStart) requireDate(params.christmasStart, "christmas_start");
  if (params.christmasEnd) requireDate(params.christmasEnd, "christmas_end");
  if (params.cnyStart) requireDate(params.cnyStart, "cny_start");
  if (params.cnyEnd) requireDate(params.cnyEnd, "cny_end");

  const payload = {
    academic_year: academicYear,
    start_date: params.startDate,
    christmas_start: params.christmasStart ?? null,
    christmas_end: params.christmasEnd ?? null,
    cny_start: params.cnyStart ?? null,
    cny_end: params.cnyEnd ?? null,
    updated_at: new Date().toISOString(),
  } as Record<string, unknown>;

  // Keep this optional, because app auth is not Supabase Auth.
  if (params.updatedBy) {
    payload.published_by = payload.published_by ?? null;
  }

  const { error } = await supabase.from("academic_calendars").upsert(payload, {
    onConflict: "academic_year",
  });

  if (error) throw error;
}

export async function publishAcademicCalendar(params: {
  academicYear: string;
  publishedBy?: string;
}) {
  const academicYear = normalizeAcademicYear(params.academicYear);

  const { error } = await supabase
    .from("academic_calendars")
    .update({
      published_at: new Date().toISOString(),
      published_by: params.publishedBy ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("academic_year", academicYear);

  if (error) throw error;
}

export async function listAcademicCalendarBreaks(
  academicYear: string
): Promise<AcademicCalendarBreakRow[]> {
  const year = normalizeAcademicYear(academicYear);

  const { data, error } = await supabase
    .from("academic_calendar_breaks")
    .select("*")
    .eq("academic_year", year)
    .order("start_date", { ascending: true });

  if (error) throw error;
  return (data ?? []) as AcademicCalendarBreakRow[];
}

export async function listAcademicCalendarTimeBreaks(
  academicYear: string
): Promise<AcademicCalendarTimeBreakRow[]> {
  const year = normalizeAcademicYear(academicYear);

  const { data, error } = await supabase
    .from("academic_calendar_time_breaks")
    .select("*")
    .eq("academic_year", year)
    .order("start_date", { ascending: true });

  if (error) throw error;

  return (data ?? []) as AcademicCalendarTimeBreakRow[];
}

export async function upsertAcademicCalendarBreak(params: {
  id?: string;
  academicYear: string;
  breakName: string;
  startDate: string;
  endDate: string;
}) {
  const year = normalizeAcademicYear(params.academicYear);

  requireDate(params.startDate, "break start_date");
  requireDate(params.endDate, "break end_date");

  const payload = {
    id: params.id,
    academic_year: year,
    break_name: params.breakName.trim(),
    start_date: params.startDate,
    end_date: params.endDate,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("academic_calendar_breaks")
    .upsert(payload, { onConflict: "id" });

  if (error) throw error;
}

export async function upsertAcademicCalendarTimeBreak(params: {
  id?: string;
  academicYear: string;
  breakName: string;
  startDate: string;
  endDate: string;
  startTime: string; // HH:mm (or HH:mm:ss)
  endTime: string; // HH:mm (or HH:mm:ss)
}) {
  const year = normalizeAcademicYear(params.academicYear);

  requireDate(params.startDate, "break start_date");
  requireDate(params.endDate, "break end_date");

  const payload = {
    id: params.id,
    academic_year: year,
    break_name: params.breakName.trim(),
    start_date: params.startDate,
    end_date: params.endDate,
    start_time: String(params.startTime).trim(),
    end_time: String(params.endTime).trim(),
    updated_at: new Date().toISOString(),
  } as Record<string, unknown>;

  const { error } = await supabase
    .from("academic_calendar_time_breaks")
    .upsert(payload, { onConflict: "id" });

  if (error) throw error;
}

export async function deleteAcademicCalendarTimeBreak(id: string) {
  const { error } = await supabase
    .from("academic_calendar_time_breaks")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

export async function deleteAcademicCalendarBreak(id: string) {
  const { error } = await supabase
    .from("academic_calendar_breaks")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

export async function listHkPublicHolidays(params: {
  fromInclusive: IsoDateString;
  toInclusive: IsoDateString;
}): Promise<HkPublicHolidayRow[]> {
  const { data, error } = await supabase
    .from("hk_public_holidays")
    .select("*")
    .gte("holiday_date", params.fromInclusive)
    .lte("holiday_date", params.toInclusive)
    .order("holiday_date", { ascending: true });

  if (error) throw error;
  return (data ?? []) as HkPublicHolidayRow[];
}

type HkHolidayIcsLanguage = "en" | "tc" | "sc";

function hkPublicHolidaysIcsUrl(language: HkHolidayIcsLanguage = "en"): string {
  return `/api/hk-public-holidays-ics/${language}`;
}

let ensureHolidaysPromise: Promise<void> | null = null;
const cached1823HolidaysByLang = new Map<
  HkHolidayIcsLanguage,
  Array<{ date: IsoDateString; name: string }>
>();

export async function ensureHkPublicHolidaysInDatabase(): Promise<void> {
  if (!ensureHolidaysPromise) {
    ensureHolidaysPromise = (async () => {
      const { count, error } = await supabase
        .from("hk_public_holidays")
        .select("*", { count: "exact", head: true });

      if (error) throw error;
      if ((count ?? 0) > 0) return;

      await updateHkPublicHolidaysFrom1823({ language: "en" });
    })().catch((error) => {
      ensureHolidaysPromise = null;
      throw error;
    });
  }

  try {
    await ensureHolidaysPromise;
  } catch {
    // Calendar display can still fall back to the live 1823 feed.
  }
}

async function fetchAll1823PublicHolidays(
  language: HkHolidayIcsLanguage = "en"
): Promise<Array<{ date: IsoDateString; name: string }>> {
  const cached = cached1823HolidaysByLang.get(language);
  if (cached) return cached;

  const res = await fetch(hkPublicHolidaysIcsUrl(language));
  if (!res.ok) {
    throw new Error(`Failed to fetch public holidays: HTTP ${res.status}`);
  }

  const holidays = parse1823Ics(await res.text());
  cached1823HolidaysByLang.set(language, holidays);
  return holidays;
}

async function fetch1823PublicHolidaysInRange(params: {
  fromInclusive: IsoDateString;
  toInclusive: IsoDateString;
}): Promise<PublicHolidayForDisplay[]> {
  const all = await fetchAll1823PublicHolidays();

  return all
    .filter(
      (holiday) =>
        holiday.date >= params.fromInclusive && holiday.date <= params.toInclusive
    )
    .map((holiday) => ({ date: holiday.date, name: holiday.name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function upsertPublicHolidayRows(
  holidays: Array<{ date: IsoDateString; name: string }>
): Promise<void> {
  if (holidays.length === 0) return;

  const now = new Date().toISOString();
  const payload = holidays.map((holiday) => ({
    holiday_date: holiday.date,
    holiday_name: holiday.name,
    source: "1823",
    updated_at: now,
  }));

  const batchSize = 200;
  for (let i = 0; i < payload.length; i += batchSize) {
    const batch = payload.slice(i, i + batchSize);
    const { error } = await supabase
      .from("hk_public_holidays")
      .upsert(batch, { onConflict: "holiday_date" });

    if (error) throw error;
  }
}

export async function loadPublicHolidaysForRange(params: {
  fromInclusive: IsoDateString;
  toInclusive: IsoDateString;
}): Promise<PublicHolidayForDisplay[]> {
  await ensureHkPublicHolidaysInDatabase();

  const byDate = new Map<IsoDateString, string>();

  try {
    const dbRows = await listHkPublicHolidays(params);
    for (const row of dbRows) {
      const date = normalizeHolidayIsoDate(String(row.holiday_date ?? ""));
      if (
        date &&
        date >= params.fromInclusive &&
        date <= params.toInclusive
      ) {
        byDate.set(
          date,
          String(row.holiday_name ?? "Public Holiday").trim() || "Public Holiday"
        );
      }
    }
  } catch {
    // Continue with the live 1823 feed if DB read fails.
  }

  try {
    const remote = await fetch1823PublicHolidaysInRange(params);
    const missing: Array<{ date: IsoDateString; name: string }> = [];

    for (const holiday of remote) {
      if (!byDate.has(holiday.date)) {
        byDate.set(holiday.date, holiday.name);
        missing.push(holiday);
      }
    }

    if (missing.length > 0) {
      void upsertPublicHolidayRows(missing).catch(() => undefined);
    }
  } catch {
    // DB-only fallback.
  }

  return Array.from(byDate.entries())
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function filterPublicHolidaysInMonth(
  holidays: PublicHolidayForDisplay[],
  month: Date
): PublicHolidayForDisplay[] {
  const monthPrefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;

  return holidays
    .filter((holiday) => holiday.date.startsWith(monthPrefix))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function loadPublicHolidaysForCalendarDisplay(params: {
  selectedMonth: Date;
  timelineWeeks?: WeekRange[];
}): Promise<PublicHolidayForDisplay[]> {
  const { fromInclusive: gridFrom, toInclusive: gridTo } = getMonthGridIsoRange(
    params.selectedMonth
  );

  let fromInclusive = gridFrom;
  let toInclusive = gridTo;

  const weeks = params.timelineWeeks;
  if (weeks && weeks.length > 0) {
    const timelineFrom = toIsoDateString(weeks[0]!.startMonday);
    const timelineTo = toIsoDateString(weeks[weeks.length - 1]!.endSunday);
    if (timelineFrom < fromInclusive) fromInclusive = timelineFrom;
    if (timelineTo > toInclusive) toInclusive = timelineTo;
  }

  return loadPublicHolidaysForRange({ fromInclusive, toInclusive });
}

/**
 * Update HK public holidays by fetching the official 1823 iCal feed.
 *
 * Notes:
 * - Runs client-side (Netlify static app).
 * - Saves into hk_public_holidays (upsert by holiday_date).
 */
export async function updateHkPublicHolidaysFrom1823(params: {
  language?: HkHolidayIcsLanguage;
}): Promise<{ total: number; insertedOrUpdated: number }> {
  const lang = params.language ?? "en";
  cached1823HolidaysByLang.delete(lang);
  ensureHolidaysPromise = null;

  const res = await fetch(hkPublicHolidaysIcsUrl(lang));
  if (!res.ok) {
    throw new Error(`Failed to fetch public holidays: HTTP ${res.status}`);
  }

  const ics = await res.text();
  const holidays = parse1823Ics(ics);
  cached1823HolidaysByLang.set(lang, holidays);

  if (holidays.length === 0) {
    return { total: 0, insertedOrUpdated: 0 };
  }

  await upsertPublicHolidayRows(holidays);

  return { total: holidays.length, insertedOrUpdated: holidays.length };
}

function unfoldIcsLines(ics: string): string[] {
  // RFC5545 line folding: lines beginning with space/tab continue previous line.
  const raw = String(ics ?? "").replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];

  for (const line of raw) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      const prev = lines[lines.length - 1] ?? "";
      lines[lines.length - 1] = prev + line.slice(1);
    } else {
      lines.push(line);
    }
  }

  return lines;
}

function parse1823Ics(ics: string): Array<{ date: IsoDateString; name: string }> {
  const lines = unfoldIcsLines(ics);
  const events: Array<{ date: IsoDateString; name: string }> = [];

  let inEvent = false;
  let dtStart: string | null = null;
  let summary: string | null = null;

  const flush = () => {
    if (!dtStart || !summary) {
      dtStart = null;
      summary = null;
      return;
    }

    const date = parseIcsDate(dtStart);
    if (date) {
      events.push({ date, name: summary.trim() });
    }

    dtStart = null;
    summary = null;
  };

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      dtStart = null;
      summary = null;
      continue;
    }
    if (line === "END:VEVENT") {
      if (inEvent) flush();
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    if (line.startsWith("DTSTART")) {
      const [, value] = line.split(":", 2);
      dtStart = value?.trim() ?? null;
    } else if (line.startsWith("SUMMARY")) {
      const [, value] = line.split(":", 2);
      summary = value?.trim() ?? null;
    }
  }

  // Deduplicate by date (keep first).
  const seen = new Set<IsoDateString>();
  return events.filter((e) => {
    if (seen.has(e.date)) return false;
    seen.add(e.date);
    return true;
  });
}

function parseIcsDate(value: string): IsoDateString | null {
  // Common formats:
  // - YYYYMMDD
  // - YYYYMMDDT000000Z (we treat as date)
  const text = String(value ?? "").trim();
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(text);
  if (!match) return null;

  const iso = `${match[1]}-${match[2]}-${match[3]}` as IsoDateString;
  if (!parseIsoDate(iso)) return null;
  return iso;
}

export async function buildAcademicCalendarPreview(params: {
  academicYear: string;
  usePublished?: boolean;
}): Promise<AcademicCalendarResult> {
  const year = normalizeAcademicYear(params.academicYear);

  const calendarRow = params.usePublished
    ? await getPublishedAcademicCalendar(year)
    : await getAcademicCalendarDraft(year);

  if (!calendarRow) {
    throw new Error(`找不到學年 ${year} 的學年日曆設定。`);
  }

  const startDate = requireDate(calendarRow.start_date, "start_date");

  const christmasStart = asDate(calendarRow.christmas_start);
  const christmasEnd = asDate(calendarRow.christmas_end);
  const cnyStart = asDate(calendarRow.cny_start);
  const cnyEnd = asDate(calendarRow.cny_end);

  const breakRows = await listAcademicCalendarBreaks(year);
  const schoolBreaks = breakRows
    .map((row) => {
      const start = asDate(row.start_date);
      const end = asDate(row.end_date);
      if (!start || !end) return null;
      return { start, end };
    })
    .filter((row): row is { start: Date; end: Date } => row !== null);

  // Load holidays for an estimated timeline window (terms + inserted holiday weeks).
  const startMonday = new Date(startDate.getTime());
  startMonday.setDate(startMonday.getDate() - ((startMonday.getDay() + 6) % 7));
  const from = toIsoDateString(startMonday);
  const to = toIsoDateString(
    new Date(startMonday.getTime() + 70 * 7 * 24 * 3600 * 1000)
  );
  const holidays = await loadPublicHolidaysForRange({
    fromInclusive: from,
    toInclusive: to,
  });
  const holidaySet = new Set<IsoDateString>(holidays.map((holiday) => holiday.date));

  return generateAcademicCalendar({
    startDate,
    christmasStart,
    christmasEnd,
    cnyStart,
    cnyEnd,
    publicHolidayIsoDates: holidaySet,
    schoolBreaks,
  });
}

export async function downloadAcademicCalendarExcel(params: {
  academicYear: string;
  usePublished?: boolean;
}): Promise<{ fileName: string; sheetCount: number }> {
  const academicYear = normalizeAcademicYear(params.academicYear);
  const result = await buildAcademicCalendarPreview({
    academicYear,
    usePublished: params.usePublished ?? true,
  });

  const weeks = result.weeks.map((w) => ({
    "Week #": w.weekIndex,
    "Week Start (Mon)": toIsoDateString(w.startMonday),
    "Week End (Sun)": toIsoDateString(w.endSunday),
    "Is Holiday Week": w.isHolidayWeek ? "Y" : "N",
    "Holiday Reason": w.holidayWeekReason ?? "",
    Term: w.term ?? "",
    Category: w.category ?? "",
    "Term Week #": w.termWeekIndex ?? "",
    "Category Week #": w.termCategoryIndex ?? "",
  }));

  const termSummary = result.terms.map((t) => ({
    Term: t.term,
    "Term Start Date": toIsoDateString(t.termStartDate),
    "Term End Date": toIsoDateString(t.termEndDate),
    "Study Weeks": t.studyWeeks.count,
    "Study Weeks Range": `${toIsoDateString(t.studyWeeks.start)} → ${toIsoDateString(t.studyWeeks.end)}`,
    "Revision Weeks": t.revisionWeeks?.count ?? 0,
    "Revision Weeks Range": t.revisionWeeks
      ? `${toIsoDateString(t.revisionWeeks.start)} → ${toIsoDateString(t.revisionWeeks.end)}`
      : "",
    "Exam Weeks": t.examWeeks.count,
    "Exam Weeks Range": `${toIsoDateString(t.examWeeks.start)} → ${toIsoDateString(t.examWeeks.end)}`,
    "Marking Weeks": t.markingWeeks.count,
    "Marking Weeks Range": `${toIsoDateString(t.markingWeeks.start)} → ${toIsoDateString(t.markingWeeks.end)}`,
    Mon: t.studyWeekdayCounts.mon,
    Tue: t.studyWeekdayCounts.tue,
    Wed: t.studyWeekdayCounts.wed,
    Thu: t.studyWeekdayCounts.thu,
    Fri: t.studyWeekdayCounts.fri,
    "Total Study Days (PH excluded)": t.studyWeekdayCounts.total,
  }));

  // Load breaks (display only).
  const breaks = await listAcademicCalendarBreaks(academicYear);
  const breakRows = breaks.map((b) => ({
    "Academic Year": b.academic_year,
    Name: b.break_name,
    Start: b.start_date,
    End: b.end_date,
  }));

  // Load holidays covering the full 54-week window.
  const firstMonday = result.weeks[0]?.startMonday;
  const lastSunday = result.weeks[result.weeks.length - 1]?.endSunday;
  const holidayRows = firstMonday && lastSunday
    ? await listHkPublicHolidays({
        fromInclusive: toIsoDateString(firstMonday),
        toInclusive: toIsoDateString(lastSunday),
      })
    : [];

  const holidaySheetRows = holidayRows.map((h) => ({
    Date: h.holiday_date,
    Name: h.holiday_name,
    Source: h.source,
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      {
        "Academic Year": academicYear,
        "Generated At": new Date().toISOString(),
        "Warnings Count": result.warnings.length,
        Warnings: result.warnings.join(" | "),
      },
    ]),
    "Summary"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(termSummary),
    "Term Summary"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(weeks),
    "Weeks"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(holidaySheetRows),
    "HK Public Holidays"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(breakRows),
    "School Breaks"
  );

  const buffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  });

  const fileName = `academic_calendar_${sanitizeAcademicYearForFilename(
    academicYear
  )}.xlsx`;

  saveAs(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    fileName
  );

  return { fileName, sheetCount: workbook.SheetNames.length };
}

