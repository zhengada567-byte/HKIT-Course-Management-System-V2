import {
  normalizeProgrammeKey,
  normalizeSchedulingStream,
  normalizeTeacherNameKey,
  resolveSchedulingIdentities,
  schedulingIdentitiesShareStreamYearGroup,
  type SchedulingCombineMember,
  type StreamYearSchedulingIdentity,
} from "../lib/timetableSchedulingRules";
import type { TimetableModuleRow } from "../types";
import type { TimetableModuleInstanceRow } from "./timetableModuleInstanceService";
import { applyTeacherToTimetableModuleInstance } from "./moduleDefaultTimetableSyncService";
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

const WEEKLY_NIGHT_SLOT_START = "18:30";
const WEEKLY_BLOCK_HOURS = 4;

/**
 * Weekly rows are identified by session start time; end time is display-only.
 * Evening starts (≥18:30) collapse to the night row. Night-mode modules may
 * also sit on daytime rows (e.g. Saturday) — do not force them to 18:30.
 */
export function normalizeWeeklySlotStart(
  startTime: string,
  _mode?: string | null
): string {
  const start = String(startTime ?? "").trim().slice(0, 5);

  if (!start) {
    return "09:00";
  }

  if (start >= WEEKLY_NIGHT_SLOT_START) {
    return WEEKLY_NIGHT_SLOT_START;
  }

  return start;
}

export function buildWeeklySlotKey(startTime: string, mode?: string | null): string {
  return normalizeWeeklySlotStart(startTime, mode);
}

export function weeklySlotDisplayEnd(startTime: string, mode?: string | null): string {
  return addHoursToTime(
    normalizeWeeklySlotStart(startTime, mode),
    WEEKLY_BLOCK_HOURS
  );
}

export function weeklySlotRow(
  startTime: string,
  mode?: string | null
): { start: string; end: string } {
  const start = normalizeWeeklySlotStart(startTime, mode);

  return {
    start,
    end: addHoursToTime(start, WEEKLY_BLOCK_HOURS),
  };
}

export type WeeklyPlacementOccupant = {
  moduleInstanceCode: string;
  moduleCode: string;
  moduleName: string;
  teacherName: string;
  roomCode: string;
  programmeCode: string;
  streamCode: string;
  moduleYear: string;
  schedulingIdentities: StreamYearSchedulingIdentity[];
};

export type WeeklyGridItem = WeeklyPlacementOccupant;

export function wouldWeeklyPlacementConflict(
  existing: WeeklyPlacementOccupant[],
  candidate: WeeklyPlacementOccupant
): string | null {
  const candidateTeacher = normalizeTeacherNameKey(candidate.teacherName);

  for (const item of existing) {
    if (
      item.moduleInstanceCode.toUpperCase() ===
      candidate.moduleInstanceCode.toUpperCase()
    ) {
      return `Module instance ${item.moduleInstanceCode} is already in this timeslot.`;
    }

    if (
      schedulingIdentitiesShareStreamYearGroup(
        candidate.schedulingIdentities,
        item.schedulingIdentities
      )
    ) {
      return (
        `Conflict with ${item.moduleInstanceCode}: same programme, stream group and year ` +
        `cannot share this weekly timeslot.`
      );
    }

    const sameTeacher =
      Boolean(candidateTeacher) &&
      normalizeTeacherNameKey(item.teacherName) === candidateTeacher;
    const sameProgramme =
      normalizeProgrammeKey(item.programmeCode) ===
      normalizeProgrammeKey(candidate.programmeCode);
    const sameStream =
      normalizeSchedulingStream(item.streamCode) ===
      normalizeSchedulingStream(candidate.streamCode);
    const sameYear =
      String(item.moduleYear ?? "")
        .trim()
        .toUpperCase() ===
      String(candidate.moduleYear ?? "")
        .trim()
        .toUpperCase();

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
  combineMembers?: SchedulingCombineMember[];
}): WeeklyPlacementOccupant {
  const programmeCode = String(params.timetableModule.programme_code ?? "").trim();
  const streamCode = String(params.timetableModule.stream_code ?? "").trim();
  const moduleYear = String(params.timetableModule.module_year ?? "").trim();

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
    programmeCode,
    streamCode,
    moduleYear,
    schedulingIdentities: resolveSchedulingIdentities({
      programmeCode,
      streamCode,
      moduleYear,
      combineMembers: params.combineMembers,
    }),
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
  combineMembers?: SchedulingCombineMember[];
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
    combineMembers: params.combineMembers,
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
  > = dates.map((sessionDate) => {
    const start = normalizeSessionTime(params.startTime);
    const end = normalizeSessionTime(
      params.endTime || weeklySlotDisplayEnd(start)
    );

    return {
      academic_year: params.academicYear,
      timetable_module_id: timetableModule.id,
      module_instance_code: instanceCode,
      module_code: occupant.moduleCode,
      module_name: occupant.moduleName,
      session_date: sessionDate,
      start_time: start,
      end_time: end,
      room_code: roomCode,
      status: "normal",
      session_number: null,
      session_label: null,
      session_kind: null,
      remark: null,
      teacher_name: occupant.teacherName || null,
      module_size: params.instance.instance_expected_size ?? null,
      created_by: params.createdBy ?? null,
    };
  });

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
  const addStart = (startTime: string, mode?: string | null) => {
    const row = weeklySlotRow(startTime, mode);
    map.set(row.start, row);
  };

  for (const slot of params.sessionSlots) {
    addStart(slot.start);
  }

  for (const instance of params.instances) {
    const mode = String(instance.instance_mode ?? "").trim();
    if (mode === "Night") {
      addStart(WEEKLY_NIGHT_SLOT_START, "Night");
      continue;
    }

    const preferred =
      params.preferredStartByCode[instance.module_instance_code] || "09:00";
    addStart(preferred);
  }

  if (map.size === 0) {
    for (const start of params.startTimeOptions) {
      addStart(start);
    }
    addStart(WEEKLY_NIGHT_SLOT_START, "Night");
  }

  return Array.from(map.values()).sort((a, b) => a.start.localeCompare(b.start));
}

