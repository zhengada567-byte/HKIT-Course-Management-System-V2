import type { TimetableModuleInstanceRow } from "./timetableModuleInstanceService";
import type { TimetableClassroomRow, TimetableScheduleTerm, TimetableSessionRow } from "./timetableScheduleService";
import {
  buildExcludedIsoDatesForTerm,
  createTimetableSessions,
  deleteTimetableSessionsForInstanceCodes,
  deleteTimetableSessionsForModuleIds,
  effectiveRoomCapacity,
  isDateExcludedForTeaching,
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
  buildModuleStreamAlignKey,
  instanceTeacherIncludesFt,
  buildFtTeacherNameSet,
  buildWeeklyTimeslotKey,
  createStreamYearTimeslotState,
  normalizeSchedulingStream,
  recordAutoSchedulePlacement,
  SCHEDULING_WEEKDAYS,
  scoreAutoScheduleSlot,
  type StreamYearTimeslotState,
} from "../lib/timetableSchedulingRules";

export type AutoScheduleFailure = { code: string; reason: string };
import { addDays, toIsoDateString } from "../lib/academicCalendar";
import { loadPlanningModulesByCombineGroupIds } from "./splitClassService";
import { buildModuleCatalogKey, loadModuleUsesComputerMap } from "./moduleService";
import { listTeachers } from "./teacherService";
import { listTimetableModulesByInstanceCodes } from "./timetableService";
import { listTeacherNotAvailableForTeachers } from "./timetableTeacherAvailabilityService";

type Weekday = 1 | 2 | 3 | 4 | 5 | 6; // Mon..Sat

type Period = "AM" | "PM" | "EVENING";

const NIGHT_START = "18:30";
const NIGHT_END = "22:30";

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

    recordAutoSchedulePlacement({
      programmeCode,
      streamKey: normalizeSchedulingStream(timetableModule.stream_code),
      moduleYear,
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

async function buildTeachingDates(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  weekday: Weekday;
}) {
  const excluded = await buildExcludedIsoDatesForTerm({
    academicYear: params.academicYear,
    term: params.term,
  });

  const dates: string[] = [];
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

export async function autoScheduleInstances(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  programmeCode?: string;
  instances: TimetableModuleInstanceRow[];
  classrooms: TimetableClassroomRow[];
  preferredStartByCode: Record<string, string>; // HH:mm
  /** When true (default), replace existing sessions for instances in this run. */
  forceReschedule?: boolean;
}) {
  const forceReschedule = params.forceReschedule !== false;
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
      failures.push({
        code: instance.module_instance_code,
        reason: "Missing teacher name on instance.",
      });
      continue;
    }

    const timetableModule = moduleByInstanceCode.get(instance.module_instance_code);
    if (!timetableModule) {
      failures.push({
        code: instance.module_instance_code,
        reason: "Missing timetable_modules row for this instance code.",
      });
      continue;
    }

    if (placedTimetableModuleIds.has(timetableModule.id)) {
      failures.push({
        code: instance.module_instance_code,
        reason:
          "This timetable module already has a slot assigned in this auto-schedule run.",
      });
      continue;
    }

    const moduleYear = String(timetableModule.module_year ?? "").trim();
    if (!moduleYear) {
      failures.push({
        code: instance.module_instance_code,
        reason: "Missing module_year (required for conflict rule).",
      });
      continue;
    }

    const size = Number(instance.instance_expected_size ?? 0);
    const mode = String(instance.instance_mode ?? "").trim();

    let start = NIGHT_START;
    let end = NIGHT_END;
    if (mode === "Night") {
      start = NIGHT_START;
      end = NIGHT_END;
    } else {
      const preferred =
        params.preferredStartByCode[instance.module_instance_code] ?? "";
      start = preferred || "09:00";
      end = addHours(start, 4);
    }

    const period = getPeriodForStartTime(start);

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

      failures.push({
        code: instance.module_instance_code,
        reason: requiresComputer
          ? `No computer room fits ${size} students (capacities incl. +10: ${capacityHint}).`
          : `No room fits ${size} students.`,
      });
      continue;
    }

    const streamKey = normalizeSchedulingStream(timetableModule.stream_code);
    const alignKey = buildModuleStreamAlignKey(
      programmeCode,
      effectiveModuleCode
    );

    type PlacementCandidate = {
      weekday: Weekday;
      slotKey: string;
      room: TimetableClassroomRow;
      score: number;
    };

    const candidates: PlacementCandidate[] = [];

    for (const weekday of SCHEDULING_WEEKDAYS) {
      if (naSet.has(`${teacherName}||${weekday}||${period}`)) {
        continue;
      }

      const slotKey = buildTimeslotKey({ weekday, start, end });
      if (takenTeacherSlots.has(teacherSlotKey(teacherName, slotKey))) {
        continue;
      }

      const dates = await buildTeachingDates({
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
          streamYearTimeslotState,
          streamSlotByModule,
          streamYearOccupiedSlots,
          streamAllOccupiedSlots,
          programmeSlotStreams,
        });

        if (score === null) continue;

        candidates.push({
          weekday,
          slotKey,
          room,
          score,
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
        start,
        end,
        roomCode: best.room.room_code,
        teacherName,
        moduleSize: size,
        timetableModuleId: timetableModule.id,
      });
      placedTimetableModuleIds.add(timetableModule.id);
      placed = true;
    }

    if (!placed) {
      failures.push({
        code: instance.module_instance_code,
        reason:
          "No feasible Mon–Fri timeslot/room (Saturday not used; same programme+stream+year must not share a slot; teacher NA; teacher/room occupied; room size/type).",
      });
    }
  }

  // Expand weekly placements to per-date sessions and insert.
  const rowsToInsert: Array<
    Omit<TimetableSessionRow, "id" | "created_at" | "updated_at">
  > = [];

  for (const s of scheduled) {
    const dates = await buildTeachingDates({
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

