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
  buildPreserveKindLabelAssignments,
  isDailyLabelPlanLocked,
  parseDailyLabelPlanOverride,
  type DailyLabelPlanOverride,
} from "../lib/dailyTimetableLabelOverride";
import {
  buildSessionLabelAssignments,
  buildChronologicalLabelAssignments,
  formatCancelledRemark,
  isBackupTimetableSession,
  parseCancelledLabelFromRemark,
  type TimetableSessionStatus,
} from "../lib/dailyTimetableSessionLabels";
import {
  buildModuleContactHourPlan,
  buildSessionLabelSequenceFromContactHours,
  resolveCrossModuleSlotBorrow,
  type ModuleContactHourPlan,
} from "../lib/dailyTimetablePlan";
import {
  addHoursToSessionTime,
  buildWeekDateSlots,
} from "../lib/dailyTimetableWeekSlots";
import {
  describeSessionLabelSequence,
  isHdDailyTimetableModule,
  weekdayLabel,
  type DailySessionKind,
  type DailySessionLabelSlot,
} from "../lib/dailyTimetable";
import { sortDailyTimetableEntries } from "../lib/dailyTimetableEntrySort";
import { isMixedProgrammeCode } from "../lib/timetableProgramme";
import { supabase } from "../lib/supabase";
import { normalizeAcademicYear } from "../lib/utils";
import {
  getPublishedAcademicCalendar,
  listAcademicCalendarBreaks,
  listAcademicCalendarTimeBreaks,
  listHkPublicHolidays,
} from "./academicCalendarService";
import {
  buildExcludedIsoDatesForTerm,
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
  /** True when L/T kinds are manually locked (preserve_kinds override). */
  labelPlanLocked: boolean;
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

function resolveCatalogHoursForModule(
  catalogHours: Map<
    string,
    Pick<ModuleRow, "module_teaching_contact_hours" | "module_tutorial_contact_hours">
  >,
  module: TimetableModuleRow
) {
  const programmeCode = String(module.programme_code ?? "").trim();
  const baseCode = resolveBaseModuleCode(module);
  const instanceCode = String(module.module_instance_code ?? "").trim();

  const direct =
    catalogHours.get(moduleCatalogKey(programmeCode, baseCode)) ??
    catalogHours.get(moduleCatalogKey(programmeCode, instanceCode));

  if (direct || !isMixedProgrammeCode(programmeCode)) {
    return direct;
  }

  const targetCodes = new Set(
    [baseCode, instanceCode]
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean)
  );

  for (const [key, hours] of catalogHours) {
    const moduleCode = key.split("|")[1] ?? "";

    if (targetCodes.has(moduleCode)) {
      return hours;
    }
  }

  return undefined;
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

function parseTimeToMinutes(time: string): number {
  const text = String(time ?? "").trim().slice(0, 5);
  const [hhText, mmText] = text.split(":");

  const hh = Number(hhText);
  const mm = Number(mmText);

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  if (hh < 0 || hh > 23) return NaN;
  if (mm < 0 || mm > 59) return NaN;

  return hh * 60 + mm;
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

  const timeBreakRows = await listAcademicCalendarTimeBreaks(
    params.academicYear
  );

  // Time-slot breaks are used for Daily timetable warnings + save validation.
  const timeBreaks = timeBreakRows
    .map((br) => {
      const start = parseIsoDate(br.start_date);
      const end = parseIsoDate(br.end_date);

      const startTimeText = String(br.start_time ?? "").slice(0, 5);
      const endTimeText = String(br.end_time ?? "").slice(0, 5);

      const startMinutes = parseTimeToMinutes(startTimeText);
      const endMinutes = parseTimeToMinutes(endTimeText);

      if (!start || !end || !Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
        return null;
      }

      // Assume breaks do not cross midnight (DB constraint enforces end_time > start_time).
      if (endMinutes <= startMinutes) {
        return null;
      }

      return {
        breakName: br.break_name,
        startIso: toIsoDateString(start),
        endIso: toIsoDateString(end),
        startMinutes,
        endMinutes,
        startTimeText,
        endTimeText,
      };
    })
    .filter((b): b is NonNullable<typeof b> => Boolean(b));

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
    timeBreaks,
  };
}

