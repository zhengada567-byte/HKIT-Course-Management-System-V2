import type { TimetableModuleInstanceRow } from "./timetableModuleInstanceService";
import type { TimetableClassroomRow, TimetableScheduleTerm, TimetableSessionRow } from "./timetableScheduleService";
import {
  buildTeachingDatesForWeekday,
  createTimetableSessions,
  deleteTimetableSessionsForInstanceCodes,
  deleteTimetableSessionsForModuleIds,
  effectiveRoomCapacity,
  listScheduledTimetableModuleIds,
  listTimetableSessions,
  normalizeSessionTime,
} from "./timetableScheduleService";
import { joinUniqueModuleCodes } from "../lib/moduleDisplay";
import {
  moduleRequiresComputerRoom,
  resolveBaseModuleCodeForProgramme,
} from "../lib/combinedModuleCode";
import {
  applyFtWednesdayAmInstitutionalBlock,
  buildDayAutoScheduleStartOptions,
  buildModuleStreamAlignKey,
  instanceTeacherIncludesFt,
  buildFtTeacherNameSet,
  buildWeeklyTimeslotKey,
  createStreamYearTimeslotState,
  isAnyStreamYearTimeslotBlocked,
  normalizeSchedulingStream,
  recordAutoSchedulePlacement,
  resolveSchedulingIdentities,
  SCHEDULING_WEEKDAYS,
  schedulingWeekdayLabel,
  scoreAutoScheduleSlot,
  type StreamYearSchedulingIdentity,
  type StreamYearTimeslotState,
} from "../lib/timetableSchedulingRules";
import { addDays, toIsoDateString } from "../lib/academicCalendar";
import { loadPlanningModulesByCombineGroupIds } from "./splitClassService";
import { buildModuleCatalogKey, loadModuleUsesComputerMap } from "./moduleService";
import { listTeachers } from "./teacherService";
import { listTimetableModulesByInstanceCodes } from "./timetableService";
import { listTeacherNotAvailableForTeachers } from "./timetableTeacherAvailabilityService";
import type { TimetableModuleRow, TimetablePlanningModuleRow } from "../types";

type Weekday = 1 | 2 | 3 | 4 | 5 | 6; // Mon..Sat

type Period = "AM" | "PM" | "EVENING";

const NIGHT_START = "18:30";
const NIGHT_END = "22:30";

function schedulingIdentitiesForModule(
  timetableModule: TimetableModuleRow,
  membersByCombineGroupId: Map<string, TimetablePlanningModuleRow[]>
): StreamYearSchedulingIdentity[] {
  const groupId = String(timetableModule.combine_group_id ?? "").trim();
  const members = groupId ? membersByCombineGroupId.get(groupId) : undefined;

  return resolveSchedulingIdentities({
    programmeCode: String(timetableModule.programme_code ?? ""),
    streamCode: timetableModule.stream_code,
    moduleYear: timetableModule.module_year,
    combineMembers: members,
  });
}

export type AutoScheduleFailure = {
  code: string;
  module_year: string | null;
  mode: string | null;
  stream_code: string | null;
  programme_code: string | null;
  time_window: string;
  reason: string;
  weekday_detail: string;
};

function resolveInstanceMode(
  instance: TimetableModuleInstanceRow,
  timetableModule: { mode?: string | null }
) {
  const fromInstance = String(instance.instance_mode ?? "").trim();
  if (fromInstance) return fromInstance;

  return String(timetableModule.mode ?? "").trim();
}

function resolveAutoScheduleWeekdays(mode: string): Weekday[] {
  if (mode === "Saturday") {
    return [6];
  }

  // Night: Mon–Fri evening + Saturday full day (handled in slot attempts).
  if (mode === "Night") {
    return [...SCHEDULING_WEEKDAYS, 6];
  }

  return [...SCHEDULING_WEEKDAYS];
}

function resolveDayStartWindows(preferredStart?: string): Array<{
  start: string;
  end: string;
}> {
  const preferred = String(preferredStart ?? "").trim();
  if (preferred) {
    return [{ start: preferred, end: addHours(preferred, 4) }];
  }

  return buildDayAutoScheduleStartOptions().map((start) => ({
    start,
    end: addHours(start, 4),
  }));
}

function resolveAutoScheduleStartWindows(params: {
  mode: string;
  preferredStart?: string;
}): Array<{ start: string; end: string }> {
  if (params.mode === "Night") {
    return [{ start: NIGHT_START, end: NIGHT_END }];
  }

  return resolveDayStartWindows(params.preferredStart);
}

/**
 * Night mode: Mon–Fri fixed 18:30, plus Saturday daytime (full day).
 * Other modes: start windows × weekday list (cartesian).
 */
