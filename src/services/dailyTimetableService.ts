import {
  addDays,
  generateAcademicCalendar,
  parseIsoDate,
  toIsoDateString,
  type IsoDateString,
  type TermSummary,
  type WeekRange,
} from "../lib/academicCalendar";
import {
  buildSessionLabelAssignments,
  formatCancelledRemark,
  isBackupTimetableSession,
  parseCancelledLabelFromRemark,
  type TimetableSessionStatus,
} from "../lib/dailyTimetableSessionLabels";
import {
  buildSessionLabelSequence,
  isHdDailyTimetableModule,
  countStudyWeekdayOccurrences,
  studyWeekdayCountForJsDay,
  weekdayLabel,
  type DailySessionKind,
  type DailySessionLabelSlot,
} from "../lib/dailyTimetable";
import { sortDailyTimetableEntries } from "../lib/dailyTimetableEntrySort";
import { supabase } from "../lib/supabase";
import { normalizeAcademicYear } from "../lib/utils";
import {
  getPublishedAcademicCalendar,
  listAcademicCalendarBreaks,
  listHkPublicHolidays,
} from "./academicCalendarService";
import {
  buildExcludedIsoDatesForTerm,
  buildStudyWeekDatesForWeekday,
  isIsoDateInTermStudyWeek,
  listTimetableSessions,
  MAX_STUDY_WEEKS_PER_TERM,
  normalizeSessionDate,
  normalizeSessionTime,
  type TimetableScheduleTerm,
  type TimetableSessionRow,
} from "./timetableScheduleService";
import { listTimetableModules } from "./timetableService";
import { getProgrammeTypeByCode } from "./studyPlanService";
import type { ModuleRow, TimetableModuleRow } from "../types";

export interface DailyTimetableEntry {
  sessionId: string | null;
  timetableModuleId: string;
  moduleInstanceCode: string;
  moduleCode: string;
  moduleName: string | null;
  programmeCode: string;
  streamCode: string;
  moduleTerm: string;
  isHd: boolean;
  weekday: number;
  weekdayLabel: string;
  sessionLabel: string;
  sessionKind: DailySessionKind;
  status: TimetableSessionStatus;
  sessionDate: string;
  startTime: string;
  endTime: string;
  roomCode: string;
  teacherName: string | null;
  hasWeeklySession: boolean;
  sessionNumber: number | null;
  /** Spare weekly slot without an L/T label (beyond contact-hour count). */
  isBackup: boolean;
  remark: string | null;
}

export function partitionDailyModuleEntries(
  entries: DailyTimetableEntry[],
  drafts?: Record<string, { status?: TimetableSessionStatus }>
) {
  const scheduled: DailyTimetableEntry[] = [];
  const backup: DailyTimetableEntry[] = [];
  const cancelled: DailyTimetableEntry[] = [];

  for (const entry of entries) {
    const effectiveStatus =
      (entry.sessionId && drafts?.[entry.sessionId]?.status) || entry.status;

    if (effectiveStatus === "cancel") {
      cancelled.push(entry);
      continue;
    }

    if (entry.isBackup) {
      backup.push(entry);
      continue;
    }

    scheduled.push(entry);
  }

  return {
    scheduled: sortDailyTimetableEntries(scheduled),
    backup: sortDailyTimetableEntries(backup),
    cancelled: sortDailyTimetableEntries(cancelled),
  };
}

export interface DailyTimetableModulePlan {
  timetableModuleId: string;
  moduleInstanceCode: string;
  moduleCode: string;
  moduleName: string | null;
  programmeCode: string;
  streamCode: string;
  moduleTerm: string;
  isHd: boolean;
  weekday: number;
  weekdayLabel: string;
  teachingContactHours: number;
  tutorialContactHours: number;
  /** L/T labels required by contact-hour rules (e.g. HD = 12). */
  labelledSessionCount: number;
  /** Saved sessions that fall on a study-week date (max 14 per term). */
  weeklySlotCount: number;
  /** Saved sessions on revision/exam/marking weeks (legacy scheduling). */
  outsideStudyWeekSlotCount: number;
  /** Weekly slots beyond labelled count. */
  extraWeeklySlotCount: number;
  labelSequence: DailySessionLabelSlot[];
  entries: DailyTimetableEntry[];
  warnings: string[];
}

export interface DailyTimetableBuildResult {
  academicYear: string;
  term: TimetableScheduleTerm;
  termStartDate: string;
  termEndDate: string;
  modules: DailyTimetableModulePlan[];
  entriesByDate: Map<string, DailyTimetableEntry[]>;
  warnings: string[];
}

function moduleCatalogKey(programmeCode: string, moduleCode: string) {
  return `${String(programmeCode ?? "")
    .trim()
    .toUpperCase()}|${String(moduleCode ?? "")
    .trim()
    .toUpperCase()}`;
}

