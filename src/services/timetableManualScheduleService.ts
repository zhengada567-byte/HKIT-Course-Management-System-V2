import {
  normalizeProgrammeKey,
  normalizeSchedulingStream,
  normalizeTeacherNameKey,
} from "../lib/timetableSchedulingRules";
import type { TimetableModuleRow } from "../types";
import type { TimetableModuleInstanceRow } from "./timetableModuleInstanceService";
import {
  addHoursToTime,
  buildTeachingDatesForWeekday,
  deleteWeeklyPlacementSessions,
  insertWeeklyPlacementSessions,
  normalizeSessionTime,
  type TimetableClassroomRow,
  type TimetableScheduleTerm,
  type TimetableSessionRow,
} from "./timetableScheduleService";
import { listTimetableModulesByInstanceCodes } from "./timetableService";

export type WeeklyPlacementOccupant = {
  moduleInstanceCode: string;
  moduleCode: string;
  moduleName: string;
  teacherName: string;
  roomCode: string;
  programmeCode: string;
  streamCode: string;
  moduleYear: string;
};

export type WeeklyGridItem = WeeklyPlacementOccupant;

export function wouldWeeklyPlacementConflict(
  existing: WeeklyPlacementOccupant[],
  candidate: WeeklyPlacementOccupant
): string | null {
  const candidateTeacher = normalizeTeacherNameKey(candidate.teacherName);
  const candidateProgramme = normalizeProgrammeKey(candidate.programmeCode);
  const candidateStream = normalizeSchedulingStream(candidate.streamCode);
  const candidateYear = String(candidate.moduleYear ?? "")
    .trim()
    .toUpperCase();

  for (const item of existing) {
    if (
      item.moduleInstanceCode.toUpperCase() ===
      candidate.moduleInstanceCode.toUpperCase()
    ) {
      return `Module instance ${item.moduleInstanceCode} is already in this timeslot.`;
    }

    const sameTeacher =
      Boolean(candidateTeacher) &&
      normalizeTeacherNameKey(item.teacherName) === candidateTeacher;
    const sameProgramme =
      normalizeProgrammeKey(item.programmeCode) === candidateProgramme;
    const sameStream =
      normalizeSchedulingStream(item.streamCode) === candidateStream;
    const sameYear =
      String(item.moduleYear ?? "")
        .trim()
        .toUpperCase() === candidateYear;

    if (sameTeacher && sameProgramme && sameStream && sameYear) {
      return (
        `Conflict with ${item.moduleInstanceCode}: same teacher, programme, stream and year ` +
        `cannot share this weekly timeslot.`
      );
    }
  }

  return null;
}

export function buildWeeklyPlacementOccupant(params: {
  instance: TimetableModuleInstanceRow;
  timetableModule: TimetableModuleRow;
  roomCode: string;
  moduleCode?: string;
  moduleName?: string | null;
}): WeeklyPlacementOccupant {
  return {
    moduleInstanceCode: params.instance.module_instance_code,
    moduleCode:
      params.moduleCode ??
      params.timetableModule.base_module_code ??
      params.instance.module_code,
    moduleName:
      params.moduleName ??
      params.instance.module_name ??
      params.timetableModule.module_name ??
      "",
    teacherName: String(params.instance.instance_teacher_name ?? "").trim(),
    roomCode: params.roomCode,
    programmeCode: String(params.timetableModule.programme_code ?? "").trim(),
    streamCode: String(params.timetableModule.stream_code ?? "").trim(),
    moduleYear: String(params.timetableModule.module_year ?? "").trim(),
  };
}

export async function addModuleToWeeklySlot(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  weekday: 1 | 2 | 3 | 4 | 5 | 6;
  startTime: string;
  endTime: string;
  roomCode: string;
  moduleInstanceCode: string;
  instance: TimetableModuleInstanceRow;
  existingOccupants: WeeklyPlacementOccupant[];
  createdBy?: string | null;
  moduleCode?: string;
  moduleName?: string | null;
}) {
  const instanceCode = String(params.moduleInstanceCode ?? "").trim();
  const roomCode = String(params.roomCode ?? "").trim();

  if (!instanceCode) {
    throw new Error("Module instance code is required.");
  }

  if (!roomCode) {
    throw new Error("Room is required.");
  }

  const [timetableModule] = await listTimetableModulesByInstanceCodes({
    academicYear: params.academicYear,
    moduleInstanceCodes: [instanceCode],
  });

  if (!timetableModule) {
    throw new Error(`No timetable module found for instance code "${instanceCode}".`);
  }

  const moduleYear = String(timetableModule.module_year ?? "").trim();
  if (!moduleYear) {
    throw new Error(`Module year is missing for "${instanceCode}".`);
  }

  const occupant = buildWeeklyPlacementOccupant({
    instance: params.instance,
    timetableModule,
    roomCode,
    moduleCode: params.moduleCode,
    moduleName: params.moduleName,
  });

  const conflict = wouldWeeklyPlacementConflict(
    params.existingOccupants,
    occupant
  );

  if (conflict) {
    throw new Error(conflict);
  }

  const dates = await buildTeachingDatesForWeekday({
    academicYear: params.academicYear,
    term: params.term,
    weekday: params.weekday,
  });

  if (dates.length === 0) {
    throw new Error("No teaching dates found for this weekday in the selected term.");
  }

  const rows: Array<
    Omit<TimetableSessionRow, "id" | "created_at" | "updated_at"> & {
      created_by?: string | null;
    }
  > = dates.map((sessionDate) => ({
    academic_year: params.academicYear,
    timetable_module_id: timetableModule.id,
    module_instance_code: instanceCode,
    module_code: occupant.moduleCode,
    module_name: occupant.moduleName,
    session_date: sessionDate,
    start_time: normalizeSessionTime(params.startTime),
    end_time: normalizeSessionTime(params.endTime),
    room_code: roomCode,
    status: "normal",
    session_number: null,
    teacher_name: occupant.teacherName || null,
    module_size: params.instance.instance_expected_size ?? null,
    created_by: params.createdBy ?? null,
  }));

  await insertWeeklyPlacementSessions({
    academicYear: params.academicYear,
    rows,
  });
}

export async function removeModuleFromWeeklySlot(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  weekday: 1 | 2 | 3 | 4 | 5 | 6;
  startTime: string;
  endTime: string;
  roomCode: string;
  moduleInstanceCode: string;
}) {
  await deleteWeeklyPlacementSessions(params);
}

export function mergeWeeklySlotRows(params: {
  sessionSlots: Array<{ start: string; end: string }>;
  instances: TimetableModuleInstanceRow[];
  preferredStartByCode: Record<string, string>;
  startTimeOptions: string[];
}) {
  const map = new Map<string, { start: string; end: string }>();
  const add = (start: string, end: string) => {
    const key = `${start}-${end}`;
    map.set(key, { start, end });
  };

  for (const slot of params.sessionSlots) {
    add(slot.start, slot.end);
  }

  for (const instance of params.instances) {
    const mode = String(instance.instance_mode ?? "").trim();
    if (mode === "Night") {
      add("18:30", addHoursToTime("18:30", 4));
      continue;
    }

    const preferred =
      params.preferredStartByCode[instance.module_instance_code] || "09:00";
    add(preferred, addHoursToTime(preferred, 4));
  }

  if (map.size === 0) {
    for (const start of params.startTimeOptions) {
      add(start, addHoursToTime(start, 4));
    }
    add("18:30", addHoursToTime("18:30", 4));
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.start !== b.start) return a.start.localeCompare(b.start);
    return a.end.localeCompare(b.end);
  });
}
