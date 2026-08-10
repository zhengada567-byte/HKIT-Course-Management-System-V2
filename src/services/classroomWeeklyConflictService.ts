import {
  normalizeTeacherNameKey,
  schedulingWeekdayLabel,
} from "../lib/timetableSchedulingRules";
import { normalizeAcademicYear } from "../lib/utils";
import { listTimetableModules } from "./timetableService";
import {
  listTimetableSessions,
  type TimetableScheduleTerm,
} from "./timetableScheduleService";

export type ClassroomWeeklyConflict = {
  roomCode: string;
  weekday: number;
  weekdayLabel: string;
  /** Calendar dates where both modules actually clash in this room. */
  overlapDates: string[];
  overlapStart: string;
  overlapEnd: string;
  moduleCodeA: string;
  moduleInstanceCodeA: string;
  programmeCodeA: string;
  teacherNameA: string;
  timeWindowA: string;
  moduleCodeB: string;
  moduleInstanceCodeB: string;
  programmeCodeB: string;
  teacherNameB: string;
  timeWindowB: string;
};

export type ClassroomWeeklyConflictResult = {
  conflicts: ClassroomWeeklyConflict[];
  sessionCount: number;
  roomCount: number;
  moduleCount: number;
};

type DaySlot = {
  date: string;
  roomCode: string;
  weekday: number;
  start: string;
  end: string;
  moduleCode: string;
  moduleInstanceCode: string;
  programmeCode: string;
  teacherName: string;
  teacherKey: string | null;
};