function resolveAutoScheduleSlotAttempts(params: {
  mode: string;
  preferredStart?: string;
}): Array<{ weekday: Weekday; start: string; end: string }> {
  if (params.mode === "Night") {
    const attempts: Array<{ weekday: Weekday; start: string; end: string }> =
      [];

    for (const weekday of SCHEDULING_WEEKDAYS) {
      attempts.push({
        weekday,
        start: NIGHT_START,
        end: NIGHT_END,
      });
    }

    for (const window of resolveDayStartWindows(params.preferredStart)) {
      attempts.push({
        weekday: 6,
        start: window.start,
        end: window.end,
      });
    }

    return attempts;
  }

  const weekdays = resolveAutoScheduleWeekdays(params.mode);
  const windows = resolveAutoScheduleStartWindows(params);
  const attempts: Array<{ weekday: Weekday; start: string; end: string }> = [];

  for (const window of windows) {
    for (const weekday of weekdays) {
      attempts.push({
        weekday,
        start: window.start,
        end: window.end,
      });
    }
  }

  return attempts;
}

function formatAutoScheduleTimeWindow(
  mode: string,
  startWindows: Array<{ start: string; end: string }>
) {
  if (mode === "Night") {
    return "Mon–Fri 18:30–22:30; Sat 08:00–14:30";
  }

  if (startWindows.length === 1) {
    return `${startWindows[0]!.start}–${startWindows[0]!.end}`;
  }

  return "08:00–14:30 (any time)";
}

function buildAutoScheduleFailure(params: {
  instance: TimetableModuleInstanceRow;
  timetableModule: {
    programme_code: string;
    stream_code: string;
    module_year?: string | null;
    mode?: string | null;
  };
  start: string;
  end: string;
  reason: string;
  weekdayDetail?: string;
}): AutoScheduleFailure {
  const mode = resolveInstanceMode(params.instance, params.timetableModule);

  return {
    code: params.instance.module_instance_code,
    module_year: String(params.timetableModule.module_year ?? "").trim() || null,
    mode: mode || null,
    stream_code: String(params.timetableModule.stream_code ?? "").trim() || null,
    programme_code:
      String(params.timetableModule.programme_code ?? "").trim() || null,
    time_window: `${params.start}–${params.end}`,
    reason: params.reason,
    weekday_detail: params.weekdayDetail ?? "",
  };
}

function diagnoseWeekdayPlacementFailures(params: {
  weekday: Weekday;
  start: string;
  end: string;
  period: Period;
  teacherName: string;
  programmeCode: string;
  streamKey: string;
  moduleYear: string;
  schedulingIdentities: StreamYearSchedulingIdentity[];
  alignKey: string;
  rooms: TimetableClassroomRow[];
  naSet: Set<string>;
  takenTeacherSlots: Set<string>;
  takenRoomSlots: Set<string>;
  existingByDate: Map<string, TimetableSessionRow[]>;
  streamYearTimeslotState: StreamYearTimeslotState;
  streamSlotByModule: Map<string, Map<string, string>>;
  streamYearOccupiedSlots: Map<string, Set<string>>;
  streamAllOccupiedSlots: Map<string, Set<string>>;
  programmeSlotStreams: Map<string, Map<string, Set<string>>>;
  teachingDates: string[];
}): string | null {
  const label = schedulingWeekdayLabel(params.weekday);

  if (params.naSet.has(`${params.teacherName}||${params.weekday}||${params.period}`)) {
    return `${label}: teacher Not Available (${params.period})`;
  }

  const slotKey = buildTimeslotKey({
    weekday: params.weekday,
    start: params.start,
    end: params.end,
  });

  if (params.takenTeacherSlots.has(teacherSlotKey(params.teacherName, slotKey))) {
    return `${label}: teacher already has ${params.start}–${params.end} on this weekday`;
  }

  if (
    isAnyStreamYearTimeslotBlocked(
      params.streamYearTimeslotState,
      params.schedulingIdentities,
      slotKey
    )
  ) {
    return `${label}: same programme+stream+year already uses ${params.start}–${params.end} (another module — not a free-room issue)`;
  }

  let sawRoomNotWeeklyTaken = false;
  let sawNoDateConflict = false;
  let sawScoredSlot = false;
  let sawScoreNullOnly = false;

  for (const room of params.rooms) {
    if (params.takenRoomSlots.has(roomSlotKey(room.room_code, slotKey))) {
      continue;
    }

    sawRoomNotWeeklyTaken = true;

    let conflict = false;
    for (const date of params.teachingDates) {
      const existing = params.existingByDate.get(date) ?? [];
      const overlapped = existing.some((s) => {
        if (s.status === "cancel") return false;
        const sStart = String(s.start_time).slice(0, 5);
        const sEnd = String(s.end_time).slice(0, 5);
        if (!overlaps({ start: params.start, end: params.end }, { start: sStart, end: sEnd })) {
          return false;
        }
        if (s.room_code === room.room_code) return true;
        if (String(s.teacher_name ?? "").trim() === params.teacherName) return true;
        return false;
      });
      if (overlapped) {
        conflict = true;
        break;
      }
    }

    if (conflict) continue;

    sawNoDateConflict = true;

    const score = scoreAutoScheduleSlot({
      slotKey,
      streamKey: params.streamKey,
      moduleYear: params.moduleYear,
      alignKey: params.alignKey,
      programmeCode: params.programmeCode,
      schedulingIdentities: params.schedulingIdentities,
      streamYearTimeslotState: params.streamYearTimeslotState,
      streamSlotByModule: params.streamSlotByModule,
      streamYearOccupiedSlots: params.streamYearOccupiedSlots,
      streamAllOccupiedSlots: params.streamAllOccupiedSlots,
      programmeSlotStreams: params.programmeSlotStreams,
    });

    if (score === null) {
      sawScoreNullOnly = true;
      continue;
    }

    sawScoredSlot = true;
  }

  if (sawScoredSlot) {
    return null;
  }

  if (!sawRoomNotWeeklyTaken) {
    return `${label}: all suitable rooms already taken at ${params.start}–${params.end}`;
  }

  if (!sawNoDateConflict) {
    return `${label}: existing session clashes (teacher or room) on teaching dates`;
  }

  if (sawScoreNullOnly) {
    return `${label}: scheduling rule blocked (${params.programmeCode} ${params.streamKey} ${params.moduleYear} — same programme+stream+same year slot)`;
  }

  return `${label}: no feasible room`;
}