/** Build the same weekly grid structure shown in WeeklyTimetableEditor. */
export function buildWeeklyTimetableGridFromSessions(params: {
  term: TimetableScheduleTerm;
  sessions: TimetableSessionRow[];
  moduleByInstanceCode: Map<string, TimetableModuleRow>;
  timetableInstances: TimetableModuleInstanceRow[];
  preferredStartByCode?: Record<string, string>;
  startTimeOptions: string[];
  combineMembersByGroupId?: Map<string, SchedulingCombineMember[]>;
}): WeeklyGridState {
  const collapsed = new Map<
    string,
    WeeklyGridItem & { weekday: number; start: string; end: string }
  >();
  const sessionSlots: Array<{ start: string; end: string }> = [];
  const instanceByCode = new Map(
    params.timetableInstances.map((instance) => [
      String(instance.module_instance_code ?? "").trim(),
      instance,
    ])
  );

  for (const session of params.sessions) {
    if (session.status === "cancel") continue;

    const instanceCode = String(session.module_instance_code ?? "").trim();
    const timetableModule = params.moduleByInstanceCode.get(instanceCode);

    if (!timetableModule || timetableModule.module_term !== params.term) {
      continue;
    }

    const dateIso = String(session.session_date ?? "").slice(0, 10);
    if (!dateIso) continue;

    const jsDay = new Date(`${dateIso}T00:00:00`).getDay();
    if (jsDay === 0) continue;

    const weekday = jsDay;
    const rawStart = String(session.start_time ?? "").slice(0, 5);
    const roomCode = String(session.room_code ?? "").trim();
    const instance = instanceByCode.get(instanceCode);
    const mode = instance?.instance_mode ?? timetableModule.mode;

    if (!rawStart || !roomCode) continue;

    const start = normalizeWeeklySlotStart(rawStart, mode);
    const slotKey = buildWeeklySlotKey(start, mode);

    sessionSlots.push({ start, end: weeklySlotDisplayEnd(start, mode) });

    const key = [weekday, start, roomCode, instanceCode].join("|");
    if (collapsed.has(key)) continue;

    collapsed.set(key, {
      weekday,
      start,
      end: weeklySlotDisplayEnd(start, mode),
      ...buildWeeklyPlacementOccupant({
        instance: {
          module_instance_code: instanceCode,
          module_code: String(session.module_code ?? "").trim(),
          module_name: String(session.module_name ?? "").trim(),
          instance_teacher_name: String(session.teacher_name ?? "").trim(),
        } as TimetableModuleInstanceRow,
        timetableModule,
        roomCode,
        moduleCode: String(session.module_code ?? "").trim(),
        moduleName: String(session.module_name ?? "").trim(),
        combineMembers: params.combineMembersByGroupId?.get(
          String(timetableModule.combine_group_id ?? "").trim()
        ),
      }),
    });
  }

  const itemsBySlotAndWeekday: WeeklyGridState["itemsBySlotAndWeekday"] = {};

  for (const item of collapsed.values()) {
    const slotKey = buildWeeklySlotKey(item.start);
    itemsBySlotAndWeekday[slotKey] ||= {};
    itemsBySlotAndWeekday[slotKey][item.weekday] ||= [];
    itemsBySlotAndWeekday[slotKey][item.weekday]!.push({
      moduleInstanceCode: item.moduleInstanceCode,
      moduleCode: item.moduleCode,
      moduleName: item.moduleName,
      teacherName: item.teacherName,
      roomCode: item.roomCode,
      programmeCode: item.programmeCode,
      streamCode: item.streamCode,
      moduleYear: item.moduleYear,
      schedulingIdentities: item.schedulingIdentities,
    });
  }

  for (const sk of Object.keys(itemsBySlotAndWeekday)) {
    for (const day of Object.keys(itemsBySlotAndWeekday[sk] ?? {})) {
      itemsBySlotAndWeekday[sk]![Number(day)]!.sort((a, b) => {
        if (a.roomCode !== b.roomCode) {
          return a.roomCode.localeCompare(b.roomCode);
        }
        return a.moduleInstanceCode.localeCompare(b.moduleInstanceCode);
      });
    }
  }

  const uniqueSessionSlots = Array.from(
    new Map(sessionSlots.map((slot) => [slot.start, slot])).values()
  );

  const slots = mergeWeeklySlotRows({
    sessionSlots: uniqueSessionSlots,
    instances: params.timetableInstances,
    preferredStartByCode: params.preferredStartByCode ?? {},
    startTimeOptions: params.startTimeOptions,
  });

  return { slots, itemsBySlotAndWeekday };
}

