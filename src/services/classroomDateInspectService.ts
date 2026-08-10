import {
  normalizeTeacherNameKey,
  schedulingWeekdayLabel,
} from "../lib/timetableSchedulingRules";
import { normalizeAcademicYear } from "../lib/utils";
import { listTimetableModules } from "./timetableService";
import {
  listTimetableClassrooms,
  listTimetableSessions,
  type TimetableClassroomRow,
} from "./timetableScheduleService";

export type ClassroomDateSessionRow = {
  sessionId: string;
  start: string;
  end: string;
  roomCode: string;
  moduleCode: string;
  moduleInstanceCode: string;
  moduleName: string;
  programmeCode: string;
  teacherName: string;
  sessionLabel: string;
  deliveryMode: string;
};

export type ClassroomDateConflict = {
  roomCode: string;
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

export type ClassroomDateRoomOccupancy = {
  roomCode: string;
  location: string;
  roomSize: number;
  roomType: string;
  occupiedWindows: Array<{ start: string; end: string }>;
  sessions: ClassroomDateSessionRow[];
  isFullyFree: boolean;
};

export type ClassroomDateInspectResult = {
  date: string;
  weekday: number;
  weekdayLabel: string;
  sessions: ClassroomDateSessionRow[];
  conflicts: ClassroomDateConflict[];
  rooms: ClassroomDateRoomOccupancy[];
  freeRoomCount: number;
  physicalSessionCount: number;
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

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

function mergeOccupiedWindows(
  windows: Array<{ start: string; end: string }>
): Array<{ start: string; end: string }> {
  if (windows.length === 0) return [];
  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  const merged: Array<{ start: string; end: string }> = [
    { ...sorted[0]! },
  ];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (timeToMinutes(current.start) <= timeToMinutes(last.end)) {
      if (timeToMinutes(current.end) > timeToMinutes(last.end)) {
        last.end = current.end;
      }
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/**
 * Inspect all academic-year sessions on one calendar date (all programmes).
 * Used to check room occupancy / free rooms and same-day room clashes.
 */
export async function inspectClassroomsByDate(params: {
  academicYear: string;
  sessionDate: string;
}): Promise<ClassroomDateInspectResult> {
  const academicYear = normalizeAcademicYear(params.academicYear);
  const date = String(params.sessionDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid session date.");
  }

  const jsDay = new Date(`${date}T00:00:00`).getDay();
  const weekdayLabel = schedulingWeekdayLabel(jsDay);

  const [sessions, modules, classrooms] = await Promise.all([
    listTimetableSessions({ academicYear, sessionDate: date }),
    listTimetableModules({ academicYear }),
    listTimetableClassrooms(),
  ]);

  const moduleById = new Map(modules.map((row) => [row.id, row] as const));
  const moduleByInstance = new Map(
    modules.map((row) => [
      normalizeText(row.module_instance_code).toUpperCase(),
      row,
    ] as const)
  );

  const rows: ClassroomDateSessionRow[] = [];
  for (const session of sessions) {
    if (session.status === "cancel") continue;

    const instanceCode = normalizeText(session.module_instance_code).toUpperCase();
    const start = String(session.start_time ?? "").slice(0, 5);
    const end = String(session.end_time ?? "").slice(0, 5);
    if (!start || !end) continue;
    if (!Number.isFinite(timeToMinutes(start)) || !Number.isFinite(timeToMinutes(end))) {
      continue;
    }
    if (timeToMinutes(start) >= timeToMinutes(end)) continue;

    const module =
      moduleById.get(normalizeText(session.timetable_module_id)) ??
      moduleByInstance.get(instanceCode);

    rows.push({
      sessionId: session.id,
      start,
      end,
      roomCode: normalizeText(session.room_code) || "—",
      moduleCode:
        normalizeText(module?.base_module_code) ||
        normalizeText(session.module_code) ||
        instanceCode,
      moduleInstanceCode: instanceCode || "—",
      moduleName:
        normalizeText(session.module_name) ||
        normalizeText(module?.module_name),
      programmeCode: normalizeText(module?.programme_code),
      teacherName: normalizeText(session.teacher_name),
      sessionLabel: normalizeText(session.session_label),
      deliveryMode: normalizeText(session.delivery_mode),
    });
  }

  rows.sort((a, b) => {
    if (a.start !== b.start) return a.start.localeCompare(b.start);
    if (a.roomCode !== b.roomCode) return a.roomCode.localeCompare(b.roomCode);
    return a.moduleInstanceCode.localeCompare(b.moduleInstanceCode);
  });

  const conflicts: ClassroomDateConflict[] = [];
  const conflictKeys = new Set<string>();
  const physicalRows = rows.filter((row) => !isIgnorableRoom(row.roomCode));
  const byRoom = new Map<string, ClassroomDateSessionRow[]>();
  for (const row of physicalRows) {
    const key = row.roomCode.toUpperCase();
    const list = byRoom.get(key) ?? [];
    list.push(row);
    byRoom.set(key, list);
  }

  for (const group of byRoom.values()) {
    for (let i = 0; i < group.length; i += 1) {
      const a = group[i]!;
      const teacherA = teacherIdentityKey(a.teacherName);
      for (let j = i + 1; j < group.length; j += 1) {
        const b = group[j]!;
        if (a.moduleInstanceCode === b.moduleInstanceCode) continue;
        if (!overlaps(a, b)) continue;
        const teacherB = teacherIdentityKey(b.teacherName);
        if (teacherA && teacherB && teacherA === teacherB) continue;

        const [left, right] =
          a.moduleInstanceCode.localeCompare(b.moduleInstanceCode) <= 0
            ? [a, b]
            : [b, a];
        const window = overlapWindow(left, right);
        const key = [
          left.roomCode.toUpperCase(),
          window.start,
          window.end,
          left.moduleInstanceCode,
          right.moduleInstanceCode,
        ].join("|");
        if (conflictKeys.has(key)) continue;
        conflictKeys.add(key);

        conflicts.push({
          roomCode: left.roomCode,
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
    return a.overlapStart.localeCompare(b.overlapStart);
  });

  const classroomByCode = new Map<string, TimetableClassroomRow>();
  for (const room of classrooms) {
    classroomByCode.set(normalizeText(room.room_code).toUpperCase(), room);
  }

  // Include any physical rooms used that day even if not in classroom master list.
  for (const row of physicalRows) {
    const key = row.roomCode.toUpperCase();
    if (!classroomByCode.has(key)) {
      classroomByCode.set(key, {
        room_code: row.roomCode,
        location: "",
        room_number: "",
        room_size: 0,
        room_type: "normal",
      });
    }
  }

  const rooms: ClassroomDateRoomOccupancy[] = Array.from(classroomByCode.values())
    .map((room) => {
      const roomCode = normalizeText(room.room_code);
      const roomSessions = physicalRows.filter(
        (row) => row.roomCode.toUpperCase() === roomCode.toUpperCase()
      );
      const occupiedWindows = mergeOccupiedWindows(
        roomSessions.map((row) => ({ start: row.start, end: row.end }))
      );
      return {
        roomCode,
        location: normalizeText(room.location),
        roomSize: Number(room.room_size) || 0,
        roomType: normalizeText(room.room_type) || "normal",
        occupiedWindows,
        sessions: roomSessions,
        isFullyFree: occupiedWindows.length === 0,
      };
    })
    .sort((a, b) => a.roomCode.localeCompare(b.roomCode));

  return {
    date,
    weekday: jsDay,
    weekdayLabel,
    sessions: rows,
    conflicts,
    rooms,
    freeRoomCount: rooms.filter((room) => room.isFullyFree).length,
    physicalSessionCount: physicalRows.length,
  };
}