function buildWeekdayFailureDetail(params: {
  weekdays: Weekday[];
  start: string;
  end: string;
  period: Period;
  teacherName: string;
  programmeCode: string;
  streamKey: string;
  moduleYear: string;
  schedulingIdentities: StreamYearSchedulingIdentity[];
  alignKey: string;
  rooms: TimetableClassroomRow[];
  naSet: Set<string>;
  takenTeacherSlots: Set<string>;
  takenRoomSlots: Set<string>;
  existingByDate: Map<string, TimetableSessionRow[]>;
  streamYearTimeslotState: StreamYearTimeslotState;
  streamSlotByModule: Map<string, Map<string, string>>;
  streamYearOccupiedSlots: Map<string, Set<string>>;
  streamAllOccupiedSlots: Map<string, Set<string>>;
  programmeSlotStreams: Map<string, Map<string, Set<string>>>;
  teachingDatesByWeekday: Map<Weekday, string[]>;
}): string {
  const notes: string[] = [];

  for (const weekday of params.weekdays) {
    const note = diagnoseWeekdayPlacementFailures({
      weekday,
      start: params.start,
      end: params.end,
      period: params.period,
      teacherName: params.teacherName,
      programmeCode: params.programmeCode,
      streamKey: params.streamKey,
      moduleYear: params.moduleYear,
      schedulingIdentities: params.schedulingIdentities,
      alignKey: params.alignKey,
      rooms: params.rooms,
      naSet: params.naSet,
      takenTeacherSlots: params.takenTeacherSlots,
      takenRoomSlots: params.takenRoomSlots,
      existingByDate: params.existingByDate,
      streamYearTimeslotState: params.streamYearTimeslotState,
      streamSlotByModule: params.streamSlotByModule,
      streamYearOccupiedSlots: params.streamYearOccupiedSlots,
      streamAllOccupiedSlots: params.streamAllOccupiedSlots,
      programmeSlotStreams: params.programmeSlotStreams,
      teachingDates: params.teachingDatesByWeekday.get(weekday) ?? [],
    });

    if (note) {
      notes.push(note);
    }
  }

  return notes.join("; ");
}

function overlaps(a: { start: string; end: string }, b: { start: string; end: string }) {
  return a.start < b.end && b.start < a.end;
}

function addHours(startTime: string, hours: number) {
  const [hh, mm] = startTime.split(":").map((p) => Number(p));
  const minutes = hh * 60 + mm + hours * 60;
  const endH = Math.floor(minutes / 60) % 24;
  const endM = minutes % 60;
  return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
}

function getPeriodForStartTime(startTime: string): Period {
  if (startTime >= NIGHT_START) return "EVENING";
  if (startTime >= "12:00") return "PM";
  return "AM";
}

function normalizeClassroomLocation(room: TimetableClassroomRow) {
  const location = String(room.location ?? "").trim().toUpperCase();
  if (location) return location;

  const code = String(room.room_code ?? "").trim().toUpperCase();
  const dashIndex = code.indexOf("-");
  return dashIndex > 0 ? code.slice(0, dashIndex) : code;
}

/** Prefer SSP classrooms; use CSW only when SSP has no suitable free room. */
function classroomLocationPriority(room: TimetableClassroomRow) {
  const location = normalizeClassroomLocation(room);
  if (location === "SSP") return 0;
  if (location === "CSW") return 1;
  return 2;
}