function resolveBaseModuleCode(row: TimetableModuleRow) {
  return String(row.base_module_code ?? row.module_instance_code ?? "")
    .trim()
    .split("-")[0];
}

function inferWeekdayFromSessions(sessions: TimetableSessionRow[]): number | null {
  const counts = new Map<number, number>();

  for (const session of sessions) {
    const iso = normalizeSessionDate(session.session_date);
    const parsed = parseIsoDate(iso);

    if (!parsed) continue;

    const day = parsed.getDay();
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  let bestDay: number | null = null;
  let bestCount = 0;

  for (const [day, count] of counts) {
    if (count > bestCount) {
      bestDay = day;
      bestCount = count;
    }
  }

  return bestDay;
}

function pickWeeklySlotTemplate(sessions: TimetableSessionRow[]) {
  const sorted = [...sessions].sort((a, b) => {
    const dateCompare = normalizeSessionDate(a.session_date).localeCompare(
      normalizeSessionDate(b.session_date)
    );

    if (dateCompare !== 0) return dateCompare;

    return normalizeSessionTime(a.start_time).localeCompare(
      normalizeSessionTime(b.start_time)
    );
  });

  const first = sorted[0];

  if (!first) {
    return null;
  }

  return {
    startTime: normalizeSessionTime(first.start_time),
    endTime: normalizeSessionTime(first.end_time),
    roomCode: String(first.room_code ?? "").trim(),
    teacherName: first.teacher_name ?? null,
  };
}

async function loadModuleCatalogHours() {
  const { data, error } = await supabase
    .from("modules")
    .select(
      "programme_code, module_code, module_teaching_contact_hours, module_tutorial_contact_hours"
    );

  if (error) throw error;

  const map = new Map<
    string,
    Pick<ModuleRow, "module_teaching_contact_hours" | "module_tutorial_contact_hours">
  >();

  for (const row of (data ?? []) as ModuleRow[]) {
    map.set(moduleCatalogKey(row.programme_code, row.module_code), {
      module_teaching_contact_hours: Number(row.module_teaching_contact_hours ?? 0),
      module_tutorial_contact_hours: Number(row.module_tutorial_contact_hours ?? 0),
    });
  }

  return map;
}

export async function loadTermCalendarContext(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
}) {
  const calendarRow = await getPublishedAcademicCalendar(params.academicYear);

  if (!calendarRow) {
    throw new Error(
      `No published academic calendar found for ${params.academicYear}. Publish the calendar first.`
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

  const excluded = await buildExcludedIsoDatesForTerm({
    academicYear: params.academicYear,
    term: params.term,
  });

  const publicHolidays = await listHkPublicHolidays({
    fromInclusive: toIsoDateString(excluded.start),
    toInclusive: toIsoDateString(excluded.end),
  });

  const publicHolidayIsoDates = new Set<IsoDateString>();

  for (const holiday of publicHolidays) {
    const iso = String(holiday.holiday_date ?? "").trim().slice(0, 10) as IsoDateString;

    if (iso) publicHolidayIsoDates.add(iso);
  }

  const generated = generateAcademicCalendar({
    startDate,
    christmasStart: christmasStart ?? null,
    christmasEnd: christmasEnd ?? null,
    cnyStart: cnyStart ?? null,
    cnyEnd: cnyEnd ?? null,
    publicHolidayIsoDates,
    schoolBreaks,
  });

  const termSummary = generated.terms.find((row) => row.term === params.term);

  if (!termSummary) {
    throw new Error(`Term ${params.term} not found in academic calendar.`);
  }

  const termWeeks = generated.weeks.filter((week) => week.term === params.term);

  return {
    excluded,
    termSummary,
    termWeeks,
  };
}

function buildModuleDailyPlan(params: {
  module: TimetableModuleRow;
  sessions: TimetableSessionRow[];
  programmeType: string | null;
  teachingContactHours: number;
  tutorialContactHours: number;
  termSummary: TermSummary;
  termWeeks: WeekRange[];
  excluded: Awaited<ReturnType<typeof buildExcludedIsoDatesForTerm>>;
}): DailyTimetableModulePlan | null {
  const activeSessions = params.sessions.filter((row) => row.status !== "cancel");
  const studyWeekSessions = activeSessions.filter((row) =>
    isIsoDateInTermStudyWeek(row.session_date, params.termWeeks)
  );
  const outsideStudyWeekSessions = activeSessions.filter(
    (row) => !isIsoDateInTermStudyWeek(row.session_date, params.termWeeks)
  );

  if (studyWeekSessions.length === 0) {
    return null;
  }

  const weekday = inferWeekdayFromSessions(studyWeekSessions);

  if (weekday === null) {
    return null;
  }

  const programmeCode = String(params.module.programme_code ?? "").trim();
  const isHd = isHdDailyTimetableModule({
    programmeCode,
    programmeType: params.programmeType,
  });

  const studyWeekdayOccurrences = isHd
    ? studyWeekSessions.length
    : weekday >= 1 && weekday <= 5
      ? studyWeekdayCountForJsDay(params.termSummary, weekday)
      : countStudyWeekdayOccurrences({
          termWeeks: params.termWeeks,
          weekday,
          publicHolidayIsoDates: params.excluded.publicHolidayIsoDates,
        });

  const labelSequence = buildSessionLabelSequence({
    programmeCode,
    programmeType: params.programmeType,
    teachingContactHours: params.teachingContactHours,
    studyWeekdayOccurrences,
  });

  const slotTemplate = pickWeeklySlotTemplate(studyWeekSessions);

  const sortedSessions = [...studyWeekSessions].sort((a, b) => {
    const dateCompare = normalizeSessionDate(a.session_date).localeCompare(
      normalizeSessionDate(b.session_date)
    );

    if (dateCompare !== 0) return dateCompare;

    return normalizeSessionTime(a.start_time).localeCompare(
      normalizeSessionTime(b.start_time)
    );
  });

  const projectedDates = buildStudyWeekDatesForWeekday({
    termWeeks: params.termWeeks,
    weekday: weekday as 1 | 2 | 3 | 4 | 5 | 6,
    excluded: params.excluded,
  });

  const warnings: string[] = [];

  if (labelSequence.length > projectedDates.length) {
    warnings.push(
      `Only ${projectedDates.length} valid ${weekdayLabel(weekday)} date(s) in term; expected ${labelSequence.length} labelled sessions.`
    );
  }

  if (outsideStudyWeekSessions.length > 0) {
    warnings.push(
      `${outsideStudyWeekSessions.length} session(s) are on revision/exam/marking weeks (not study weeks). Max study weeks per term is ${MAX_STUDY_WEEKS_PER_TERM}. Use "Remove non-study-week sessions" on Daily Timetable or re-run auto-schedule.`
    );
  }

  if (studyWeekSessions.length > MAX_STUDY_WEEKS_PER_TERM) {
    warnings.push(
      `${studyWeekSessions.length} study-week session(s) exceeds calendar maximum of ${MAX_STUDY_WEEKS_PER_TERM} study weeks.`
    );
  }

  const template = slotTemplate ?? {
    startTime: "09:00:00",
    endTime: "13:00:00",
    roomCode: "",
    teacherName: null,
  };

  const entries: DailyTimetableEntry[] = [];

  for (let index = 0; index < labelSequence.length; index += 1) {
    const slot = labelSequence[index];
    const matched = sortedSessions[index];
    const sessionDate =
      matched != null
        ? normalizeSessionDate(matched.session_date)
        : projectedDates[index];

    if (!sessionDate) break;

    entries.push({
      sessionId: matched?.id ?? null,
      timetableModuleId: params.module.id,
      moduleInstanceCode: String(params.module.module_instance_code ?? "").trim(),
      moduleCode:
        resolveBaseModuleCode(params.module) ||
        String(params.module.module_instance_code ?? "").trim(),
      moduleName: params.module.module_name,
      programmeCode,
      streamCode: String(params.module.stream_code ?? "").trim(),
      moduleTerm: String(params.module.module_term ?? "").trim(),
      isHd,
      weekday,
      weekdayLabel: weekdayLabel(weekday),
      sessionLabel: matched?.session_label?.trim() || slot.label,
      sessionKind:
        (matched?.session_kind as DailySessionKind | null) ?? slot.kind,
      status: (matched?.status as TimetableSessionStatus) ?? "normal",
      sessionDate,
      startTime: matched
        ? normalizeSessionTime(matched.start_time)
        : template.startTime,
      endTime: matched ? normalizeSessionTime(matched.end_time) : template.endTime,
      roomCode: matched?.room_code ?? template.roomCode,
      teacherName: matched?.teacher_name ?? template.teacherName,
      hasWeeklySession: Boolean(matched),
      sessionNumber: matched?.session_number ?? index + 1,
      isBackup: false,
      remark: matched?.remark?.trim() || null,
    });
  }

  for (let index = labelSequence.length; index < sortedSessions.length; index += 1) {
    const matched = sortedSessions[index]!;

    entries.push({
      sessionId: matched.id,
      timetableModuleId: params.module.id,
      moduleInstanceCode: String(params.module.module_instance_code ?? "").trim(),
      moduleCode:
        resolveBaseModuleCode(params.module) ||
        String(params.module.module_instance_code ?? "").trim(),
      moduleName: params.module.module_name,
      programmeCode,
      streamCode: String(params.module.stream_code ?? "").trim(),
      moduleTerm: String(params.module.module_term ?? "").trim(),
      isHd,
      weekday,
      weekdayLabel: weekdayLabel(weekday),
      sessionLabel: "Backup",
      sessionKind: "teaching",
      status: matched.status as TimetableSessionStatus,
      sessionDate: normalizeSessionDate(matched.session_date),
      startTime: normalizeSessionTime(matched.start_time),
      endTime: normalizeSessionTime(matched.end_time),
      roomCode: matched.room_code,
      teacherName: matched.teacher_name,
      hasWeeklySession: true,
      sessionNumber: null,
      isBackup: true,
      remark: matched.remark?.trim() || null,
    });
  }

  const labelledSessionCount = labelSequence.length;
  const weeklySlotCount = studyWeekSessions.length;
  const outsideStudyWeekSlotCount = outsideStudyWeekSessions.length;
  const extraWeeklySlotCount = Math.max(0, weeklySlotCount - labelledSessionCount);

  if (extraWeeklySlotCount > 0) {
    warnings.push(
      isHd
        ? `Weekly timetable has ${weeklySlotCount} slot(s) on ${weekdayLabel(weekday)} (one per teaching week). Daily labels use the first ${labelledSessionCount} only (9 lectures + 3 tutorials). ${extraWeeklySlotCount} extra slot(s) are not labelled.`
        : `Weekly timetable has ${weeklySlotCount} slot(s); daily plan labels ${labelledSessionCount} (${labelSequence.filter((s) => s.kind === "teaching").length} teaching + ${labelSequence.filter((s) => s.kind === "tutorial").length} tutorial).`
    );
  } else if (weeklySlotCount < labelledSessionCount) {
    warnings.push(
      `Only ${weeklySlotCount} study-week slot(s) saved; need ${labelledSessionCount} for full L/T sequence. Run auto-schedule or add weekly sessions in Make Timetable.`
    );
  }

  return {
    timetableModuleId: params.module.id,
    moduleInstanceCode: String(params.module.module_instance_code ?? "").trim(),
    moduleCode:
      resolveBaseModuleCode(params.module) ||
      String(params.module.module_instance_code ?? "").trim(),
    moduleName: params.module.module_name,
    programmeCode,
    streamCode: String(params.module.stream_code ?? "").trim(),
    moduleTerm: String(params.module.module_term ?? "").trim(),
    isHd,
    weekday,
    weekdayLabel: weekdayLabel(weekday),
    teachingContactHours: params.teachingContactHours,
    tutorialContactHours: params.tutorialContactHours,
    labelledSessionCount,
    weeklySlotCount,
    outsideStudyWeekSlotCount,
    extraWeeklySlotCount,
    labelSequence,
    entries,
    warnings,
  };
}

export async function buildDailyTimetable(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  programmeCode?: string;
}): Promise<DailyTimetableBuildResult> {
  const academicYear = normalizeAcademicYear(params.academicYear);
  const { excluded, termSummary, termWeeks } = await loadTermCalendarContext({
    academicYear,
    term: params.term,
  });

  const [sessions, timetableModules, catalogHours] = await Promise.all([
    listTimetableSessions({ academicYear }),
    listTimetableModules({
      academicYear,
      programmeCode: params.programmeCode,
    }),
    loadModuleCatalogHours(),
  ]);

  const programmeTypes = new Map<string, string | null>();
  const programmeCodes = [
    ...new Set(timetableModules.map((row) => String(row.programme_code ?? "").trim())),
  ];

  await Promise.all(
    programmeCodes.map(async (code) => {
      if (!code) return;
      programmeTypes.set(code, (await getProgrammeTypeByCode(code)) ?? null);
    })
  );

  const moduleById = new Map(
    timetableModules.map((row) => [row.id, row] as const)
  );

  const sessionsByModuleId = new Map<string, TimetableSessionRow[]>();

  for (const session of sessions) {
    if (session.status === "cancel") continue;

    const module = moduleById.get(session.timetable_module_id);

    if (!module) continue;

    if (module.module_term !== params.term) continue;

    const bucket = sessionsByModuleId.get(session.timetable_module_id) ?? [];
    bucket.push(session);
    sessionsByModuleId.set(session.timetable_module_id, bucket);
  }

  const modules: DailyTimetableModulePlan[] = [];
  const globalWarnings: string[] = [];

  for (const module of timetableModules) {
    if (module.module_term !== params.term) continue;

    const moduleSessions = sessionsByModuleId.get(module.id) ?? [];
    const baseCode = resolveBaseModuleCode(module);
    const hours =
      catalogHours.get(moduleCatalogKey(module.programme_code, baseCode)) ??
      catalogHours.get(
        moduleCatalogKey(module.programme_code, String(module.module_instance_code ?? ""))
      );

    const plan = buildModuleDailyPlan({
      module,
      sessions: moduleSessions,
      programmeType: programmeTypes.get(module.programme_code) ?? null,
      teachingContactHours: hours?.module_teaching_contact_hours ?? 0,
      tutorialContactHours: hours?.module_tutorial_contact_hours ?? 0,
      termSummary,
      termWeeks,
      excluded,
    });

    if (!plan) {
      const studyOnly = moduleSessions.filter((row) =>
        isIsoDateInTermStudyWeek(row.session_date, termWeeks)
      );

      if (moduleSessions.length === 0) {
        globalWarnings.push(
          `${module.module_instance_code} (${module.module_term}): no rows in weekly timetable for ${params.term} term — complete Step 4 (Schedule) in Make Timetable for this module first.`
        );
      } else if (studyOnly.length === 0) {
        globalWarnings.push(
          `${module.module_instance_code}: ${moduleSessions.length} session(s) only on non-study weeks (revision/exam) — remove them or re-run auto-schedule.`
        );
      } else {
        globalWarnings.push(
          `${module.module_instance_code}: weekly sessions exist but could not infer weekday — skipped.`
        );
      }

      continue;
    }

    modules.push(plan);
    globalWarnings.push(...plan.warnings.map((w) => `${plan.moduleInstanceCode}: ${w}`));
  }

  modules.sort((a, b) =>
    a.moduleInstanceCode.localeCompare(b.moduleInstanceCode)
  );

  const entriesByDate = new Map<string, DailyTimetableEntry[]>();

  for (const plan of modules) {
    for (const entry of plan.entries) {
      const bucket = entriesByDate.get(entry.sessionDate) ?? [];
      bucket.push(entry);
      entriesByDate.set(entry.sessionDate, bucket);
    }
  }

  for (const [, bucket] of entriesByDate) {
    bucket.sort((a, b) => {
      const timeCompare = a.startTime.localeCompare(b.startTime);

      if (timeCompare !== 0) return timeCompare;

      return a.moduleInstanceCode.localeCompare(b.moduleInstanceCode);
    });
  }

  return {
    academicYear,
    term: params.term,
    termStartDate: toIsoDateString(termSummary.termStartDate),
    termEndDate: toIsoDateString(termSummary.termEndDate),
    modules,
    entriesByDate,
    warnings: globalWarnings,
  };
}

export async function loadModuleCatalogContext(timetableModuleId: string) {
  const { data: module, error } = await supabase
    .from("timetable_modules")
    .select("*")
    .eq("id", timetableModuleId)
    .maybeSingle();

  if (error) throw error;
  if (!module) throw new Error("Timetable module not found.");

  const row = module as TimetableModuleRow;
  const catalogHours = await loadModuleCatalogHours();
  const baseCode = resolveBaseModuleCode(row);
  const hours =
    catalogHours.get(moduleCatalogKey(row.programme_code, baseCode)) ??
    catalogHours.get(
      moduleCatalogKey(row.programme_code, String(row.module_instance_code ?? ""))
    );

  const programmeType = (await getProgrammeTypeByCode(row.programme_code)) ?? null;

  return {
    module: row,
    programmeType,
    teachingContactHours: hours?.module_teaching_contact_hours ?? 0,
    tutorialContactHours: hours?.module_tutorial_contact_hours ?? 0,
  };
}

async function listSessionsForTimetableModule(timetableModuleId: string) {
  const { data, error } = await supabase
    .from("timetable_sessions")
    .select("*")
    .eq("timetable_module_id", timetableModuleId)
    .order("session_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) throw error;

  return (data ?? []) as TimetableSessionRow[];
}

export async function applyDailyLabelsToTimetableModule(
  timetableModuleId: string,
  termWeeks: WeekRange[],
  termSummary: TermSummary,
  excluded: Awaited<ReturnType<typeof buildExcludedIsoDatesForTerm>>
) {
  const { module, programmeType, teachingContactHours, tutorialContactHours } =
    await loadModuleCatalogContext(timetableModuleId);

  const sessions = await listSessionsForTimetableModule(timetableModuleId);
  const studyWeekSessions = sessions.filter((row) =>
    isIsoDateInTermStudyWeek(row.session_date, termWeeks)
  );

  const weekday = inferWeekdayFromSessions(
    studyWeekSessions.filter((row) => row.status !== "cancel")
  );

  if (weekday === null) {
    return { updatedCount: 0 };
  }

  const programmeCode = String(module.programme_code ?? "").trim();
  const isHd = isHdDailyTimetableModule({ programmeCode, programmeType });
  const studyWeekdayOccurrences = isHd
    ? studyWeekSessions.filter((row) => row.status !== "cancel").length
    : weekday >= 1 && weekday <= 5
      ? studyWeekdayCountForJsDay(termSummary, weekday)
      : countStudyWeekdayOccurrences({
          termWeeks,
          weekday,
          publicHolidayIsoDates: excluded.publicHolidayIsoDates,
        });

  const labelSequence = buildSessionLabelSequence({
    programmeCode,
    programmeType,
    teachingContactHours,
    studyWeekdayOccurrences,
  });

  const existingLabels = new Map(
    sessions.map((row) => [row.id, row.session_label ?? null])
  );

  const assignments = buildSessionLabelAssignments({
    labelSequence,
    sessions: studyWeekSessions.map((row) => ({
      id: row.id,
      status: row.status as TimetableSessionStatus,
      session_date: normalizeSessionDate(row.session_date),
      start_time: normalizeSessionTime(row.start_time),
    })),
    existingLabelsById: existingLabels,
  });

  const now = new Date().toISOString();
  let updatedCount = 0;

  for (const assignment of assignments) {
    const { error } = await supabase
      .from("timetable_sessions")
      .update({
        session_label: assignment.session_label,
        session_kind: assignment.session_kind,
        session_number: assignment.session_number,
        updated_at: now,
      })
      .eq("id", assignment.id);

    if (error) throw error;
    updatedCount += 1;
  }

  return { updatedCount };
}

export async function persistDailyTimetableLabels(
  result: DailyTimetableBuildResult
) {
  const { termWeeks, excluded, termSummary } = await loadTermCalendarContext({
    academicYear: result.academicYear,
    term: result.term,
  });

  let totalUpdated = 0;

  for (const plan of result.modules) {
    const { updatedCount } = await applyDailyLabelsToTimetableModule(
      plan.timetableModuleId,
      termWeeks,
      termSummary,
      excluded
    );
    totalUpdated += updatedCount;
  }

  return { updatedCount: totalUpdated, moduleCount: result.modules.length };
}

function sessionRowToDailyEntry(
  session: TimetableSessionRow,
  module: TimetableModuleRow,
  programmeType: string | null
): DailyTimetableEntry {
  const iso = normalizeSessionDate(session.session_date);
  const parsed = parseIsoDate(iso);
  const weekday = parsed?.getDay() ?? 0;
  const programmeCode = String(module.programme_code ?? "").trim();

  return {
    sessionId: session.id,
    timetableModuleId: module.id,
    moduleInstanceCode: String(module.module_instance_code ?? "").trim(),
    moduleCode:
      resolveBaseModuleCode(module) ||
      String(module.module_instance_code ?? "").trim(),
    moduleName: module.module_name,
    programmeCode,
    streamCode: String(module.stream_code ?? "").trim(),
    moduleTerm: String(module.module_term ?? "").trim(),
    isHd: isHdDailyTimetableModule({ programmeCode, programmeType }),
    weekday,
    weekdayLabel: weekdayLabel(weekday),
    sessionLabel:
      session.status === "cancel"
        ? parseCancelledLabelFromRemark(session.remark) ||
          session.session_label?.trim() ||
          "Cancelled"
        : session.session_label?.trim() ||
          (isBackupTimetableSession({
            status: session.status as TimetableSessionStatus,
            session_label: session.session_label,
          })
            ? "Backup"
            : "—"),
    sessionKind: (session.session_kind as DailySessionKind | null) ?? "teaching",
    status: session.status as TimetableSessionStatus,
    sessionDate: iso,
    startTime: normalizeSessionTime(session.start_time),
    endTime: normalizeSessionTime(session.end_time),
    roomCode: session.room_code,
    teacherName: session.teacher_name,
    hasWeeklySession: true,
    sessionNumber: session.session_number,
    isBackup: isBackupTimetableSession({
      status: session.status as TimetableSessionStatus,
      session_label: session.session_label,
    }),
    remark: session.remark?.trim() || null,
  };
}

export async function loadProgrammeDailyTimetable(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  programmeCode: string;
  streamCode?: string;
}): Promise<DailyTimetableBuildResult> {
  const academicYear = normalizeAcademicYear(params.academicYear);
  const programmeCode = String(params.programmeCode ?? "").trim();

  if (!programmeCode) {
    throw new Error("Programme code is required.");
  }

  const { termSummary, termWeeks } = await loadTermCalendarContext({
    academicYear,
    term: params.term,
  });

  let timetableModules = await listTimetableModules({
    academicYear,
    programmeCode,
    streamCode: params.streamCode,
  });

  timetableModules = timetableModules.filter((row) => row.module_term === params.term);

  const modules: DailyTimetableModulePlan[] = [];
  const globalWarnings: string[] = [];

  for (const module of timetableModules) {
    const sessions = await listSessionsForTimetableModule(module.id);
    const studySessions = sessions.filter((row) =>
      isIsoDateInTermStudyWeek(row.session_date, termWeeks)
    );

    if (studySessions.length === 0) continue;

    const labeled = studySessions.filter((row) => row.session_label?.trim());
    if (labeled.length === 0) {
      globalWarnings.push(
        `${module.module_instance_code}: daily labels not generated yet — ask admin to generate daily timetable.`
      );
      continue;
    }

    const hours = await loadModuleCatalogContext(module.id);

    const entries = sortDailyTimetableEntries(
      studySessions.map((row) =>
        sessionRowToDailyEntry(row, module, hours.programmeType)
      )
    );

    const weekday =
      inferWeekdayFromSessions(
        studySessions.filter((row) => row.status !== "cancel")
      ) ??
      entries[0]?.weekday ??
      0;

    const isHd = isHdDailyTimetableModule({
      programmeCode,
      programmeType: hours.programmeType,
    });

    const studyWeekdayOccurrences = isHd
      ? entries.filter((row) => row.status !== "cancel").length
      : weekday >= 1 && weekday <= 5
        ? studyWeekdayCountForJsDay(termSummary, weekday)
        : countStudyWeekdayOccurrences({
            termWeeks,
            weekday,
            publicHolidayIsoDates: new Set(),
          });

    const labelSequence = buildSessionLabelSequence({
      programmeCode,
      programmeType: hours.programmeType,
      teachingContactHours: hours.teachingContactHours,
      studyWeekdayOccurrences,
    });

    modules.push({
      timetableModuleId: module.id,
      moduleInstanceCode: String(module.module_instance_code ?? "").trim(),
      moduleCode: entries[0]?.moduleCode ?? "",
      moduleName: module.module_name,
      programmeCode,
      streamCode: String(module.stream_code ?? "").trim(),
      moduleTerm: String(module.module_term ?? "").trim(),
      isHd,
      weekday,
      weekdayLabel: weekdayLabel(weekday),
      teachingContactHours: hours.teachingContactHours,
      tutorialContactHours: hours.tutorialContactHours,
      labelledSessionCount: labelSequence.length,
      weeklySlotCount: entries.filter((row) => row.status !== "cancel").length,
      outsideStudyWeekSlotCount: 0,
      extraWeeklySlotCount: entries.filter((row) => row.isBackup).length,
      labelSequence,
      entries,
      warnings: [],
    });
  }

  modules.sort((a, b) => a.moduleInstanceCode.localeCompare(b.moduleInstanceCode));

  const entriesByDate = new Map<string, DailyTimetableEntry[]>();

  for (const plan of modules) {
    for (const entry of plan.entries) {
      const bucket = entriesByDate.get(entry.sessionDate) ?? [];
      bucket.push(entry);
      entriesByDate.set(entry.sessionDate, bucket);
    }
  }

  return {
    academicYear,
    term: params.term,
    termStartDate: toIsoDateString(termSummary.termStartDate),
    termEndDate: toIsoDateString(termSummary.termEndDate),
    modules,
    entriesByDate,
    warnings: globalWarnings,
  };
}

export async function updateDailyTimetableSession(params: {
  sessionId: string;
  session_date?: string;
  start_time?: string;
  end_time?: string;
  room_code?: string;
  status?: TimetableSessionStatus;
  remark?: string | null;
  relabel?: boolean;
}) {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (params.session_date !== undefined) {
    patch.session_date = normalizeSessionDate(params.session_date);
  }

  if (params.start_time !== undefined) {
    patch.start_time = normalizeSessionTime(params.start_time);
  }

  if (params.end_time !== undefined) {
    patch.end_time = normalizeSessionTime(params.end_time);
  }

  if (params.room_code !== undefined) {
    patch.room_code = String(params.room_code).trim();
  }

  if (params.status !== undefined) {
    patch.status = params.status;

    if (params.status === "cancel") {
      const { data: current, error: loadError } = await supabase
        .from("timetable_sessions")
        .select("session_label, remark")
        .eq("id", params.sessionId)
        .single();

      if (!loadError && current) {
        const label = String(current.session_label ?? "").trim();

        if (label) {
          const nextRemark =
            params.remark !== undefined
              ? String(params.remark ?? "").trim()
              : String(current.remark ?? "").trim();

          patch.remark = formatCancelledRemark(label, nextRemark);
        }
      }
    }
  }

  if (params.remark !== undefined && params.status !== "cancel") {
    const text = String(params.remark ?? "").trim();
    patch.remark = text || null;
  }

  const { data, error } = await supabase
    .from("timetable_sessions")
    .update(patch)
    .eq("id", params.sessionId)
    .select("timetable_module_id")
    .single();

  if (error) throw error;

  const timetableModuleId = String(data.timetable_module_id ?? "");

  if (params.relabel !== false && timetableModuleId) {
    const session = await supabase
      .from("timetable_sessions")
      .select("academic_year, module_instance_code")
      .eq("id", params.sessionId)
      .single();

    if (!session.error && session.data) {
      const { module } = await loadModuleCatalogContext(timetableModuleId);
      const { termWeeks, excluded, termSummary } = await loadTermCalendarContext({
        academicYear: session.data.academic_year,
        term: module.module_term as TimetableScheduleTerm,
      });

      await applyDailyLabelsToTimetableModule(
        timetableModuleId,
        termWeeks,
        termSummary,
        excluded
      );
    }
  }

  return { timetableModuleId };
}

/** Cancel a labelled session and mark a backup slot as make-up; then re-order L/T labels. */
export async function applyDailyMakeupFromBackup(params: {
  cancelSessionId: string;
  backupSessionId: string;
  remark?: string | null;
  session_date?: string;
  start_time?: string;
  end_time?: string;
  room_code?: string;
}) {
  if (params.cancelSessionId === params.backupSessionId) {
    throw new Error("Cancelled session and backup session must be different.");
  }

  const { data: cancelRow, error: cancelLoadError } = await supabase
    .from("timetable_sessions")
    .select("id, timetable_module_id, session_label, academic_year")
    .eq("id", params.cancelSessionId)
    .single();

  if (cancelLoadError) throw cancelLoadError;

  const { data: backupRow, error: backupLoadError } = await supabase
    .from("timetable_sessions")
    .select("id, timetable_module_id, session_label, status")
    .eq("id", params.backupSessionId)
    .single();

  if (backupLoadError) throw backupLoadError;

  if (
    String(cancelRow.timetable_module_id) !== String(backupRow.timetable_module_id)
  ) {
    throw new Error("Backup session must belong to the same module.");
  }

  if (String(backupRow.session_label ?? "").trim()) {
    throw new Error("Selected session is not a backup slot (already has an L/T label).");
  }

  const cancelledLabel = String(cancelRow.session_label ?? "").trim();
  const remarkParts = [
    cancelledLabel ? `Make-up for ${cancelledLabel}` : "Make-up session",
    String(params.remark ?? "").trim(),
  ].filter(Boolean);

  const now = new Date().toISOString();

  const cancelRemark = formatCancelledRemark(
    cancelledLabel,
    null
  );

  const { error: cancelError } = await supabase
    .from("timetable_sessions")
    .update({
      status: "cancel",
      remark: cancelRemark,
      updated_at: now,
    })
    .eq("id", params.cancelSessionId);

  if (cancelError) throw cancelError;

  const backupPatch: Record<string, unknown> = {
    status: "make_up",
    remark: remarkParts.join(" — ") || null,
    updated_at: now,
  };

  if (params.session_date !== undefined) {
    backupPatch.session_date = normalizeSessionDate(params.session_date);
  }

  if (params.start_time !== undefined) {
    backupPatch.start_time = normalizeSessionTime(params.start_time);
  }

  if (params.end_time !== undefined) {
    backupPatch.end_time = normalizeSessionTime(params.end_time);
  }

  if (params.room_code !== undefined) {
    backupPatch.room_code = String(params.room_code).trim();
  }

  const { error: backupError } = await supabase
    .from("timetable_sessions")
    .update(backupPatch)
    .eq("id", params.backupSessionId);

  if (backupError) throw backupError;

  const timetableModuleId = String(cancelRow.timetable_module_id);
  const { module } = await loadModuleCatalogContext(timetableModuleId);
  const { termWeeks, excluded, termSummary } = await loadTermCalendarContext({
    academicYear: cancelRow.academic_year,
    term: module.module_term as TimetableScheduleTerm,
  });

  await applyDailyLabelsToTimetableModule(
    timetableModuleId,
    termWeeks,
    termSummary,
    excluded
  );

  return { timetableModuleId };
}

export async function createDailyTimetableSession(params: {
  academicYear: string;
  timetableModuleId: string;
  session_date: string;
  start_time: string;
  end_time: string;
  room_code: string;
  status?: TimetableSessionStatus;
  createdBy?: string | null;
}) {
  const { module } = await loadModuleCatalogContext(params.timetableModuleId);
  const term = module.module_term as TimetableScheduleTerm;

  const { termWeeks, excluded, termSummary } = await loadTermCalendarContext({
    academicYear: params.academicYear,
    term,
  });

  const sessionDate = normalizeSessionDate(params.session_date);

  if (!isIsoDateInTermStudyWeek(sessionDate, termWeeks)) {
    throw new Error("Session date must fall within a study week.");
  }

  const { data, error } = await supabase
    .from("timetable_sessions")
    .insert({
      academic_year: normalizeAcademicYear(params.academicYear),
      timetable_module_id: params.timetableModuleId,
      module_instance_code: module.module_instance_code,
      module_code:
        resolveBaseModuleCode(module) || module.module_instance_code,
      module_name: module.module_name,
      session_date: sessionDate,
      start_time: normalizeSessionTime(params.start_time),
      end_time: normalizeSessionTime(params.end_time),
      room_code: String(params.room_code).trim(),
      status: params.status ?? "normal",
      created_by: params.createdBy ?? null,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw error;

  await applyDailyLabelsToTimetableModule(
    params.timetableModuleId,
    termWeeks,
    termSummary,
    excluded
  );

  return { sessionId: String(data.id), timetableModuleId: params.timetableModuleId };
}