export type WeeklyGridState = {
  slots: Array<{ start: string; end: string }>;
  itemsBySlotAndWeekday: Record<string, Record<number, WeeklyGridItem[]>>;
};

function normalizeWeeklyRoomCode(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase();
}

export function getOccupiedRoomCodesForWeeklyCell(
  items: WeeklyGridItem[]
): Set<string> {
  return new Set(
    items.map((item) => normalizeWeeklyRoomCode(item.roomCode)).filter(Boolean)
  );
}

export function getRemainingClassroomsForWeeklyCell(params: {
  items: WeeklyGridItem[];
  classrooms: TimetableClassroomRow[];
}): TimetableClassroomRow[] {
  const occupied = getOccupiedRoomCodesForWeeklyCell(params.items);

  return params.classrooms.filter(
    (room) => !occupied.has(normalizeWeeklyRoomCode(room.room_code))
  );
}

/** Rooms still free on every weekday for the same timeslot row. */
export function getRemainingClassroomsForWeeklySlotAllDays(params: {
  grid: WeeklyGridState;
  slotKey: string;
  weekdays: number[];
  classrooms: TimetableClassroomRow[];
}): TimetableClassroomRow[] {
  if (params.weekdays.length === 0) {
    return params.classrooms;
  }

  let freeCodes: Set<string> | null = null;

  for (const weekday of params.weekdays) {
    const items = params.grid.itemsBySlotAndWeekday[params.slotKey]?.[weekday] ?? [];
    const occupied = getOccupiedRoomCodesForWeeklyCell(items);
    const freeThisDay = new Set(
      params.classrooms
        .map((room) => normalizeWeeklyRoomCode(room.room_code))
        .filter((code) => code && !occupied.has(code))
    );

    if (freeCodes === null) {
      freeCodes = freeThisDay;
      continue;
    }

    freeCodes = new Set([...freeCodes].filter((code) => freeThisDay.has(code)));
  }

  const allowed = freeCodes ?? new Set<string>();

  return params.classrooms.filter((room) =>
    allowed.has(normalizeWeeklyRoomCode(room.room_code))
  );
}

export type WeeklyPlacementRecord = WeeklyGridItem & {
  weekday: 1 | 2 | 3 | 4 | 5 | 6;
  start: string;
  end: string;
};

export function cloneWeeklyGridState(grid: WeeklyGridState): WeeklyGridState {
  return JSON.parse(JSON.stringify(grid)) as WeeklyGridState;
}

export function weeklyPlacementIdentity(placement: WeeklyPlacementRecord) {
  return [
    placement.weekday,
    placement.start,
    placement.roomCode,
    placement.moduleInstanceCode.toUpperCase(),
  ].join("|");
}