function materializeModuleDailyPlan(params: {
  module: TimetableModuleRow;
  contactPlan: ModuleContactHourPlan;
  sessions: TimetableSessionRow[];
  programmeType: string | null;
  teachingContactHours: number;
  tutorialContactHours: number;
  termWeeks: WeekRange[];
}): DailyTimetableModulePlan {
  const activeSessions = params.sessions.filter((row) => row.status !== "cancel");
  const studyWeekSessions = activeSessions.filter((row) =>
    isIsoDateInTermStudyWeek(row.session_date, params.termWeeks)
  );
  const outsideStudyWeekSessions = activeSessions.filter(
    (row) => !isIsoDateInTermStudyWeek(row.session_date, params.termWeeks)
  );

  const programmeCode = String(params.module.programme_code ?? "").trim();
  const isHd = isHdDailyTimetableModule({
    programmeCode,
    programmeType: params.programmeType,
  });
  const weekday = params.contactPlan.weekday;
  const labelSequence = params.contactPlan.labelSequence;
  const warnings = [...params.contactPlan.warnings];
  const labelPlanLocked = isDailyLabelPlanLocked(
    (params.module as TimetableModuleRow).daily_label_plan_override
  );

  if (labelPlanLocked) {
    warnings.push(
      "L/T kinds are locked (manual lecture/tutorial change). Relabel keeps kinds and only renumbers labels."
    );
  }

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
  const usedSessionIds = new Set<string>();

  for (let index = 0; index < params.contactPlan.assignments.length; index += 1) {
    const assignment = params.contactPlan.assignments[index]!;
    const slot = assignment.slot;
    const matched =
      sortedSessions.find((row) => !usedSessionIds.has(row.id)) ?? null;

    if (matched) {
      usedSessionIds.add(matched.id);
    }

    const sessionDate =
      assignment.dateSlot?.sessionDate ??
      (matched != null ? normalizeSessionDate(matched.session_date) : null);

    if (!sessionDate) continue;

    const entryWeekday =
      assignment.dateSlot?.calendarWeekday ?? weekday;
    const durationHours = slot.durationHours ?? 4;
    const startTime = matched
      ? normalizeSessionTime(matched.start_time)
      : template.startTime;
    const endTime = matched
      ? normalizeSessionTime(matched.end_time)
      : addHoursToSessionTime(startTime, durationHours);

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
      weekday: entryWeekday,
      weekdayLabel: weekdayLabel(entryWeekday),
      sessionLabel: matched?.session_label?.trim() || slot.label,
      sessionKind:
        (matched?.session_kind as DailySessionKind | null) ?? slot.kind,
      status: (matched?.status as TimetableSessionStatus) ?? "normal",
      sessionDate,
      startTime,
      endTime,
      roomCode: matched?.room_code ?? template.roomCode,
      teacherName: matched?.teacher_name ?? template.teacherName,
      hasWeeklySession: Boolean(matched),
      sessionNumber: matched?.session_number ?? index + 1,
      isBackup: false,
      remark:
        assignment.scheduleRemark?.trim() ||
        matched?.remark?.trim() ||
        null,
    });
  }

  for (const matched of sortedSessions) {
    if (usedSessionIds.has(matched.id)) continue;

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
        ? `Weekly timetable has ${weeklySlotCount} slot(s) on ${weekdayLabel(weekday)} (one per teaching week). Daily labels use the first ${labelledSessionCount} only (${describeSessionLabelSequence(labelSequence)}). ${extraWeeklySlotCount} extra slot(s) are not labelled.`
        : `Weekly timetable has ${weeklySlotCount} slot(s); daily plan labels ${labelledSessionCount} (${describeSessionLabelSequence(labelSequence)}).`
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
    labelPlanLocked,
    entries,
    warnings,
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
  contactPlan?: ModuleContactHourPlan;
}): DailyTimetableModulePlan | null {
  const activeSessions = params.sessions.filter((row) => row.status !== "cancel");
  const studyWeekSessions = activeSessions.filter((row) =>
    isIsoDateInTermStudyWeek(row.session_date, params.termWeeks)
  );

  if (studyWeekSessions.length === 0) {
    return null;
  }

  const weekday = inferWeekdayFromSessions(studyWeekSessions);

  if (weekday === null) {
    return null;
  }

  const programmeCode = String(params.module.programme_code ?? "").trim();
  const moduleCode =
    resolveBaseModuleCode(params.module) ||
    String(params.module.module_instance_code ?? "").trim();

  const contactPlan =
    params.contactPlan ??
    buildModuleContactHourPlan({
      moduleCode,
      moduleInstanceCode: String(params.module.module_instance_code ?? "").trim(),
      timetableModuleId: params.module.id,
      programmeCode,
      programmeType: params.programmeType,
      teachingContactHours: params.teachingContactHours,
      tutorialContactHours: params.tutorialContactHours,
      weekday,
      termWeeks: params.termWeeks,
      excluded: params.excluded,
      studyWeekSessions,
    });

  return materializeModuleDailyPlan({
    module: params.module,
    contactPlan,
    sessions: params.sessions,
    programmeType: params.programmeType,
    teachingContactHours: params.teachingContactHours,
    tutorialContactHours: params.tutorialContactHours,
    termWeeks: params.termWeeks,
  });
}