function chooseRoomOrder(params: {
  size: number;
  requiresComputer: boolean;
  classrooms: TimetableClassroomRow[];
}): TimetableClassroomRow[] {
  const rooms = params.classrooms
    .filter((r) => (params.requiresComputer ? r.room_type === "computer" : true))
    .filter(
      (r) => effectiveRoomCapacity(r, params.requiresComputer) >= params.size
    );

  // Preference rules:
  // - size <= 39: prefer small room_size=29 when possible
  // - size > 39: prefer larger rooms
  const preferSmall = params.size <= 39;

  return rooms.sort((a, b) => {
    const locationDiff = classroomLocationPriority(a) - classroomLocationPriority(b);
    if (locationDiff !== 0) return locationDiff;

    if (preferSmall) {
      const aSmall = a.room_size === 29 ? 0 : 1;
      const bSmall = b.room_size === 29 ? 0 : 1;
      if (aSmall !== bSmall) return aSmall - bSmall;
      return a.room_size - b.room_size;
    }

    // Prefer bigger rooms when size > 39
    if (a.room_size !== b.room_size) return b.room_size - a.room_size;
    return a.room_code.localeCompare(b.room_code);
  });
}

function buildTimeslotKey(params: {
  weekday: Weekday;
  start: string;
  end: string;
}) {
  return `${params.weekday}|${params.start}|${params.end}`;
}

function teacherSlotKey(teacherName: string, slotKey: string) {
  return `${teacherName}||${slotKey}`;
}

function roomSlotKey(roomCode: string, slotKey: string) {
  return `${roomCode}||${slotKey}`;
}

async function seedAutoScheduleFromExistingSessions(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  existingSessions: TimetableSessionRow[];
  reschedulingModuleIds: Set<string>;
  reschedulingInstanceCodes: Set<string>;
  takenTeacherSlots: Set<string>;
  takenRoomSlots: Set<string>;
  streamYearTimeslotState: StreamYearTimeslotState;
  streamSlotByModule: Map<string, Map<string, string>>;
  streamYearOccupiedSlots: Map<string, Set<string>>;
  streamAllOccupiedSlots: Map<string, Set<string>>;
  programmeSlotStreams: Map<string, Map<string, Set<string>>>;
}) {
  const instanceCodes = Array.from(
    new Set(
      params.existingSessions
        .map((session) => String(session.module_instance_code ?? "").trim())
        .filter(Boolean)
    )
  );

  if (instanceCodes.length === 0) return;

  const modules = await listTimetableModulesByInstanceCodes({
    academicYear: params.academicYear,
    moduleInstanceCodes: instanceCodes,
  });
  const moduleByInstanceCode = new Map(
    modules.map((module) => [
      String(module.module_instance_code ?? "").trim(),
      module,
    ])
  );

  const combineGroupIds = Array.from(
    new Set(
      modules
        .map((module) => String(module.combine_group_id ?? "").trim())
        .filter(Boolean)
    )
  );
  const membersByCombineGroupId = await loadPlanningModulesByCombineGroupIds({
    academicYear: params.academicYear,
    combineGroupIds,
  });

  const seenWeekly = new Set<string>();

  for (const session of params.existingSessions) {
    if (session.status === "cancel") continue;

    if (
      params.reschedulingModuleIds.has(
        String(session.timetable_module_id ?? "").trim()
      )
    ) {
      continue;
    }

    if (
      params.reschedulingInstanceCodes.has(
        String(session.module_instance_code ?? "").trim()
      )
    ) {
      continue;
    }

    const instanceCode = String(session.module_instance_code ?? "").trim();
    const timetableModule = moduleByInstanceCode.get(instanceCode);

    if (!timetableModule || timetableModule.module_term !== params.term) {
      continue;
    }

    const dateIso = String(session.session_date ?? "").slice(0, 10);
    if (!dateIso) continue;

    const jsDay = new Date(`${dateIso}T00:00:00`).getDay();
    if (jsDay === 0) continue;

    const weekday = jsDay as Weekday;
    const start = String(session.start_time ?? "").slice(0, 5);
    const end = String(session.end_time ?? "").slice(0, 5);
    const roomCode = String(session.room_code ?? "").trim();

    if (!start || !end || !roomCode) continue;

    const weeklyIdentity = `${instanceCode}|${weekday}|${start}|${end}|${roomCode}`;
    if (seenWeekly.has(weeklyIdentity)) continue;
    seenWeekly.add(weeklyIdentity);

    const slotKey = buildWeeklyTimeslotKey({ weekday, start, end });
    const teacherName = String(session.teacher_name ?? "").trim();

    if (teacherName) {
      params.takenTeacherSlots.add(teacherSlotKey(teacherName, slotKey));
    }

    params.takenRoomSlots.add(roomSlotKey(roomCode, slotKey));

    const programmeCode = String(timetableModule.programme_code ?? "").trim();
    const moduleYear = String(timetableModule.module_year ?? "").trim();

    if (!programmeCode || !moduleYear) continue;

    const schedulingIdentities = schedulingIdentitiesForModule(
      timetableModule,
      membersByCombineGroupId
    );

    if (schedulingIdentities.length === 0) continue;

    recordAutoSchedulePlacement({
      programmeCode,
      streamKey: normalizeSchedulingStream(timetableModule.stream_code),
      moduleYear,
      schedulingIdentities,
      alignKey: buildModuleStreamAlignKey(
        programmeCode,
        String(session.module_code ?? timetableModule.base_module_code ?? "").trim()
      ),
      slotKey,
      streamYearTimeslotState: params.streamYearTimeslotState,
      streamSlotByModule: params.streamSlotByModule,
      streamYearOccupiedSlots: params.streamYearOccupiedSlots,
      streamAllOccupiedSlots: params.streamAllOccupiedSlots,
      programmeSlotStreams: params.programmeSlotStreams,
    });
  }
}