function weeklyTeacherKey(teacherName: string | null | undefined) {
  return normalizeTeacherNameKey(String(teacherName ?? "").trim() || "TBC");
}

export function collectWeeklyTeacherChanges(params: {
  savedGrid: WeeklyGridState;
  draftGrid: WeeklyGridState;
  editableInstanceCodes: string[];
  instanceByCode?: Map<string, TimetableModuleInstanceRow>;
}): Array<{ placement: WeeklyPlacementRecord; teacherName: string }> {
  const editable = new Set(
    params.editableInstanceCodes
      .map((code) => String(code ?? "").trim().toUpperCase())
      .filter(Boolean)
  );

  const savedTeachers = new Map<string, string>();

  for (const placement of collectWeeklyPlacements(params.savedGrid)) {
    if (!editable.has(placement.moduleInstanceCode.toUpperCase())) {
      continue;
    }

    savedTeachers.set(
      weeklyPlacementIdentity(placement),
      weeklyTeacherKey(placement.teacherName)
    );
  }

  const changes: Array<{ placement: WeeklyPlacementRecord; teacherName: string }> =
    [];

  for (const placement of collectWeeklyPlacements(params.draftGrid)) {
    if (!editable.has(placement.moduleInstanceCode.toUpperCase())) {
      continue;
    }

    const identity = weeklyPlacementIdentity(placement);
    const previousTeacher = savedTeachers.get(identity);
    const nextTeacher = weeklyTeacherKey(placement.teacherName);

    if (previousTeacher === undefined) {
      const instance = params.instanceByCode?.get(
        placement.moduleInstanceCode.toUpperCase()
      );
      const instanceTeacher = weeklyTeacherKey(instance?.instance_teacher_name);

      if (nextTeacher === instanceTeacher) {
        continue;
      }

      changes.push({
        placement,
        teacherName: String(placement.teacherName ?? "").trim() || "TBC",
      });
      continue;
    }

    if (previousTeacher === nextTeacher) {
      continue;
    }

    changes.push({
      placement,
      teacherName: String(placement.teacherName ?? "").trim() || "TBC",
    });
  }

  return changes;
}

async function persistWeeklyTeacherChanges(params: {
  academicYear: string;
  savedGrid: WeeklyGridState;
  draftGrid: WeeklyGridState;
  editableInstanceCodes: string[];
  instanceByCode?: Map<string, TimetableModuleInstanceRow>;
  createdBy?: string | null;
}) {
  const changes = collectWeeklyTeacherChanges(params);

  if (changes.length === 0) {
    return { teacherUpdatedCount: 0 };
  }

  const timetableModules = await listTimetableModulesByInstanceCodes({
    academicYear: params.academicYear,
    moduleInstanceCodes: changes.map(
      (change) => change.placement.moduleInstanceCode
    ),
  });

  const moduleByInstanceCode = new Map(
    timetableModules.map((row) => [
      String(row.module_instance_code ?? "").trim().toUpperCase(),
      row,
    ])
  );

  let teacherUpdatedCount = 0;

  for (const change of changes) {
    const timetableModule = moduleByInstanceCode.get(
      change.placement.moduleInstanceCode.toUpperCase()
    );

    if (!timetableModule) {
      throw new Error(
        `Cannot update teacher for "${change.placement.moduleInstanceCode}": timetable module not found.`
      );
    }

    await applyTeacherToTimetableModuleInstance({
      academicYear: params.academicYear,
      target: {
        timetableModule,
        teacherName: change.teacherName,
        teachingStatus: "PT",
        mode:
          timetableModule.mode === "Day" ||
          timetableModule.mode === "Night" ||
          timetableModule.mode === "Saturday"
            ? timetableModule.mode
            : "Night",
      },
      updatedBy: params.createdBy ?? null,
    });

    teacherUpdatedCount += 1;
  }

  return { teacherUpdatedCount };
}

export function collectWeeklyPlacements(
  grid: WeeklyGridState
): WeeklyPlacementRecord[] {
  const results: WeeklyPlacementRecord[] = [];

  for (const slot of grid.slots) {
    const slotKey = buildWeeklySlotKey(slot.start);
    const byDay = grid.itemsBySlotAndWeekday[slotKey] ?? {};

    for (const [dayText, items] of Object.entries(byDay)) {
      const weekday = Number(dayText) as WeeklyPlacementRecord["weekday"];

      for (const item of items) {
        results.push({
          ...item,
          weekday,
          start: slot.start,
          end: slot.end,
        });
      }
    }
  }

  return results;
}