type AggregatedConflict = ClassroomWeeklyConflict & {
  dateSet: Set<string>;
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

/** Comparable teacher identity; null when unknown / TBC (cannot treat as same teacher). */
function teacherIdentityKey(name: string | null | undefined): string | null {
  const raw = normalizeText(name);
  if (!raw) return null;
  const key = normalizeTeacherNameKey(raw);
  if (!key || key === "tbc") return null;
  return key;
}

function timeToMinutes(value: string) {
  const [hh, mm] = String(value ?? "")
    .slice(0, 5)
    .split(":")
    .map((part) => Number(part));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  return hh * 60 + mm;
}

function overlaps(a: { start: string; end: string }, b: { start: string; end: string }) {
  return (
    timeToMinutes(a.start) < timeToMinutes(b.end) &&
    timeToMinutes(b.start) < timeToMinutes(a.end)
  );
}

function overlapWindow(a: { start: string; end: string }, b: { start: string; end: string }) {
  const start = Math.max(timeToMinutes(a.start), timeToMinutes(b.start));
  const end = Math.min(timeToMinutes(a.end), timeToMinutes(b.end));
  const toTime = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return { start: toTime(start), end: toTime(end) };
}

function isIgnorableRoom(roomCode: string) {
  const room = roomCode.trim().toUpperCase();
  if (!room) return true;
  if (room === "ONLINE" || room === "TBC" || room === "N/A" || room === "-") {
    return true;
  }
  return false;
}

/**
 * Detect same-room timetable clashes for a term by calendar date.
 * Two modules conflict only when they occupy the same room on the same date
 * with overlapping times. Same known teacher is not treated as a conflict.
 * Matching date clashes are collapsed into one row per room / weekday / pair.
 */
export async function detectClassroomWeeklyConflicts(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
}): Promise<ClassroomWeeklyConflictResult> {
  const academicYear = normalizeAcademicYear(params.academicYear);
  const term = params.term;

  const [sessions, modules] = await Promise.all([
    listTimetableSessions({ academicYear }),
    listTimetableModules({ academicYear, moduleTerm: term }),
  ]);

  const moduleById = new Map(
    modules.map((row) => [row.id, row] as const)
  );
  const moduleByInstance = new Map(
    modules.map((row) => [
      normalizeText(row.module_instance_code).toUpperCase(),
      row,
    ] as const)
  );

  const termModuleIds = new Set(modules.map((row) => row.id));
  const termSessions = sessions.filter((row) => {
    if (row.status === "cancel") return false;
    const moduleId = normalizeText(row.timetable_module_id);
    if (moduleId && termModuleIds.has(moduleId)) return true;
    const instance = normalizeText(row.module_instance_code).toUpperCase();
    return Boolean(instance && moduleByInstance.has(instance));
  });

  const daySlots: DaySlot[] = [];
  const seenDaySlot = new Set<string>();

  for (const session of termSessions) {
    const roomCode = normalizeText(session.room_code);
    if (isIgnorableRoom(roomCode)) continue;

    const instanceCode = normalizeText(session.module_instance_code).toUpperCase();
    if (!instanceCode) continue;

    const dateIso = String(session.session_date ?? "").slice(0, 10);
    if (!dateIso) continue;

    const jsDay = new Date(`${dateIso}T00:00:00`).getDay();
    if (jsDay === 0) continue;

    const start = String(session.start_time ?? "").slice(0, 5);
    const end = String(session.end_time ?? "").slice(0, 5);
    if (!start || !end) continue;
    if (!Number.isFinite(timeToMinutes(start)) || !Number.isFinite(timeToMinutes(end))) {
      continue;
    }
    if (timeToMinutes(start) >= timeToMinutes(end)) continue;

    const dayKey = `${roomCode.toUpperCase()}|${dateIso}|${instanceCode}|${start}|${end}`;
    if (seenDaySlot.has(dayKey)) continue;
    seenDaySlot.add(dayKey);

    const module =
      moduleById.get(normalizeText(session.timetable_module_id)) ??
      moduleByInstance.get(instanceCode);

    const teacherName = normalizeText(session.teacher_name);

    daySlots.push({
      date: dateIso,
      roomCode,
      weekday: jsDay,
      start,
      end,
      moduleCode:
        normalizeText(module?.base_module_code) ||
        normalizeText(session.module_code) ||
        instanceCode,
      moduleInstanceCode: instanceCode,
      programmeCode: normalizeText(module?.programme_code),
      teacherName,
      teacherKey: teacherIdentityKey(teacherName),
    });
  }

  const byRoomDate = new Map<string, DaySlot[]>();
  for (const slot of daySlots) {
    const key = `${slot.roomCode.toUpperCase()}|${slot.date}`;
    const list = byRoomDate.get(key) ?? [];
    list.push(slot);
    byRoomDate.set(key, list);
  }

  const aggregated = new Map<string, AggregatedConflict>();

  for (const group of byRoomDate.values()) {
    group.sort((a, b) => {
      if (a.start !== b.start) return a.start.localeCompare(b.start);
      return a.moduleInstanceCode.localeCompare(b.moduleInstanceCode);
    });

    for (let i = 0; i < group.length; i += 1) {
      const a = group[i]!;
      for (let j = i + 1; j < group.length; j += 1) {
        const b = group[j]!;
        if (a.moduleInstanceCode === b.moduleInstanceCode) continue;
        if (!overlaps(a, b)) continue;
        // Different modules with the same known teacher share the room intentionally.
        if (a.teacherKey && b.teacherKey && a.teacherKey === b.teacherKey) {
          continue;
        }

        const [left, right] =
          a.moduleInstanceCode.localeCompare(b.moduleInstanceCode) <= 0
            ? [a, b]
            : [b, a];
        const window = overlapWindow(left, right);
        const key = [
          left.roomCode.toUpperCase(),
          String(left.weekday),
          window.start,
          window.end,
          left.moduleInstanceCode,
          right.moduleInstanceCode,
        ].join("|");

        const existing = aggregated.get(key);
        if (existing) {
          existing.dateSet.add(left.date);
          continue;
        }

        aggregated.set(key, {
          roomCode: left.roomCode,
          weekday: left.weekday,
          weekdayLabel: schedulingWeekdayLabel(left.weekday),
          overlapDates: [],
          overlapStart: window.start,
          overlapEnd: window.end,
          moduleCodeA: left.moduleCode,
          moduleInstanceCodeA: left.moduleInstanceCode,
          programmeCodeA: left.programmeCode,
          teacherNameA: left.teacherName,
          timeWindowA: `${left.start}–${left.end}`,
          moduleCodeB: right.moduleCode,
          moduleInstanceCodeB: right.moduleInstanceCode,
          programmeCodeB: right.programmeCode,
          teacherNameB: right.teacherName,
          timeWindowB: `${right.start}–${right.end}`,
          dateSet: new Set([left.date]),
        });
      }
    }
  }

  const conflicts: ClassroomWeeklyConflict[] = Array.from(aggregated.values()).map(
    (row) => {
      const { dateSet, ...conflict } = row;
      return {
        ...conflict,
        overlapDates: Array.from(dateSet).sort((x, y) => x.localeCompare(y)),
      };
    }
  );

  conflicts.sort((a, b) => {
    const room = a.roomCode.localeCompare(b.roomCode);
    if (room !== 0) return room;
    if (a.weekday !== b.weekday) return a.weekday - b.weekday;
    const dateA = a.overlapDates[0] ?? "";
    const dateB = b.overlapDates[0] ?? "";
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return a.overlapStart.localeCompare(b.overlapStart);
  });

  const rooms = new Set(daySlots.map((slot) => slot.roomCode.toUpperCase()));

  return {
    conflicts,
    sessionCount: termSessions.length,
    roomCount: rooms.size,
    moduleCount: modules.length,
  };
}