export async function autoScheduleInstances(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  programmeCode?: string;
  instances: TimetableModuleInstanceRow[];
  classrooms: TimetableClassroomRow[];
  preferredStartByCode: Record<string, string>; // HH:mm, empty = any time
  /** When true, delete and replace existing sessions for instances in this run. */
  forceReschedule?: boolean;
}) {
  const forceReschedule = params.forceReschedule === true;
  const instancesByCode = new Map<string, TimetableModuleInstanceRow>();
  for (const instance of params.instances) {
    const code = String(instance.module_instance_code ?? "").trim();
    if (!code) continue;
    instancesByCode.set(code, instance);
  }
  const instances = Array.from(instancesByCode.values());

  const timetableModules = await listTimetableModulesByInstanceCodes({
    academicYear: params.academicYear,
    moduleInstanceCodes: instances.map((i) => i.module_instance_code),
  });
  const moduleByInstanceCode = new Map(
    timetableModules.map((m) => [m.module_instance_code, m])
  );

  const combineGroupIds = Array.from(
    new Set(
      timetableModules
        .map((m) => String(m.combine_group_id ?? "").trim())
        .filter(Boolean)
    )
  );
  const membersByCombineGroupId = await loadPlanningModulesByCombineGroupIds({
    academicYear: params.academicYear,
    combineGroupIds,
  });

  function effectiveModuleCodeForInstance(instance: TimetableModuleInstanceRow) {
    const timetableModule = moduleByInstanceCode.get(instance.module_instance_code);
    const groupId = String(timetableModule?.combine_group_id ?? "").trim();
    if (groupId) {
      const members = membersByCombineGroupId.get(groupId) ?? [];
      const resolved = resolveBaseModuleCodeForProgramme({
        members,
        programmeCode: params.programmeCode,
      });
      if (resolved) return resolved;
    }
    return String(instance.module_code ?? timetableModule?.base_module_code ?? "").trim();
  }

  function displayModuleCodeForInstance(instance: TimetableModuleInstanceRow) {
    const timetableModule = moduleByInstanceCode.get(instance.module_instance_code);
    const groupId = String(timetableModule?.combine_group_id ?? "").trim();

    if (groupId) {
      const members = membersByCombineGroupId.get(groupId) ?? [];
      const joined = joinUniqueModuleCodes(
        members.map((member) => member.module_code)
      );
      if (joined) return joined;
    }

    return (
      effectiveModuleCodeForInstance(instance) ||
      String(instance.module_code ?? "").trim()
    );
  }

  function displayModuleNameForInstance(instance: TimetableModuleInstanceRow) {
    const timetableModule = moduleByInstanceCode.get(instance.module_instance_code);
    const groupId = String(timetableModule?.combine_group_id ?? "").trim();

    if (groupId) {
      const members = membersByCombineGroupId.get(groupId) ?? [];
      const names = members
        .map((member) => member.module_name || member.module_code)
        .filter(Boolean);
      if (names.length > 0) {
        return names
          .filter((name, index, arr) => arr.indexOf(name) === index)
          .join(" / ");
      }
    }

    return instance.module_name;
  }

  let skippedAlreadyScheduledCount = 0;
  let toSchedule = instances;
  if (!forceReschedule) {
    const scheduledModuleIds = await listScheduledTimetableModuleIds({
      academicYear: params.academicYear,
    });
    toSchedule = instances.filter((i) => {
      const mod = moduleByInstanceCode.get(i.module_instance_code);
      if (!mod) return true;
      return !scheduledModuleIds.has(mod.id);
    });
    skippedAlreadyScheduledCount = instances.length - toSchedule.length;
  }

  // Load teacher NA for teachers referenced by toSchedule.
  const teacherNames = Array.from(
    new Set(
      toSchedule
        .map((i) => String(i.instance_teacher_name ?? "").trim())
        .filter(Boolean)
    )
  );
  const [naRows, teacherCatalog, usesComputerMap] = await Promise.all([
    listTeacherNotAvailableForTeachers({
      academicYear: params.academicYear,
      teacherNames,
    }),
    listTeachers(params.academicYear),
    loadModuleUsesComputerMap(),
  ]);
  const ftTeacherNames = buildFtTeacherNameSet(teacherCatalog);

  const naSet = new Set<string>();
  for (const row of naRows) {
    naSet.add(`${row.teacher_name}||${row.weekday}||${row.period}`);
  }

  for (const name of teacherNames) {
    if (instanceTeacherIncludesFt(name, ftTeacherNames)) {
      applyFtWednesdayAmInstitutionalBlock({ naSet, teacherName: name });
    }
  }

  const reschedulingModuleIds = new Set<string>();
  const reschedulingInstanceCodes = new Set<string>();

  for (const instance of toSchedule) {
    const code = String(instance.module_instance_code ?? "").trim();
    if (code) reschedulingInstanceCodes.add(code);
    const mod = moduleByInstanceCode.get(code);
    if (mod?.id) reschedulingModuleIds.add(mod.id);
  }

  if (forceReschedule && reschedulingModuleIds.size > 0) {
    await deleteTimetableSessionsForModuleIds({
      timetableModuleIds: Array.from(reschedulingModuleIds),
    });
    await deleteTimetableSessionsForInstanceCodes({
      moduleInstanceCodes: Array.from(reschedulingInstanceCodes),
    });
  }

  // Existing sessions for global conflicts (exclude modules being rescheduled).
  const existingSessions = await listTimetableSessions({
    academicYear: params.academicYear,
  });

  const existingByDate = new Map<string, TimetableSessionRow[]>();
  for (const s of existingSessions) {
    if (s.status === "cancel") continue;
    if (reschedulingModuleIds.has(String(s.timetable_module_id ?? "").trim())) {
      continue;
    }
    if (
      reschedulingInstanceCodes.has(
        String(s.module_instance_code ?? "").trim()
      )
    ) {
      continue;
    }
    const date = String(s.session_date).slice(0, 10);
    const list = existingByDate.get(date) ?? [];
    list.push(s);
    existingByDate.set(date, list);
  }

  // In-run taken sets for quick checks.
  const takenTeacherSlots = new Set<string>();
  const takenRoomSlots = new Set<string>();
  const streamYearTimeslotState: StreamYearTimeslotState =
    createStreamYearTimeslotState();
  const streamSlotByModule = new Map<string, Map<string, string>>();
  const streamYearOccupiedSlots = new Map<string, Set<string>>();
  const streamAllOccupiedSlots = new Map<string, Set<string>>();
  const programmeSlotStreams = new Map<string, Map<string, Set<string>>>();

  await seedAutoScheduleFromExistingSessions({
    academicYear: params.academicYear,
    term: params.term,
    existingSessions,
    reschedulingModuleIds,
    reschedulingInstanceCodes,
    takenTeacherSlots,
    takenRoomSlots,
    streamYearTimeslotState,
    streamSlotByModule,
    streamYearOccupiedSlots,
    streamAllOccupiedSlots,
    programmeSlotStreams,
  });

  const failures: AutoScheduleFailure[] = [];
  const placedTimetableModuleIds = new Set<string>();
  const scheduled: Array<{
    instance: TimetableModuleInstanceRow;
    weekday: Weekday;
    start: string;
    end: string;
    roomCode: string;
    teacherName: string;
    moduleSize: number;
    timetableModuleId: string;
  }> = [];

  // Sort: schedule harder ones first (Night fixed time; computer room; large classes).
  const sorted = [...toSchedule].sort((a, b) => {
    const aMode = String(a.instance_mode ?? "");
    const bMode = String(b.instance_mode ?? "");
    const aNight = aMode === "Night" ? 0 : 1;
    const bNight = bMode === "Night" ? 0 : 1;
    if (aNight !== bNight) return aNight - bNight;
    const aSize = Number(a.instance_expected_size ?? 0);
    const bSize = Number(b.instance_expected_size ?? 0);
    return bSize - aSize;
  });

  for (const instance of sorted) {
    const teacherName = String(instance.instance_teacher_name ?? "").trim();
    if (!teacherName) {
      failures.push(
        buildAutoScheduleFailure({
          instance,
          timetableModule: {
            programme_code: "",
            stream_code: "",
            module_year: null,
            mode: instance.instance_mode,
          },
          start: NIGHT_START,
          end: NIGHT_END,
          reason: "Missing teacher name on instance.",
        })
      );
      continue;
    }

    const timetableModule = moduleByInstanceCode.get(instance.module_instance_code);
    if (!timetableModule) {
      failures.push(
        buildAutoScheduleFailure({
          instance,
          timetableModule: {
            programme_code: "",
            stream_code: "",
            module_year: null,
            mode: instance.instance_mode,
          },
          start: NIGHT_START,
          end: NIGHT_END,
          reason: "Missing timetable_modules row for this instance code.",
        })
      );
      continue;
    }

    if (placedTimetableModuleIds.has(timetableModule.id)) {
      failures.push(
        buildAutoScheduleFailure({
          instance,
          timetableModule,
          start: NIGHT_START,
          end: NIGHT_END,
          reason:
            "This timetable module already has a slot assigned in this auto-schedule run.",
        })
      );
      continue;
    }

    const moduleYear = String(timetableModule.module_year ?? "").trim();
    if (!moduleYear) {
      failures.push(
        buildAutoScheduleFailure({
          instance,
          timetableModule,
          start: NIGHT_START,
          end: NIGHT_END,
          reason: "Missing module_year (required for conflict rule).",
        })
      );
      continue;
    }

    const size = Number(instance.instance_expected_size ?? 0);
    const mode = resolveInstanceMode(instance, timetableModule);
    const preferredStart =
      params.preferredStartByCode[instance.module_instance_code];
    const startWindows = resolveAutoScheduleStartWindows({
      mode,
      preferredStart,
    });
    const slotAttempts = resolveAutoScheduleSlotAttempts({
      mode,
      preferredStart,
    });
    const failureTimeWindow = formatAutoScheduleTimeWindow(mode, startWindows);
    const diagnosticWindow = startWindows[0] ?? {
      start: NIGHT_START,
      end: NIGHT_END,
    };

    const effectiveModuleCode = effectiveModuleCodeForInstance(instance);
    const programmeCode = String(timetableModule.programme_code ?? "").trim();
    const catalogKey = buildModuleCatalogKey(programmeCode, effectiveModuleCode);
    const usesComputerFlag = usesComputerMap.get(catalogKey);

    const requiresComputer = moduleRequiresComputerRoom({
      programmeCode: params.programmeCode,
      effectiveModuleCode,
      moduleInstanceCode: instance.module_instance_code,
      usesComputerFlag,
    });

    const rooms = chooseRoomOrder({
      size,
      requiresComputer,
      classrooms: params.classrooms,
    });

    if (rooms.length === 0) {
      const computerRooms = params.classrooms.filter(
        (r) => r.room_type === "computer"
      );
      const capacityHint = requiresComputer
        ? computerRooms
            .map(
              (r) =>
                `${r.room_code}(${effectiveRoomCapacity(r, true)})`
            )
            .join(", ") || "none"
        : "";

      failures.push(
        buildAutoScheduleFailure({
          instance,
          timetableModule,
          start: diagnosticWindow.start,
          end: diagnosticWindow.end,
          reason: requiresComputer
            ? `No computer room fits ${size} students (capacities incl. +10: ${capacityHint}).`
            : `No room fits ${size} students.`,
        })
      );
      continue;
    }

    const streamKey = normalizeSchedulingStream(timetableModule.stream_code);
    const alignKey = buildModuleStreamAlignKey(
      programmeCode,
      effectiveModuleCode
    );
    const schedulingIdentities = schedulingIdentitiesForModule(
      timetableModule,
      membersByCombineGroupId
    );

    type PlacementCandidate = {
      weekday: Weekday;
      start: string;
      end: string;
      slotKey: string;
      room: TimetableClassroomRow;
      score: number;
    };

    const candidates: PlacementCandidate[] = [];

    for (const { weekday, start, end } of slotAttempts) {
      const period = getPeriodForStartTime(start);

      if (naSet.has(`${teacherName}||${weekday}||${period}`)) {
        continue;
      }

      const slotKey = buildTimeslotKey({ weekday, start, end });
      if (takenTeacherSlots.has(teacherSlotKey(teacherName, slotKey))) {
        continue;
      }

      const dates = await buildTeachingDatesForWeekday({
        academicYear: params.academicYear,
        term: params.term,
        weekday,
      });

      for (const room of rooms) {
        if (takenRoomSlots.has(roomSlotKey(room.room_code, slotKey))) {
          continue;
        }

        let conflict = false;
        for (const date of dates) {
          const existing = existingByDate.get(date) ?? [];
          const overlapped = existing.some((s) => {
            if (s.status === "cancel") return false;
            const sStart = String(s.start_time).slice(0, 5);
            const sEnd = String(s.end_time).slice(0, 5);
            if (!overlaps({ start, end }, { start: sStart, end: sEnd })) {
              return false;
            }
            if (s.room_code === room.room_code) return true;
            if (String(s.teacher_name ?? "").trim() === teacherName) return true;
            return false;
          });
          if (overlapped) {
            conflict = true;
            break;
          }
        }

        if (conflict) continue;

        const score = scoreAutoScheduleSlot({
          slotKey,
          streamKey,
          moduleYear,
          alignKey,
          programmeCode,
          schedulingIdentities,
          streamYearTimeslotState,
          streamSlotByModule,
          streamYearOccupiedSlots,
          streamAllOccupiedSlots,
          programmeSlotStreams,
        });

        if (score === null) continue;

        let placementScore = score;
        // Prefer Saturday daytime for Night when a preferred start is set.
        if (mode === "Night" && weekday === 6 && preferredStart) {
          placementScore += 150;
        }

        candidates.push({
          weekday,
          start,
          end,
          slotKey,
          room,
          score: placementScore,
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    const best = candidates[0];
    let placed = false;

    if (best) {
      takenTeacherSlots.add(teacherSlotKey(teacherName, best.slotKey));
      takenRoomSlots.add(roomSlotKey(best.room.room_code, best.slotKey));

      recordAutoSchedulePlacement({
        programmeCode,
        streamKey,
        moduleYear,
        alignKey,
        schedulingIdentities,
        slotKey: best.slotKey,
        streamYearTimeslotState,
        streamSlotByModule,
        streamYearOccupiedSlots,
        streamAllOccupiedSlots,
        programmeSlotStreams,
      });

      scheduled.push({
        instance,
        weekday: best.weekday,
        start: best.start,
        end: best.end,
        roomCode: best.room.room_code,
        teacherName,
        moduleSize: size,
        timetableModuleId: timetableModule.id,
      });
      placedTimetableModuleIds.add(timetableModule.id);
      placed = true;
    }

    if (!placed) {
      const teachingDatesByWeekday = new Map<Weekday, string[]>();
      const weekdaysTried = Array.from(
        new Set(slotAttempts.map((attempt) => attempt.weekday))
      ) as Weekday[];

      for (const weekday of weekdaysTried) {
        teachingDatesByWeekday.set(
          weekday,
          await buildTeachingDatesForWeekday({
            academicYear: params.academicYear,
            term: params.term,
            weekday,
          })
        );
      }

      const weekdayDetail = buildWeekdayFailureDetail({
        weekdays: weekdaysTried,
        start: diagnosticWindow.start,
        end: diagnosticWindow.end,
        period: getPeriodForStartTime(diagnosticWindow.start),
        teacherName,
        programmeCode,
        streamKey,
        moduleYear,
        schedulingIdentities,
        alignKey,
        rooms,
        naSet,
        takenTeacherSlots,
        takenRoomSlots,
        existingByDate,
        streamYearTimeslotState,
        streamSlotByModule,
        streamYearOccupiedSlots,
        streamAllOccupiedSlots,
        programmeSlotStreams,
        teachingDatesByWeekday,
      });

      const modeHint =
        mode !== "Night" && String(timetableModule.mode ?? "").trim() === "Night"
          ? " Scheduled as Day (instance_mode empty; timetable mode is Night — set instance mode or re-sync instances)."
          : "";

      failures.push(
        buildAutoScheduleFailure({
          instance,
          timetableModule,
          start: diagnosticWindow.start,
          end: diagnosticWindow.end,
          reason: `No feasible slot (${failureTimeWindow}).${modeHint}`,
          weekdayDetail,
        })
      );
    }
  }

  // Expand weekly placements to per-date sessions and insert.
  const rowsToInsert: Array<
    Omit<TimetableSessionRow, "id" | "created_at" | "updated_at">
  > = [];

  for (const s of scheduled) {
      const dates = await buildTeachingDatesForWeekday({
        academicYear: params.academicYear,
        term: params.term,
        weekday: s.weekday,
      });

    for (const date of dates) {
      rowsToInsert.push({
        academic_year: params.academicYear,
        timetable_module_id: s.timetableModuleId,
        module_instance_code: s.instance.module_instance_code,
        module_code: displayModuleCodeForInstance(s.instance) || s.instance.module_code,
        module_name: displayModuleNameForInstance(s.instance) ?? s.instance.module_name,
        session_date: date,
        start_time: normalizeSessionTime(s.start),
        end_time: normalizeSessionTime(s.end),
        room_code: s.roomCode,
        status: "normal",
        session_number: null,
        session_label: null,
        session_kind: null,
        remark: null,
        teacher_name: s.teacherName,
        module_size: s.moduleSize,
      });
    }
  }

  await createTimetableSessions({
    academicYear: params.academicYear,
    rows: rowsToInsert,
  });

  return {
    scheduledCount: scheduled.length,
    skippedAlreadyScheduledCount,
    failedCount: failures.length,
    failures,
  };
}