export function buildDraftWeeklyPlacement(params: {
  weekday: 1 | 2 | 3 | 4 | 5 | 6;
  start: string;
  end: string;
  roomCode: string;
  instance: TimetableModuleInstanceRow;
  timetableModule: TimetableModuleRow;
  combineMembers?: SchedulingCombineMember[];
}): WeeklyPlacementRecord {
  const occupant = buildWeeklyPlacementOccupant({
    instance: params.instance,
    timetableModule: params.timetableModule,
    roomCode: params.roomCode,
    combineMembers: params.combineMembers,
  });

  return {
    ...occupant,
    weekday: params.weekday,
    start: params.start,
    end: params.end,
  };
}

export async function persistWeeklyTimetableDraft(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  savedGrid: WeeklyGridState;
  draftGrid: WeeklyGridState;
  editableInstanceCodes: string[];
  instanceByCode: Map<string, TimetableModuleInstanceRow>;
  combineMembersByGroupId?: Map<string, SchedulingCombineMember[]>;
  createdBy?: string | null;
}) {
  const editable = new Set(
    params.editableInstanceCodes
      .map((code) => String(code ?? "").trim().toUpperCase())
      .filter(Boolean)
  );

  if (editable.size === 0) {
    return { savedCount: 0, removedCount: 0 };
  }

  const savedPlacements = collectWeeklyPlacements(params.savedGrid).filter(
    (row) => editable.has(row.moduleInstanceCode.toUpperCase())
  );
  const draftPlacements = collectWeeklyPlacements(params.draftGrid).filter(
    (row) => editable.has(row.moduleInstanceCode.toUpperCase())
  );

  const savedKeys = new Map(
    savedPlacements.map((row) => [weeklyPlacementIdentity(row), row])
  );
  const draftKeys = new Map(
    draftPlacements.map((row) => [weeklyPlacementIdentity(row), row])
  );

  let removedCount = 0;
  let savedCount = 0;

  for (const [key, placement] of savedKeys) {
    if (draftKeys.has(key)) continue;

    await removeModuleFromWeeklySlot({
      academicYear: params.academicYear,
      term: params.term,
      weekday: placement.weekday,
      startTime: placement.start,
      endTime: placement.end,
      roomCode: placement.roomCode,
      moduleInstanceCode: placement.moduleInstanceCode,
    });
    removedCount += 1;
  }

  for (const [key, placement] of draftKeys) {
    if (savedKeys.has(key)) continue;

    const instance = params.instanceByCode.get(
      placement.moduleInstanceCode.toUpperCase()
    );

    if (!instance) {
      throw new Error(
        `Cannot save "${placement.moduleInstanceCode}": instance not found on this page.`
      );
    }

    const slotKey = buildWeeklySlotKey(placement.start);
    const cellOccupants =
      params.draftGrid.itemsBySlotAndWeekday[slotKey]?.[placement.weekday] ?? [];

    let combineMembers: SchedulingCombineMember[] | undefined;
    if (params.combineMembersByGroupId) {
      const [timetableModule] = await listTimetableModulesByInstanceCodes({
        academicYear: params.academicYear,
        moduleInstanceCodes: [placement.moduleInstanceCode],
      });
      const groupId = String(timetableModule?.combine_group_id ?? "").trim();
      combineMembers = groupId
        ? params.combineMembersByGroupId.get(groupId)
        : undefined;
    }

    await addModuleToWeeklySlot({
      academicYear: params.academicYear,
      term: params.term,
      weekday: placement.weekday,
      startTime: placement.start,
      endTime: placement.end,
      roomCode: placement.roomCode,
      moduleInstanceCode: placement.moduleInstanceCode,
      instance,
      existingOccupants: cellOccupants.filter(
        (item) =>
          item.moduleInstanceCode.toUpperCase() !==
          placement.moduleInstanceCode.toUpperCase()
      ),
      createdBy: params.createdBy ?? null,
      combineMembers,
    });
    savedCount += 1;
  }

  const { teacherUpdatedCount } = await persistWeeklyTeacherChanges({
    academicYear: params.academicYear,
    savedGrid: params.savedGrid,
    draftGrid: params.draftGrid,
    editableInstanceCodes: params.editableInstanceCodes,
    instanceByCode: params.instanceByCode,
    createdBy: params.createdBy ?? null,
  });

  return { savedCount, removedCount, teacherUpdatedCount };
}