export async function buildDailyTimetable(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  programmeCode?: string;
  timetableModuleId?: string;
}): Promise<DailyTimetableBuildResult> {
  const academicYear = normalizeAcademicYear(params.academicYear);
  const { excluded, termSummary, termWeeks, timeBreaks } =
    await loadTermCalendarContext({
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
  const contactPlans: ModuleContactHourPlan[] = [];
  const pendingModules: Array<{
    module: TimetableModuleRow;
    sessions: TimetableSessionRow[];
    programmeType: string | null;
    teachingContactHours: number;
    tutorialContactHours: number;
  }> = [];

  const targetModuleId = String(params.timetableModuleId ?? "").trim();

  for (const module of timetableModules) {
    if (module.module_term !== params.term) continue;
    if (targetModuleId && module.id !== targetModuleId) continue;

    const moduleSessions = sessionsByModuleId.get(module.id) ?? [];
    const hours = resolveCatalogHoursForModule(catalogHours, module);
    const activeSessions = moduleSessions.filter((row) => row.status !== "cancel");
    const studyWeekSessions = activeSessions.filter((row) =>
      isIsoDateInTermStudyWeek(row.session_date, termWeeks)
    );

    if (studyWeekSessions.length === 0) {
      if (moduleSessions.length === 0) {
        globalWarnings.push(
          `${module.module_instance_code} (${module.module_term}): no rows in weekly timetable for ${params.term} term — complete Step 4 (Schedule) in Make Timetable for this module first.`
        );
      } else {
        globalWarnings.push(
          `${module.module_instance_code}: ${moduleSessions.length} session(s) only on non-study weeks (revision/exam) — remove them or re-run auto-schedule.`
        );
      }

      continue;
    }

    const weekday = inferWeekdayFromSessions(studyWeekSessions);

    if (weekday === null) {
      globalWarnings.push(
        `${module.module_instance_code}: weekly sessions exist but could not infer weekday — skipped.`
      );
      continue;
    }

    const programmeCode = String(module.programme_code ?? "").trim();
    const moduleCode =
      resolveBaseModuleCode(module) ||
      String(module.module_instance_code ?? "").trim();

    const contactPlan = buildModuleContactHourPlan({
      moduleCode,
      moduleInstanceCode: String(module.module_instance_code ?? "").trim(),
      timetableModuleId: module.id,
      programmeCode,
      programmeType: programmeTypes.get(module.programme_code) ?? null,
      teachingContactHours: hours?.module_teaching_contact_hours ?? 0,
      tutorialContactHours: hours?.module_tutorial_contact_hours ?? 0,
      weekday,
      termWeeks,
      excluded,
      studyWeekSessions,
    });

    contactPlans.push(contactPlan);
    pendingModules.push({
      module,
      sessions: moduleSessions,
      programmeType: programmeTypes.get(module.programme_code) ?? null,
      teachingContactHours: hours?.module_teaching_contact_hours ?? 0,
      tutorialContactHours: hours?.module_tutorial_contact_hours ?? 0,
    });
  }

  resolveCrossModuleSlotBorrow(contactPlans);

  for (let index = 0; index < pendingModules.length; index += 1) {
    const pending = pendingModules[index]!;
    const contactPlan = contactPlans[index]!;

    const plan = buildModuleDailyPlan({
      module: pending.module,
      sessions: pending.sessions,
      programmeType: pending.programmeType,
      teachingContactHours: pending.teachingContactHours,
      tutorialContactHours: pending.tutorialContactHours,
      termSummary,
      termWeeks,
      excluded,
      contactPlan,
    });

    if (!plan) continue;

    modules.push(plan);

    // Time-slot breaks only apply to Daily timetable (warnings + save validation).
    // They do not change weekly timetable slot generation.
    if (timeBreaks.length > 0) {
      for (const entry of plan.entries) {
        if (entry.status === "cancel") continue;

        const startMinutes = parseTimeToMinutes(entry.startTime);
        const endMinutes = parseTimeToMinutes(entry.endTime);

        if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
          continue;
        }

        const iso = entry.sessionDate;

        for (const br of timeBreaks) {
          if (iso < br.startIso || iso > br.endIso) continue;

          const overlaps =
            startMinutes < br.endMinutes && br.startMinutes < endMinutes;

          if (!overlaps) continue;

          globalWarnings.push(
            `${plan.moduleInstanceCode}: ${entry.sessionLabel} (${entry.sessionKind}) on ${iso} ${entry.startTime.slice(
              0,
              5
            )}–${entry.endTime.slice(0, 5)} overlaps "${br.breakName}" (${br.startTimeText}–${br.endTimeText}).`
          );
        }
      }
    }

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
  const hours = resolveCatalogHoursForModule(catalogHours, row);

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
  excluded: Awaited<ReturnType<typeof buildExcludedIsoDatesForTerm>>,
  options?: { forceChronological?: boolean }
) {
  const { module, programmeType, teachingContactHours, tutorialContactHours } =
    await loadModuleCatalogContext(timetableModuleId);

  const sessions = await listSessionsForTimetableModule(timetableModuleId);
  const studyWeekSessions = sessions.filter((row) =>
    isIsoDateInTermStudyWeek(row.session_date, termWeeks)
  );

  const override = parseDailyLabelPlanOverride(module.daily_label_plan_override);
  const forceChronological = options?.forceChronological === true;

  if (!forceChronological && override?.strategy === "preserve_kinds") {
    const assignments = buildPreserveKindLabelAssignments({
      sessions: studyWeekSessions.map((row) => ({
        id: row.id,
        status: row.status as TimetableSessionStatus,
        session_date: normalizeSessionDate(row.session_date),
        start_time: normalizeSessionTime(row.start_time),
        session_kind: row.session_kind,
        session_label: row.session_label,
      })),
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

  const weekday = inferWeekdayFromSessions(
    studyWeekSessions.filter((row) => row.status !== "cancel")
  );

  if (weekday === null) {
    return { updatedCount: 0 };
  }

  const programmeCode = String(module.programme_code ?? "").trim();
  const dateSlots = buildWeekDateSlots({
    termWeeks,
    excluded,
    primaryWeekday: weekday,
  });

  const labelSequence = buildSessionLabelSequenceFromContactHours({
    programmeCode,
    programmeType,
    teachingContactHours,
    tutorialContactHours,
    maxSlots: dateSlots.length,
  });

  const sessionTargets = studyWeekSessions.map((row) => ({
    id: row.id,
    status: row.status as TimetableSessionStatus,
    session_date: normalizeSessionDate(row.session_date),
    start_time: normalizeSessionTime(row.start_time),
  }));

  const assignments = forceChronological
    ? buildChronologicalLabelAssignments({
        labelSequence,
        sessions: sessionTargets,
      })
    : buildSessionLabelAssignments({
        labelSequence,
        sessions: sessionTargets,
        existingLabelsById: new Map(
          sessions.map((row) => [row.id, row.session_label ?? null])
        ),
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

export async function regenerateDailyTimetableForModule(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  timetableModuleId: string;
}): Promise<{
  updatedCount: number;
  result: DailyTimetableBuildResult;
}> {
  const timetableModuleId = String(params.timetableModuleId ?? "").trim();

  if (!timetableModuleId) {
    throw new Error("Module is required.");
  }

  const { termWeeks, excluded, termSummary } = await loadTermCalendarContext({
    academicYear: params.academicYear,
    term: params.term,
  });

  const { updatedCount } = await applyDailyLabelsToTimetableModule(
    timetableModuleId,
    termWeeks,
    termSummary,
    excluded
  );

  const result = await buildDailyTimetable({
    academicYear: params.academicYear,
    term: params.term,
    timetableModuleId,
  });

  return { updatedCount, result };
}

export function mergeDailyTimetableModuleResult(
  current: DailyTimetableBuildResult | null,
  incoming: DailyTimetableBuildResult
): DailyTimetableBuildResult {
  const incomingPlan = incoming.modules[0];

  if (!incomingPlan) {
    return current ?? incoming;
  }

  if (!current) {
    return incoming;
  }

  const modules = [
    ...current.modules.filter(
      (row) => row.timetableModuleId !== incomingPlan.timetableModuleId
    ),
    incomingPlan,
  ].sort((a, b) => a.moduleInstanceCode.localeCompare(b.moduleInstanceCode));

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

  const warningPrefix = `${incomingPlan.moduleInstanceCode}:`;
  const warnings = [
    ...current.warnings.filter((warning) => !warning.startsWith(warningPrefix)),
    ...incoming.warnings,
  ];

  return {
    ...current,
    modules,
    entriesByDate,
    warnings,
  };
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

async function listDailyTimetableModules(params: {
  academicYear: string;
  programmeCode: string;
  streamCode?: string;
  knownProgrammeCodes?: string[];
}) {
  if (!isMixedProgrammeCode(params.programmeCode)) {
    return listTimetableModules({
      academicYear: params.academicYear,
      programmeCode: params.programmeCode,
      streamCode: params.streamCode,
    });
  }

  const knownProgrammeCodes = new Set(
    (params.knownProgrammeCodes ?? [])
      .map((code) => String(code ?? "").trim().toUpperCase())
      .filter(Boolean)
  );

  const allModules = await listTimetableModules({
    academicYear: params.academicYear,
    streamCode: params.streamCode,
  });

  return allModules.filter((row) => {
    const code = String(row.programme_code ?? "").trim().toUpperCase();

    if (!code || isMixedProgrammeCode(code)) {
      return true;
    }

    return !knownProgrammeCodes.has(code);
  });
}

export async function loadProgrammeDailyTimetable(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  programmeCode: string;
  streamCode?: string;
  knownProgrammeCodes?: string[];
}): Promise<DailyTimetableBuildResult> {
  const academicYear = normalizeAcademicYear(params.academicYear);
  const programmeCode = String(params.programmeCode ?? "").trim();

  if (!programmeCode) {
    throw new Error("Programme code is required.");
  }

  const { termSummary, termWeeks, excluded, timeBreaks } =
    await loadTermCalendarContext({
    academicYear,
    term: params.term,
  });

  let timetableModules = await listDailyTimetableModules({
    academicYear,
    programmeCode,
    streamCode: params.streamCode,
    knownProgrammeCodes: params.knownProgrammeCodes,
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

    const dateSlots = buildWeekDateSlots({
      termWeeks,
      excluded,
      primaryWeekday: weekday,
    });

    const labelSequence = buildSessionLabelSequenceFromContactHours({
      programmeCode,
      programmeType: hours.programmeType,
      teachingContactHours: hours.teachingContactHours,
      tutorialContactHours: hours.tutorialContactHours,
      maxSlots: dateSlots.length,
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
      labelPlanLocked: isDailyLabelPlanLocked(module.daily_label_plan_override),
      entries,
      warnings: [],
    });
  }

  modules.sort((a, b) => a.moduleInstanceCode.localeCompare(b.moduleInstanceCode));

  // Add time-slot break warnings for existing daily timetable sessions.
  if (timeBreaks.length > 0) {
    for (const plan of modules) {
      for (const entry of plan.entries) {
        if (entry.status === "cancel") continue;

        const startMinutes = parseTimeToMinutes(entry.startTime);
        const endMinutes = parseTimeToMinutes(entry.endTime);

        if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
          continue;
        }

        const iso = entry.sessionDate;

        for (const br of timeBreaks) {
          if (iso < br.startIso || iso > br.endIso) continue;

          const overlaps =
            startMinutes < br.endMinutes && br.startMinutes < endMinutes;

          if (!overlaps) continue;

          globalWarnings.push(
            `${plan.moduleInstanceCode}: ${entry.sessionLabel} (${entry.sessionKind}) on ${iso} ${entry.startTime.slice(
              0,
              5
            )}–${entry.endTime.slice(0, 5)} overlaps "${br.breakName}" (${br.startTimeText}–${br.endTimeText}).`
          );
        }
      }
    }
  }

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

export async function reloadDailyModulePlan(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  timetableModuleId: string;
}): Promise<DailyTimetableModulePlan | null> {
  const academicYear = normalizeAcademicYear(params.academicYear);
  const { termSummary, termWeeks, excluded } = await loadTermCalendarContext({
    academicYear,
    term: params.term,
  });

  const { data: module, error } = await supabase
    .from("timetable_modules")
    .select("*")
    .eq("id", params.timetableModuleId)
    .maybeSingle();

  if (error) throw error;
  if (!module) return null;

  const sessions = await listSessionsForTimetableModule(module.id);
  const studySessions = sessions.filter((row) =>
    isIsoDateInTermStudyWeek(row.session_date, termWeeks)
  );

  if (studySessions.length === 0) {
    return null;
  }

  const hours = await loadModuleCatalogContext(module.id);
  const entries = sortDailyTimetableEntries(
    studySessions.map((row) =>
      sessionRowToDailyEntry(row, module as TimetableModuleRow, hours.programmeType)
    )
  );

  const weekday =
    inferWeekdayFromSessions(
      studySessions.filter((row) => row.status !== "cancel")
    ) ??
    entries[0]?.weekday ??
    0;

  const programmeCode = String(module.programme_code ?? "").trim();
  const isHd = isHdDailyTimetableModule({
    programmeCode,
    programmeType: hours.programmeType,
  });

  const dateSlots = buildWeekDateSlots({
    termWeeks,
    excluded,
    primaryWeekday: weekday,
  });

  const labelSequence = buildSessionLabelSequenceFromContactHours({
    programmeCode,
    programmeType: hours.programmeType,
    teachingContactHours: hours.teachingContactHours,
    tutorialContactHours: hours.tutorialContactHours,
    maxSlots: dateSlots.length,
  });

  return {
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
    labelPlanLocked: isDailyLabelPlanLocked(module.daily_label_plan_override),
    entries,
    warnings: [],
  };
}

export function replaceModuleInDailyResult(
  current: DailyTimetableBuildResult,
  plan: DailyTimetableModulePlan
): DailyTimetableBuildResult {
  const modules = current.modules.some(
    (row) => row.timetableModuleId === plan.timetableModuleId
  )
    ? current.modules.map((row) =>
        row.timetableModuleId === plan.timetableModuleId ? plan : row
      )
    : [...current.modules, plan].sort((a, b) =>
        a.moduleInstanceCode.localeCompare(b.moduleInstanceCode)
      );

  const entriesByDate = new Map<string, DailyTimetableEntry[]>();

  for (const modulePlan of modules) {
    for (const entry of modulePlan.entries) {
      const bucket = entriesByDate.get(entry.sessionDate) ?? [];
      bucket.push(entry);
      entriesByDate.set(entry.sessionDate, bucket);
    }
  }

  return {
    ...current,
    modules,
    entriesByDate,
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

const PRESERVE_KINDS_OVERRIDE: DailyLabelPlanOverride = {
  locked: true,
  strategy: "preserve_kinds",
};

async function setDailyLabelPlanOverride(
  timetableModuleId: string,
  override: DailyLabelPlanOverride | null
) {
  const { error } = await supabase
    .from("timetable_modules")
    .update({
      daily_label_plan_override: override,
      updated_at: new Date().toISOString(),
    })
    .eq("id", timetableModuleId);

  if (error) {
    if (
      /daily_label_plan_override/i.test(error.message) ||
      error.code === "42703"
    ) {
      throw new Error(
        "Database missing column daily_label_plan_override. Apply migration 046_timetable_modules_daily_label_plan_override.sql first."
      );
    }
    throw error;
  }
}

/**
 * Change one session to Lecture or Tutorial, lock label plan to preserve kinds,
 * then renumber L1..Ln / T1..Tm by date.
 */
export async function changeDailySessionKind(params: {
  sessionId: string;
  targetKind: DailySessionKind;
  academicYear: string;
  term: TimetableScheduleTerm;
}) {
  const { data: session, error: loadError } = await supabase
    .from("timetable_sessions")
    .select("id, timetable_module_id, session_kind, session_label, status")
    .eq("id", params.sessionId)
    .single();

  if (loadError) throw loadError;

  if (String(session.status ?? "") === "cancel") {
    throw new Error("Cannot change kind of a cancelled session.");
  }

  const timetableModuleId = String(session.timetable_module_id ?? "");
  if (!timetableModuleId) {
    throw new Error("Session is not linked to a timetable module.");
  }

  const { error: kindError } = await supabase
    .from("timetable_sessions")
    .update({
      session_kind: params.targetKind,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.sessionId);

  if (kindError) throw kindError;

  await setDailyLabelPlanOverride(timetableModuleId, PRESERVE_KINDS_OVERRIDE);

  const { termWeeks, excluded, termSummary } = await loadTermCalendarContext({
    academicYear: params.academicYear,
    term: params.term,
  });

  await applyDailyLabelsToTimetableModule(
    timetableModuleId,
    termWeeks,
    termSummary,
    excluded
  );

  return { timetableModuleId };
}

/** Clear manual L/T kind lock and restore contact-hour label sequence. */
export async function clearDailyLabelPlanLock(params: {
  timetableModuleId: string;
  academicYear: string;
  term: TimetableScheduleTerm;
}) {
  await setDailyLabelPlanOverride(params.timetableModuleId, null);

  const { termWeeks, excluded, termSummary } = await loadTermCalendarContext({
    academicYear: params.academicYear,
    term: params.term,
  });

  await applyDailyLabelsToTimetableModule(
    params.timetableModuleId,
    termWeeks,
    termSummary,
    excluded,
    { forceChronological: true }
  );

  return { timetableModuleId: params.timetableModuleId };
}

/**
 * Re-apply contact-hour L/T labels by date order (fills L gaps / promotes earliest backups).
 * Clears any preserve-kinds lock.
 */
export async function renumberDailyLabelsFromContactHours(params: {
  timetableModuleId: string;
  academicYear: string;
  term: TimetableScheduleTerm;
}) {
  await setDailyLabelPlanOverride(params.timetableModuleId, null);

  const { termWeeks, excluded, termSummary } = await loadTermCalendarContext({
    academicYear: params.academicYear,
    term: params.term,
  });

  const { updatedCount } = await applyDailyLabelsToTimetableModule(
    params.timetableModuleId,
    termWeeks,
    termSummary,
    excluded,
    { forceChronological: true }
  );

  return { timetableModuleId: params.timetableModuleId, updatedCount };
}
