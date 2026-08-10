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

type RoomSlot = {
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
 * Detect same-room weekly timetable clashes for a term.
 * Uses the weekly pattern (weekday + start/end) derived from daily sessions,
 * so repeated term weeks collapse to one conflict row per pattern pair.
 *
 * Same teacher on both overlapping modules is not treated as a classroom conflict
 * (e.g. different subjects intentionally sharing a room with one teacher).
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

  const seenPattern = new Set<string>();
  const slots: RoomSlot[] = [];

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

    const dedupeKey = `${roomCode.toUpperCase()}|${instanceCode}|${jsDay}|${start}|${end}`;
    if (seenPattern.has(dedupeKey)) continue;
    seenPattern.add(dedupeKey);

    const module =
      moduleById.get(normalizeText(session.timetable_module_id)) ??
      moduleByInstance.get(instanceCode);

    const teacherName = normalizeText(session.teacher_name);

    slots.push({
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

  const byRoomWeekday = new Map<string, RoomSlot[]>();
  for (const slot of slots) {
    const key = `${slot.roomCode.toUpperCase()}|${slot.weekday}`;
    const list = byRoomWeekday.get(key) ?? [];
    list.push(slot);
    byRoomWeekday.set(key, list);
  }

  const conflicts: ClassroomWeeklyConflict[] = [];
  const conflictKeys = new Set<string>();

  for (const group of byRoomWeekday.values()) {
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

        if (conflictKeys.has(key)) continue;
        conflictKeys.add(key);

        conflicts.push({
          roomCode: left.roomCode,
          weekday: left.weekday,
          weekdayLabel: schedulingWeekdayLabel(left.weekday),
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
        });
      }
    }
  }

  conflicts.sort((a, b) => {
    const room = a.roomCode.localeCompare(b.roomCode);
    if (room !== 0) return room;
    if (a.weekday !== b.weekday) return a.weekday - b.weekday;
    return a.overlapStart.localeCompare(b.overlapStart);
  });

  const rooms = new Set(slots.map((slot) => slot.roomCode.toUpperCase()));

  return {
    conflicts,
    sessionCount: termSessions.length,
    roomCount: rooms.size,
    moduleCount: modules.length,
  };
}
