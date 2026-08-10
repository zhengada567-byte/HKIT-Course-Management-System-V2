import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minus, Pencil, Plus } from "lucide-react";

import { getProgrammeFamilyKey } from "../../../../lib/crossProgrammeCombine";
import { dedupeJoinedModuleName } from "../../../../lib/moduleDisplay";
import {
  resolveSchedulingIdentities,
  normalizeTeacherNameKey,
  type SchedulingCombineMember,
  type StreamYearSchedulingIdentity,
} from "../../../../lib/timetableSchedulingRules";
import { cn } from "../../../../lib/utils";
import { useAuth } from "../../../../contexts/AuthContext";
import { listTeachers } from "../../../../services/teacherService";
import { listTimetableModuleInstances,
  type TimetableModuleInstanceRow,
} from "../../../../services/timetableModuleInstanceService";
import { loadEnrolledClassSizeByInstanceCode } from "../../../../services/studyPlanEnrollmentService";
import { loadPlanningModulesByCombineGroupIds } from "../../../../services/splitClassService";
import { isBridgingSchedulingModuleCode } from "../../../../services/bridgingModuleService";
import {
  buildDraftWeeklyPlacement,
  buildWeeklySlotKey,
  buildWeeklyTimetableGridFromSessions,
  cloneWeeklyGridState,
  collectWeeklyPlacements,
  collectWeeklyTeacherChanges,
  getRemainingClassroomsForWeeklyCell,
  listWeeklyConflictOccupants,
  persistWeeklyTimetableDraft,
  removeWeeklyGridPlacement,
  upsertWeeklyGridPlacement,
  wouldWeeklyPlacementConflict,
  type WeeklyGridItem,
  type WeeklyGridState,
} from "../../../../services/timetableManualScheduleService";
import { weeklyPeriodBandLabel } from "../../../../lib/weeklyTimetablePeriods";
import {
  listTimetableSessions,
  type TimetableClassroomRow,
  type TimetableScheduleTerm,
} from "../../../../services/timetableScheduleService";
import { listTimetableModulesByInstanceCodes } from "../../../../services/timetableService";
import type { TeacherRow, TimetableModuleRow } from "../../../../types";
import { InstanceTeacherSelect } from "./InstanceTeacherSelect";

const weekdays: Array<{ id: 1 | 2 | 3 | 4 | 5 | 6; label: string }> = [
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
];

type AddDialogState = {
  weekday: 1 | 2 | 3 | 4 | 5 | 6;
  start: string;
  end: string;
  moduleInstanceCode: string;
  roomCode: string;
};

type EditDialogState = {
  weekday: 1 | 2 | 3 | 4 | 5 | 6;
  start: string;
  end: string;
  item: WeeklyGridItem;
  roomCode: string;
  teacherName: string;
};

type ViewScope = "all" | "programme";

const WEEKLY_DAY_COLUMN_CLASS =
  "w-40 min-w-[10rem] shrink-0 border-l border-slate-200 px-2 py-2 align-top";
const WEEKLY_DAY_ROW_MIN_WIDTH = "min-w-[60rem]";
/** Shared horizontal scroll for day header + each period row. */
const WEEKLY_DAY_SCROLL_CLASS = "overflow-x-auto";
const SELECTED_PROGRAMME_HIGHLIGHT_CELL = "border-red-400 bg-red-100";
const SELECTED_PROGRAMME_HIGHLIGHT_ROW = "bg-red-100";

function programmeMatchesSelectedFamily(
  moduleProgrammeCode: string | null | undefined,
  selectedFamily: string
) {
  const family = getProgrammeFamilyKey(moduleProgrammeCode);
  return Boolean(family) && family === selectedFamily;
}

function isSelectedProgrammeHighlight(params: {
  programmeCode?: string | null;
  schedulingIdentities?: StreamYearSchedulingIdentity[];
  combineMembers?: SchedulingCombineMember[];
  selectedProgrammeCode?: string;
  viewScope: ViewScope;
}) {
  const {
    programmeCode,
    schedulingIdentities,
    combineMembers,
    selectedProgrammeCode,
    viewScope,
  } = params;

  if (viewScope !== "all" || !selectedProgrammeCode) return false;

  const selectedFamily = getProgrammeFamilyKey(selectedProgrammeCode);
  if (!selectedFamily) return false;

  if (schedulingIdentities?.length) {
    if (
      schedulingIdentities.some((identity) =>
        programmeMatchesSelectedFamily(identity.programmeCode, selectedFamily)
      )
    ) {
      return true;
    }
  }

  if (combineMembers?.length) {
    return combineMembers.some((member) =>
      programmeMatchesSelectedFamily(member.programme_code, selectedFamily)
    );
  }

  return programmeMatchesSelectedFamily(programmeCode, selectedFamily);
}

function resolveModuleSchedulingIdentities(params: {
  programmeCode?: string | null;
  streamCode?: string | null;
  moduleYear?: string | null;
  combineMembers?: SchedulingCombineMember[];
}): StreamYearSchedulingIdentity[] {
  return resolveSchedulingIdentities({
    programmeCode: String(params.programmeCode ?? ""),
    streamCode: params.streamCode,
    moduleYear: params.moduleYear,
    combineMembers: params.combineMembers,
  });
}

function resolveWeeklyItemSchedulingIdentities(params: {
  item: WeeklyGridItem;
  meta?: TimetableModuleRow | null;
  combineMembers?: SchedulingCombineMember[];
}): StreamYearSchedulingIdentity[] {
  if (params.item.schedulingIdentities?.length) {
    return params.item.schedulingIdentities;
  }

  return resolveModuleSchedulingIdentities({
    programmeCode: params.meta?.programme_code ?? params.item.programmeCode,
    streamCode: params.meta?.stream_code ?? params.item.streamCode,
    moduleYear: params.meta?.module_year ?? params.item.moduleYear,
    combineMembers: params.combineMembers,
  });
}

const EXPECTED_SIZE_LABEL = "Expected size";
const ACTUAL_SIZE_LABEL_ZH = "\u5be6\u969b\u4eba\u6578";
const EXPECTED_SIZE_LABEL_ZH = "\u9810\u8a08\u4eba\u6578";

type ClassSizeDisplayMode = "expected" | "actual";

function resolveInstanceStudentNumber(
  instance?: TimetableModuleInstanceRow | null,
  mode: ClassSizeDisplayMode = "expected",
  enrolledCountByInstanceCode?: Map<string, number> | null
) {
  if (!instance) return null;

  if (mode === "actual") {
    const code = String(instance.module_instance_code ?? "")
      .trim()
      .toUpperCase();

    if (enrolledCountByInstanceCode && code) {
      const liveCount = enrolledCountByInstanceCode.get(code);
      if (liveCount != null && liveCount > 0) return liveCount;
      return null;
    }

    const actual = instance.instance_actual_size;
    if (actual != null && Number(actual) > 0) return Number(actual);
    return null;
  }

  const expected = instance.instance_expected_size;
  if (expected != null && expected > 0) return expected;

  return null;
}

function formatInstanceStudentNumber(
  instance?: TimetableModuleInstanceRow | null,
  mode: ClassSizeDisplayMode = "expected",
  enrolledCountByInstanceCode?: Map<string, number> | null
) {
  const size = resolveInstanceStudentNumber(
    instance,
    mode,
    enrolledCountByInstanceCode
  );
  if (size != null) return String(size);
  return mode === "actual" ? "nil" : "—";
}

function classSizeChipLabel(
  mode: ClassSizeDisplayMode,
  useChineseLabels: boolean
) {
  if (!useChineseLabels) return EXPECTED_SIZE_LABEL;
  return mode === "actual" ? ACTUAL_SIZE_LABEL_ZH : EXPECTED_SIZE_LABEL_ZH;
}

function classroomCapacityHint(params: {
  studentNumber: number | null;
  room?: TimetableClassroomRow;
}) {
  const { studentNumber, room } = params;
  if (studentNumber == null || !room) return null;

  const capacity = room.room_size;
  if (studentNumber > capacity + 10) {
    return {
      tone: "error" as const,
      message: `Students ${studentNumber} exceeds room capacity ${capacity} + 10.`,
    };
  }

  if (studentNumber > capacity) {
    return {
      tone: "warn" as const,
      message: `Students ${studentNumber} is above capacity ${capacity} but within +10.`,
    };
  }

  return {
    tone: "ok" as const,
    message: `Room capacity ${capacity} fits ${studentNumber} students.`,
  };
}

function RoomCapacityHint(props: {
  studentNumber: number | null;
  room?: TimetableClassroomRow;
}) {
  const hint = classroomCapacityHint(props);
  if (!hint) return null;

  const className =
    hint.tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : hint.tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div className={`mt-1 rounded border px-2 py-1 text-xs ${className}`}>
      {hint.message}
    </div>
  );
}

function formatRemainingClassroomSummary(params: {
  remaining: TimetableClassroomRow[];
  totalCount: number;
  label: string;
}) {
  const { remaining, totalCount, label } = params;
  const usedCount = totalCount - remaining.length;
  const roomCodes = remaining.map((room) => room.room_code).join(", ");

  if (remaining.length === 0) {
    return (
      <div className="mt-1 text-xs font-medium text-red-700">
        {label}: 0/{totalCount} free (full)
      </div>
    );
  }

  return (
    <div
      className="mt-1 text-xs text-slate-600"
      title={roomCodes || undefined}
    >
      <span className="font-medium text-slate-700">{label}:</span>{" "}
      {remaining.length}/{totalCount} free
      {usedCount > 0 ? ` (${usedCount} in use)` : ""}
      {roomCodes ? ` — ${roomCodes}` : ""}
    </div>
  );
}

function RemainingClassroomsCellSummary(props: {
  remaining: TimetableClassroomRow[];
  totalCount: number;
  label?: string;
}) {
  return formatRemainingClassroomSummary({
    remaining: props.remaining,
    totalCount: props.totalCount,
    label: props.label ?? "Remaining",
  });
}

function classroomLocationKey(room: TimetableClassroomRow) {
  const fromLocation = String(room.location ?? "").trim().toUpperCase();
  if (fromLocation) return fromLocation;

  const roomCode = String(room.room_code ?? "").trim().toUpperCase();
  const dashIndex = roomCode.indexOf("-");
  if (dashIndex > 0) {
    return roomCode.slice(0, dashIndex);
  }

  return roomCode;
}

function filterClassroomsByLocation(
  classrooms: TimetableClassroomRow[],
  location?: string
) {
  const key = String(location ?? "").trim().toUpperCase();
  if (!key) return classrooms;

  return classrooms.filter((room) => classroomLocationKey(room) === key);
}

export function WeeklyTimetableEditor(props: {
  academicYear: string;
  term: TimetableScheduleTerm;
  programmeCode?: string;
  timetableInstances: TimetableModuleInstanceRow[];
  classrooms: TimetableClassroomRow[];
  preferredStartByCode: Record<string, string>;
  startTimeOptions: string[];
  /** collapsible: PL schedule step toggle; embedded: always visible (admin). */
  variant?: "collapsible" | "embedded";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refreshToken?: string | number | null;
  /** Admin: lock to all programmes, hide scope selector. */
  forceViewScopeAll?: boolean;
  /** PL: allow edit/remove/save for any module shown on the weekly grid. */
  allowEditAllGridModules?: boolean;
  /** Hide the bottom module-instance list (e.g. weekly & daily timetable page). */
  hideInstancePanel?: boolean;
  /** View-only: hide save/add/edit/remove (e.g. PL on weekly & daily timetable). */
  readOnly?: boolean;
  /**
   * Admin weekly & daily timetable: show toggle between expected / actual class size
   * on weekly chips only.
   */
  showClassSizeModeToggle?: boolean;
  /** Limit remaining-room summary to one campus; defaults to SSP. Pass "" for all locations. */
  availabilitySummaryLocation?: string;
  instancePanelTitle?: string;
  instancePanelDescription?: string;
  onAfterSave?: () => void;
}) {
  const { user } = useAuth();
  const {
    academicYear,
    term,
    programmeCode,
    timetableInstances,
    classrooms,
    preferredStartByCode,
    startTimeOptions,
    variant = "collapsible",
    open,
    onOpenChange,
    refreshToken,
    forceViewScopeAll = false,
    allowEditAllGridModules = false,
    hideInstancePanel = false,
    readOnly = false,
    showClassSizeModeToggle = false,
    availabilitySummaryLocation,
    instancePanelTitle,
    instancePanelDescription,
    onAfterSave,
  } = props;

  const summaryLocation =
    availabilitySummaryLocation === ""
      ? undefined
      : (availabilitySummaryLocation ?? "SSP");

  const isEmbedded = variant === "embedded";
  const panelOpen = isEmbedded || open;

  const canEditAcrossProgrammes =
    !readOnly && (forceViewScopeAll || allowEditAllGridModules);

  const availabilitySummaryClassrooms = useMemo(
    () => filterClassroomsByLocation(classrooms, summaryLocation),
    [classrooms, summaryLocation]
  );

  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);
  const [weeklyGrid, setWeeklyGrid] = useState<WeeklyGridState | null>(null);
  const [savedGrid, setSavedGrid] = useState<WeeklyGridState | null>(null);
  const [viewScope, setViewScope] = useState<ViewScope>(
    forceViewScopeAll ? "all" : "all"
  );
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [classSizeMode, setClassSizeMode] =
    useState<ClassSizeDisplayMode>("expected");
  const [enrolledCountByInstanceCode, setEnrolledCountByInstanceCode] =
    useState<Map<string, number>>(new Map());
  const [cellBusyKey, setCellBusyKey] = useState<string | null>(null);
  const dayScrollRefs = useRef<Array<HTMLDivElement | null>>([]);
  const syncingDayScrollRef = useRef(false);

  const syncWeeklyDayScroll = useCallback((source: HTMLDivElement) => {
    if (syncingDayScrollRef.current) return;
    syncingDayScrollRef.current = true;
    const left = source.scrollLeft;

    for (const element of dayScrollRefs.current) {
      if (element && element !== source && element.scrollLeft !== left) {
        element.scrollLeft = left;
      }
    }

    syncingDayScrollRef.current = false;
  }, []);

  const setWeeklyDayScrollRef = useCallback(
    (index: number, element: HTMLDivElement | null) => {
      dayScrollRefs.current[index] = element;
    },
    []
  );
  const [addDialog, setAddDialog] = useState<AddDialogState | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [editDialog, setEditDialog] = useState<EditDialogState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [moduleMetaByCode, setModuleMetaByCode] = useState<
    Record<string, TimetableModuleRow>
  >({});
  const [combineMembersByGroupId, setCombineMembersByGroupId] = useState<
    Map<string, SchedulingCombineMember[]>
  >(new Map());
  const [loadedInstancesByCode, setLoadedInstancesByCode] = useState<
    Map<string, TimetableModuleInstanceRow>
  >(new Map());
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);

  const editableInstanceCodes = useMemo(
    () =>
      timetableInstances
        .map((row) => String(row.module_instance_code ?? "").trim())
        .filter(Boolean),
    [timetableInstances]
  );

  const editableInstanceCodeSet = useMemo(() => {
    if (readOnly) {
      return new Set<string>();
    }

    const codes = new Set(
      editableInstanceCodes.map((code) => code.toUpperCase())
    );

    if (canEditAcrossProgrammes && weeklyGrid) {
      for (const placement of collectWeeklyPlacements(weeklyGrid)) {
        codes.add(placement.moduleInstanceCode.toUpperCase());
      }
    }

    return codes;
  }, [canEditAcrossProgrammes, editableInstanceCodes, readOnly, weeklyGrid]);

  const instanceByCode = useMemo(() => {
    const map = new Map<string, TimetableModuleInstanceRow>();

    for (const row of loadedInstancesByCode.values()) {
      const code = String(row.module_instance_code ?? "").trim();
      if (code) map.set(code.toUpperCase(), row);
    }

    for (const row of timetableInstances) {
      const code = String(row.module_instance_code ?? "").trim();
      if (code) map.set(code.toUpperCase(), row);
    }

    return map;
  }, [loadedInstancesByCode, timetableInstances]);

  const addDialogInstanceOptions = useMemo(() => {
    if (canEditAcrossProgrammes) {
      return Array.from(instanceByCode.values()).sort((a, b) =>
        a.module_instance_code.localeCompare(b.module_instance_code)
      );
    }

    return timetableInstances;
  }, [canEditAcrossProgrammes, instanceByCode, timetableInstances]);

  const loadWeeklyTimetable = useCallback(async () => {
    setWeeklyLoading(true);
    setWeeklyError(null);
    setSaveMessage(null);

    try {
      const programmeInstanceCodes = new Set(editableInstanceCodes);
      let termInstancesForGrid: TimetableModuleInstanceRow[] = timetableInstances;

      if (canEditAcrossProgrammes) {
        const allInstances = await listTimetableModuleInstances({ academicYear });
        const instanceMap = new Map<string, TimetableModuleInstanceRow>();

        for (const row of allInstances) {
          if (row.module_term !== term) continue;
          const code = String(row.module_instance_code ?? "").trim();
          if (code) instanceMap.set(code.toUpperCase(), row);
        }

        setLoadedInstancesByCode(instanceMap);
        termInstancesForGrid = Array.from(
          new Map(
            [...timetableInstances, ...instanceMap.values()].map((row) => [
              String(row.module_instance_code ?? "").trim().toUpperCase(),
              row,
            ])
          ).values()
        );
      } else {
        setLoadedInstancesByCode(new Map());
      }

      const sessionsPromise = listTimetableSessions({ academicYear });
      const enrolledCountsPromise = showClassSizeModeToggle
        ? loadEnrolledClassSizeByInstanceCode({
            academicYear,
            offeredTerm: term,
            includeBridging: true,
          })
        : Promise.resolve(new Map<string, number>());

      const [sessions, enrolledCounts] = await Promise.all([
        sessionsPromise,
        enrolledCountsPromise,
      ]);
      setEnrolledCountByInstanceCode(enrolledCounts);
      const sessionInstanceCodes = Array.from(
        new Set(
          sessions
            .map((row) => String(row.module_instance_code ?? "").trim())
            .filter(Boolean)
        )
      );

      const codesToLoad = Array.from(
        new Set([...programmeInstanceCodes, ...sessionInstanceCodes])
      );

      const timetableModules = await listTimetableModulesByInstanceCodes({
        academicYear,
        moduleInstanceCodes: codesToLoad,
      });

      const moduleByInstanceCode = new Map(
        timetableModules.map((row) => [
          String(row.module_instance_code ?? "").trim(),
          row,
        ])
      );

      const metaRecord: Record<string, TimetableModuleRow> = {};
      for (const [code, module] of moduleByInstanceCode) {
        metaRecord[code] = module;
      }
      setModuleMetaByCode(metaRecord);

      const combineGroupIds = Array.from(
        new Set(
          timetableModules
            .map((row) => String(row.combine_group_id ?? "").trim())
            .filter(Boolean)
        )
      );
      const membersByGroupId = await loadPlanningModulesByCombineGroupIds({
        academicYear,
        combineGroupIds,
      });
      setCombineMembersByGroupId(membersByGroupId);

      const filteredSessions = sessions.filter((session) => {
        if (session.status === "cancel") return false;

        const instanceCode = String(session.module_instance_code ?? "").trim();
        const timetableModule = moduleByInstanceCode.get(instanceCode);

        if (!timetableModule || timetableModule.module_term !== term) {
          return false;
        }

        if (!forceViewScopeAll && viewScope === "programme") {
          if (!programmeInstanceCodes.has(instanceCode)) return false;
          if (
            programmeCode &&
            String(timetableModule.programme_code ?? "").trim() !== programmeCode
          ) {
            return false;
          }
        }

        return true;
      });

      const nextGrid = buildWeeklyTimetableGridFromSessions({
        term,
        sessions: filteredSessions,
        moduleByInstanceCode,
        timetableInstances: termInstancesForGrid,
        preferredStartByCode,
        startTimeOptions,
        combineMembersByGroupId: membersByGroupId,
      });
      setWeeklyGrid(nextGrid);
      setSavedGrid(cloneWeeklyGridState(nextGrid));
    } catch (error) {
      setWeeklyError(
        error instanceof Error ? error.message : "Failed to load weekly timetable."
      );
    } finally {
      setWeeklyLoading(false);
    }
  }, [
    academicYear,
    canEditAcrossProgrammes,
    editableInstanceCodes,
    preferredStartByCode,
    forceViewScopeAll,
    programmeCode,
    showClassSizeModeToggle,
    startTimeOptions,
    term,
    timetableInstances,
    viewScope,
  ]);

  useEffect(() => {
    if (panelOpen) {
      void loadWeeklyTimetable();
    }
  }, [refreshToken, panelOpen, viewScope, loadWeeklyTimetable]);

  useEffect(() => {
    void listTeachers(academicYear)
      .then(setTeachers)
      .catch(() => setTeachers([]));
  }, [academicYear]);

  const isDirty = useMemo(() => {
    if (!weeklyGrid || !savedGrid) return false;

    const toKeySet = (grid: WeeklyGridState) =>
      new Set(
        collectWeeklyPlacements(grid)
          .filter((row) =>
            editableInstanceCodeSet.has(row.moduleInstanceCode.toUpperCase())
          )
          .map(
            (row) =>
              `${row.weekday}|${row.start}|${row.end}|${row.roomCode}|${row.moduleInstanceCode.toUpperCase()}`
          )
          .sort()
      );

    const draftKeys = toKeySet(weeklyGrid);
    const savedKeys = toKeySet(savedGrid);

    if (draftKeys.size !== savedKeys.size) return true;

    for (const key of draftKeys) {
      if (!savedKeys.has(key)) return true;
    }

    if (
      collectWeeklyTeacherChanges({
        savedGrid,
        draftGrid: weeklyGrid,
        editableInstanceCodes: Array.from(editableInstanceCodeSet),
        instanceByCode,
      }).length > 0
    ) {
      return true;
    }

    return false;
  }, [editableInstanceCodeSet, instanceByCode, savedGrid, weeklyGrid]);

  function handleRemoveItem(params: {
    weekday: 1 | 2 | 3 | 4 | 5 | 6;
    start: string;
    end: string;
    item: WeeklyGridItem;
  }) {
    if (
      !editableInstanceCodeSet.has(params.item.moduleInstanceCode.toUpperCase())
    ) {
      return;
    }

    setWeeklyGrid((current) => {
      if (!current) return current;

      return removeWeeklyGridPlacement({
        grid: current,
        weekday: params.weekday,
        moduleInstanceCode: params.item.moduleInstanceCode,
        roomCode: params.item.roomCode,
        placementStart:
          params.item.placementStart || params.start,
      });
    });
    setSaveMessage(null);
  }

  function openEditDialog(params: {
    weekday: 1 | 2 | 3 | 4 | 5 | 6;
    start: string;
    end: string;
    item: WeeklyGridItem;
  }) {
    setEditError(null);
    setEditDialog({
      weekday: params.weekday,
      start: params.item.placementStart || params.start,
      end: params.item.placementEnd || params.end,
      item: params.item,
      roomCode: params.item.roomCode,
      teacherName: params.item.teacherName || "TBC",
    });
  }

  function handleConfirmEdit() {
    if (!editDialog || !weeklyGrid) return;

    const { weekday, start, end, item, roomCode, teacherName } = editDialog;
    const nextRoomCode = roomCode.trim();
    const nextTeacherName = String(teacherName ?? "").trim() || "TBC";

    if (!nextRoomCode) {
      setEditError("Room is required.");
      return;
    }

    const roomUnchanged = nextRoomCode === item.roomCode;
    const teacherUnchanged =
      normalizeTeacherNameKey(nextTeacherName) ===
      normalizeTeacherNameKey(item.teacherName || "TBC");

    if (roomUnchanged && teacherUnchanged) {
      setEditDialog(null);
      setEditError(null);
      return;
    }

    const others = listWeeklyConflictOccupants({
      grid: weeklyGrid,
      weekday,
      placementStart: start,
      excludeModuleInstanceCode: item.moduleInstanceCode,
      excludeRoomCode: item.roomCode,
    });

    const updatedPlacement = {
      ...item,
      roomCode: nextRoomCode,
      teacherName: nextTeacherName,
      placementStart: item.placementStart || start,
      placementEnd: item.placementEnd || end,
    };

    const conflict = wouldWeeklyPlacementConflict(others, updatedPlacement);
    if (conflict) {
      setEditError(conflict);
      return;
    }

    setWeeklyGrid((current) => {
      if (!current) return current;

      return upsertWeeklyGridPlacement(current, {
        ...updatedPlacement,
        weekday,
        start: updatedPlacement.placementStart,
        end: updatedPlacement.placementEnd,
      });
    });

    setEditDialog(null);
    setEditError(null);
    setSaveMessage(null);
  }

  function openAddDialog(params: {
    weekday: 1 | 2 | 3 | 4 | 5 | 6;
    start: string;
    end: string;
  }) {
    setAddError(null);
    const sk = buildWeeklySlotKey(params.start);
    const items = weeklyGrid?.itemsBySlotAndWeekday[sk]?.[params.weekday] ?? [];
    const remaining = getRemainingClassroomsForWeeklyCell({ items, classrooms });

    setAddDialog({
      weekday: params.weekday,
      start: params.start,
      end: params.end,
      moduleInstanceCode: "",
      roomCode: remaining[0]?.room_code ?? classrooms[0]?.room_code ?? "",
    });
  }

  async function handleConfirmAdd() {
    if (!addDialog || !weeklyGrid) return;

    const code = addDialog.moduleInstanceCode.trim();
    const instance = instanceByCode.get(code.toUpperCase());

    if (!instance) {
      setAddError(`Unknown module instance code "${code}" for ${term} semester.`);
      return;
    }

    setCellBusyKey(`${addDialog.weekday}|${addDialog.start}|add`);
    setAddError(null);

    try {
      const [timetableModule] = await listTimetableModulesByInstanceCodes({
        academicYear,
        moduleInstanceCodes: [code],
      });

      if (!timetableModule) {
        throw new Error(`No timetable module found for "${code}".`);
      }

      const groupId = String(timetableModule.combine_group_id ?? "").trim();
      const combineMembers = groupId
        ? combineMembersByGroupId.get(groupId)
        : undefined;

      const placement = buildDraftWeeklyPlacement({
        weekday: addDialog.weekday,
        start: addDialog.start,
        end: addDialog.end,
        roomCode: addDialog.roomCode,
        instance,
        timetableModule,
        combineMembers,
      });

      const conflict = wouldWeeklyPlacementConflict(
        listWeeklyConflictOccupants({
          grid: weeklyGrid,
          weekday: addDialog.weekday,
          placementStart: addDialog.start,
        }),
        placement
      );
      if (conflict) {
        throw new Error(conflict);
      }

      setWeeklyGrid((current) => {
        if (!current) return current;
        return upsertWeeklyGridPlacement(current, placement);
      });

      setAddDialog(null);
      setSaveMessage(null);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Failed to add module.");
    } finally {
      setCellBusyKey(null);
    }
  }

  async function handleSaveTimetable() {
    if (!weeklyGrid || !savedGrid || !isDirty) return;

    setSaving(true);
    setWeeklyError(null);
    setSaveMessage(null);

    try {
      const codesToPersist = canEditAcrossProgrammes
        ? Array.from(
            new Set([
              ...editableInstanceCodes,
              ...collectWeeklyPlacements(weeklyGrid).map(
                (row) => row.moduleInstanceCode
              ),
              ...collectWeeklyPlacements(savedGrid).map(
                (row) => row.moduleInstanceCode
              ),
            ])
          )
        : editableInstanceCodes;

      const result = await persistWeeklyTimetableDraft({
        academicYear,
        term,
        savedGrid,
        draftGrid: weeklyGrid,
        editableInstanceCodes: codesToPersist,
        instanceByCode,
        combineMembersByGroupId,
        createdBy: user?.id ?? null,
      });

      await loadWeeklyTimetable();
      const teacherPart =
        (result.teacherUpdatedCount ?? 0) > 0
          ? `，更新 ${result.teacherUpdatedCount} 位老師`
          : "";
      setSaveMessage(
        `已儲存至系統：新增 ${result.savedCount} 項，移除 ${result.removedCount} 項${teacherPart}。其他 PL 查看每周時間表時會讀取這些已儲存時段。`
      );
      onAfterSave?.();
    } catch (error) {
      setWeeklyError(
        error instanceof Error ? error.message : "Failed to save weekly timetable."
      );
    } finally {
      setSaving(false);
    }
  }

  const scheduledInstanceCodes = useMemo(() => {
    const set = new Set<string>();
    const source = savedGrid ?? weeklyGrid;
    if (!source) return set;

    for (const sk of Object.keys(source.itemsBySlotAndWeekday)) {
      for (const day of Object.keys(source.itemsBySlotAndWeekday[sk] ?? {})) {
        for (const item of source.itemsBySlotAndWeekday[sk]![Number(day)] ?? []) {
          set.add(item.moduleInstanceCode);
        }
      }
    }
    return set;
  }, [savedGrid, weeklyGrid]);

  const remainingClassroomsBySlotAndDay = useMemo(() => {
    const map = new Map<string, TimetableClassroomRow[]>();
    if (!weeklyGrid) {
      return map;
    }

    for (const slot of weeklyGrid.slots) {
      const sk = buildWeeklySlotKey(slot.start);

      for (const day of weekdays) {
        const items = weeklyGrid.itemsBySlotAndWeekday[sk]?.[day.id] ?? [];
        map.set(
          `${sk}|${day.id}`,
          getRemainingClassroomsForWeeklyCell({
            items,
            classrooms: availabilitySummaryClassrooms,
          })
        );
      }
    }

    return map;
  }, [availabilitySummaryClassrooms, weeklyGrid]);

  const addDialogRemainingClassrooms = useMemo(() => {
    if (!addDialog || !weeklyGrid) {
      return classrooms;
    }

    const sk = buildWeeklySlotKey(addDialog.start);
    const items = weeklyGrid.itemsBySlotAndWeekday[sk]?.[addDialog.weekday] ?? [];
    const selectedCode = addDialog.moduleInstanceCode.trim();
    const selectedInstance = selectedCode
      ? instanceByCode.get(selectedCode.toUpperCase())
      : null;
    const allowOccupiedRooms = isBridgingSchedulingModuleCode(
      selectedCode,
      selectedInstance?.module_code,
      selectedInstance?.module_instance_code
    );
    const remaining = getRemainingClassroomsForWeeklyCell({
      items,
      classrooms,
      allowOccupiedRooms,
    });

    return remaining.length > 0 ? remaining : classrooms;
  }, [addDialog, weeklyGrid, classrooms, instanceByCode]);

  const editDialogInstance = useMemo(() => {
    if (!editDialog) return null;
    return (
      instanceByCode.get(editDialog.item.moduleInstanceCode.toUpperCase()) ??
      null
    );
  }, [editDialog, instanceByCode]);

  const editDialogStudentNumber = useMemo(
    () => resolveInstanceStudentNumber(editDialogInstance),
    [editDialogInstance]
  );

  const editDialogSelectedRoom = useMemo(
    () => classrooms.find((room) => room.room_code === editDialog?.roomCode),
    [classrooms, editDialog?.roomCode]
  );

  const addDialogInstance = useMemo(() => {
    if (!addDialog?.moduleInstanceCode.trim()) return null;
    return (
      instanceByCode.get(addDialog.moduleInstanceCode.trim().toUpperCase()) ??
      null
    );
  }, [addDialog, instanceByCode]);

  const addDialogStudentNumber = useMemo(
    () => resolveInstanceStudentNumber(addDialogInstance),
    [addDialogInstance]
  );

  const addDialogSelectedRoom = useMemo(
    () => classrooms.find((room) => room.room_code === addDialog?.roomCode),
    [addDialog?.roomCode, classrooms]
  );

  return (
    <div className={isEmbedded ? "space-y-4" : "mt-3 space-y-4"}>
      {!isEmbedded && (
        <div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const next = !open;
              onOpenChange(next);
              if (next && !weeklyGrid && !weeklyLoading) {
                void loadWeeklyTimetable();
              }
            }}
            disabled={weeklyLoading}
          >
            {weeklyLoading
              ? "Loading weekly timetable..."
              : open
                ? "Hide weekly timetable"
                : "Show weekly timetable"}
          </button>
        </div>
      )}

      {weeklyError && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {weeklyError}
        </div>
      )}

      {panelOpen && weeklyLoading && !weeklyGrid && (
        <div className="text-sm text-slate-600">Loading weekly timetable...</div>
      )}

      {panelOpen && weeklyGrid && (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-3">
            {!forceViewScopeAll && (
              <div>
                <label className="form-label">顯示範圍</label>
                <select
                  className="form-select"
                  title="Timetable view scope"
                  value={viewScope}
                  disabled={isDirty || weeklyLoading || saving}
                  onChange={(event) => {
                    const next = event.target.value as ViewScope;
                    if (isDirty) {
                      setWeeklyError("請先 Save 再切換顯示範圍。");
                      return;
                    }
                    setViewScope(next);
                  }}
                >
                  <option value="all">显示所有课程</option>
                  <option value="programme">
                    只显示本 Programme
                    {programmeCode ? `（${programmeCode}）` : ""}
                  </option>
                </select>
              </div>
            )}

            {isDirty && !readOnly && (
              <span className="text-sm font-medium text-amber-800">
                有未保存的變更
              </span>
            )}

            {showClassSizeModeToggle ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={weeklyLoading}
                onClick={() =>
                  setClassSizeMode((current) =>
                    current === "expected" ? "actual" : "expected"
                  )
                }
              >
                {classSizeMode === "expected"
                  ? "\u5207\u63db\u81f3\u5be6\u969b\u4eba\u6578"
                  : "\u5207\u63db\u81f3\u9810\u8a08\u4eba\u6578"}
              </button>
            ) : null}

            {!readOnly && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!isDirty || saving || weeklyLoading}
              onClick={() => void handleSaveTimetable()}
            >
              {saving ? "Saving..." : "Save Timetable"}
            </button>
            )}
          </div>

          {saveMessage && (
            <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              {saveMessage}
            </div>
          )}

          {!readOnly && (
          <p className="text-xs text-slate-600">
            {
              "\u6642\u6bb5\u50c5\u986f\u793a\u4e0a\u5348\uff0f\u4e0b\u5348\uff0f\u665a\u4e0a\u3002"
            }
            Use Edit to change the classroom or teacher. To change period,
            remove the module and add it again in the target band
            {
              "\uff08\u65b0\u589e\u9810\u8a2d\uff1a\u4e0a\u5348 09:00\u201313:00\u3001\u4e0b\u5348 14:00\u201318:00\u3001\u665a\u4e0a 18:30\u201322:30\uff09"
            }
            .
          </p>
          )}

          <div className="rounded border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="w-40 border border-slate-200 px-2 py-2 text-left">
                    {"\u6642\u6bb5"}
                  </th>
                  <th
                    colSpan={weekdays.length}
                    className="border border-slate-200 p-0 text-left"
                  >
                    <div
                      ref={(element) => setWeeklyDayScrollRef(0, element)}
                      className={WEEKLY_DAY_SCROLL_CLASS}
                      onScroll={(event) =>
                        syncWeeklyDayScroll(event.currentTarget)
                      }
                    >
                      <div className={`flex ${WEEKLY_DAY_ROW_MIN_WIDTH}`}>
                        {weekdays.map((day) => (
                          <div
                            key={day.id}
                            className={`${WEEKLY_DAY_COLUMN_CLASS} border-t-0 font-medium`}
                          >
                            {day.label}
                          </div>
                        ))}
                      </div>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {weeklyGrid.slots.map((slot, slotIndex) => {
                  const sk = buildWeeklySlotKey(slot.start);
                  // Never show raw start–end here — always 上午/下午/晚上 labels.
                  const periodLabel = weeklyPeriodBandLabel(
                    slot.start,
                    slot.bandId
                  );
                  return (
                    <tr key={sk}>
                      <td
                        className="border border-slate-200 px-2 py-2 align-top font-medium"
                        title={periodLabel}
                      >
                        <div className="leading-snug">{periodLabel}</div>
                      </td>
                      <td colSpan={weekdays.length} className="border border-slate-200 p-0">
                        <div
                          ref={(element) =>
                            setWeeklyDayScrollRef(slotIndex + 1, element)
                          }
                          className={WEEKLY_DAY_SCROLL_CLASS}
                          onScroll={(event) =>
                            syncWeeklyDayScroll(event.currentTarget)
                          }
                        >
                          <div className={`flex ${WEEKLY_DAY_ROW_MIN_WIDTH}`}>
                            {weekdays.map((day) => {
                        const items =
                          weeklyGrid.itemsBySlotAndWeekday[sk]?.[day.id] ?? [];
                        const cellRemaining =
                          remainingClassroomsBySlotAndDay.get(`${sk}|${day.id}`) ??
                          availabilitySummaryClassrooms;
                        const cellKey = `${sk}|${day.id}`;
                        const isBusy = cellBusyKey?.startsWith(
                          `${day.id}|${slot.start}`
                        );

                        return (
                          <div
                            key={cellKey}
                            className={WEEKLY_DAY_COLUMN_CLASS}
                          >
                            <div className="space-y-2">
                              {items.map((item) => {
                                const itemInstance = instanceByCode.get(
                                  item.moduleInstanceCode.toUpperCase()
                                );
                                const studentNumberLabel =
                                  formatInstanceStudentNumber(
                                    itemInstance,
                                    showClassSizeModeToggle
                                      ? classSizeMode
                                      : "expected",
                                    showClassSizeModeToggle
                                      ? enrolledCountByInstanceCode
                                      : null
                                  );
                                const sizeLabel = classSizeChipLabel(
                                  showClassSizeModeToggle
                                    ? classSizeMode
                                    : "expected",
                                  showClassSizeModeToggle
                                );
                                const itemMeta =
                                  moduleMetaByCode[item.moduleInstanceCode] ??
                                  moduleMetaByCode[
                                    item.moduleInstanceCode.toUpperCase()
                                  ];
                                const combineGroupId = String(
                                  itemMeta?.combine_group_id ?? ""
                                ).trim();
                                const combineMembers = combineGroupId
                                  ? combineMembersByGroupId.get(combineGroupId)
                                  : undefined;
                                const highlightProgramme = isSelectedProgrammeHighlight({
                                  programmeCode: item.programmeCode,
                                  schedulingIdentities:
                                    resolveWeeklyItemSchedulingIdentities({
                                      item,
                                      meta: itemMeta,
                                      combineMembers,
                                    }),
                                  combineMembers,
                                  selectedProgrammeCode: programmeCode,
                                  viewScope,
                                });
                                const placementStart =
                                  item.placementStart || slot.start;
                                const placementEnd =
                                  item.placementEnd || slot.end;

                                return (
                                <div
                                  key={`${item.roomCode}-${item.moduleInstanceCode}-${placementStart}`}
                                  className={cn(
                                    "rounded border px-2 py-1.5",
                                    highlightProgramme
                                      ? SELECTED_PROGRAMME_HIGHLIGHT_CELL
                                      : "border-slate-200 bg-slate-50"
                                  )}
                                >
                                  <div className="flex items-start justify-between gap-1">
                                    <div className="min-w-0 flex-1">
                                      <div className="font-medium">
                                        {item.moduleInstanceCode}
                                      </div>
                                      {item.crossesPeriodBands ? (
                                        <div className="text-[11px] font-medium text-amber-800">
                                          {"\u8de8\u6642\u6bb5"}
                                        </div>
                                      ) : null}
                                      <div className="text-xs text-slate-500">
                                        {[
                                          item.moduleYear || null,
                                          viewScope === "all"
                                            ? item.programmeCode || null
                                            : null,
                                        ]
                                          .filter(Boolean)
                                          .join(" · ") || "—"}
                                      </div>
                                      <div className="text-xs text-slate-600">
                                        {item.moduleCode}{" "}
                                        <span>({item.roomCode})</span>
                                      </div>
                                      <div className="text-xs text-slate-600">
                                        {item.moduleName
                                          ? dedupeJoinedModuleName(item.moduleName)
                                          : ""}
                                      </div>
                                      <div className="text-xs text-slate-600">
                                        {item.teacherName || "TBC"}
                                      </div>
                                      <div className="text-xs text-slate-600">
                                        {sizeLabel}: {studentNumberLabel}
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 flex-col gap-1">
                                      {!readOnly && (
                                      <>
                                      <button
                                        type="button"
                                        className="btn btn-secondary px-1.5 py-0.5 text-xs"
                                        title="Edit classroom"
                                        disabled={
                                          Boolean(isBusy) ||
                                          !editableInstanceCodeSet.has(
                                            item.moduleInstanceCode.toUpperCase()
                                          )
                                        }
                                        onClick={() =>
                                          openEditDialog({
                                            weekday: day.id,
                                            start: placementStart,
                                            end: placementEnd,
                                            item,
                                          })
                                        }
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-secondary px-1.5 py-0.5 text-xs"
                                        title="Remove module"
                                        disabled={
                                          Boolean(isBusy) ||
                                          !editableInstanceCodeSet.has(
                                            item.moduleInstanceCode.toUpperCase()
                                          )
                                        }
                                        onClick={() =>
                                          handleRemoveItem({
                                            weekday: day.id,
                                            start: placementStart,
                                            end: placementEnd,
                                            item,
                                          })
                                        }
                                      >
                                        <Minus className="h-3.5 w-3.5" />
                                      </button>
                                      </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                );
                              })}

                              {!readOnly && (
                              <button
                                type="button"
                                className="btn btn-secondary w-full py-0.5 text-xs"
                                title="Add module"
                                disabled={Boolean(isBusy)}
                                onClick={() =>
                                  openAddDialog({
                                    weekday: day.id,
                                    start: slot.start,
                                    end: slot.end,
                                  })
                                }
                              >
                                <Plus className="mr-1 inline h-3.5 w-3.5" />
                                Add
                              </button>
                              )}

                              <RemainingClassroomsCellSummary
                                remaining={cellRemaining}
                                totalCount={availabilitySummaryClassrooms.length}
                                label={
                                  summaryLocation
                                    ? `${summaryLocation} remaining`
                                    : "Remaining"
                                }
                              />
                            </div>
                          </div>
                        );
                      })}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!hideInstancePanel && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">
              {instancePanelTitle ?? `待編時間表模組（${term}）`}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {instancePanelDescription ??
                "編輯後請按 Save Timetable 才會寫入系統；下方列表顯示本 Programme 待排模組。Save 後其他 PL 查看每周時間表時會避開／讀取已儲存的時段。"}
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Module instance code</th>
                    <th className="px-3 py-2 text-left">Module name</th>
                    <th className="px-3 py-2 text-left">Year</th>
                    <th className="px-3 py-2 text-left">Teacher</th>
                    <th className="px-3 py-2 text-left">{EXPECTED_SIZE_LABEL}</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {timetableInstances.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-4 text-slate-500"
                      >
                        No module instances for this term.
                      </td>
                    </tr>
                  ) : (
                    timetableInstances.map((row) => {
                      const scheduled = scheduledInstanceCodes.has(
                        row.module_instance_code
                      );
                      const meta =
                        moduleMetaByCode[row.module_instance_code] ??
                        moduleMetaByCode[row.module_instance_code.toUpperCase()];
                      const combineGroupId = String(
                        meta?.combine_group_id ?? ""
                      ).trim();
                      const combineMembers = combineGroupId
                        ? combineMembersByGroupId.get(combineGroupId)
                        : undefined;
                      const highlightProgramme = isSelectedProgrammeHighlight({
                        programmeCode: meta?.programme_code,
                        schedulingIdentities: meta
                          ? resolveModuleSchedulingIdentities({
                              programmeCode: meta.programme_code,
                              streamCode: meta.stream_code,
                              moduleYear: meta.module_year,
                              combineMembers,
                            })
                          : undefined,
                        combineMembers,
                        selectedProgrammeCode: programmeCode,
                        viewScope,
                      });
                      return (
                        <tr
                          key={row.id}
                          className={cn(
                            "border-t",
                            highlightProgramme && SELECTED_PROGRAMME_HIGHLIGHT_ROW
                          )}
                        >
                          <td className="px-3 py-2 font-mono font-medium">
                            {row.module_instance_code}
                          </td>
                          <td className="px-3 py-2">
                            {row.module_name
                              ? dedupeJoinedModuleName(row.module_name)
                              : row.module_code}
                          </td>
                          <td className="px-3 py-2">
                            {meta?.module_year || "-"}
                          </td>
                          <td className="px-3 py-2">
                            {row.instance_teacher_name || "TBC"}
                          </td>
                          <td className="px-3 py-2">
                            {formatInstanceStudentNumber(row)}
                          </td>
                          <td className="px-3 py-2">
                            {scheduled ? (
                              <span className="text-green-700">已排</span>
                            ) : (
                              <span className="text-slate-500">未排</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </>
      )}

      {editDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border bg-white p-5 shadow-lg">
            <div className="text-base font-semibold text-slate-900">
              Edit classroom / teacher
            </div>
            <div className="mt-1 text-sm text-slate-600">
              {weekdays.find((d) => d.id === editDialog.weekday)?.label}{" "}
              {editDialog.start}–{editDialog.end}
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="form-label">Module instance code</label>
                <div className="form-input bg-slate-50 font-mono text-slate-700">
                  {editDialog.item.moduleInstanceCode}
                </div>
              </div>

              <div>
                <label className="form-label">Module</label>
                <div className="form-input bg-slate-50 text-slate-700">
                  {editDialog.item.moduleName
                    ? dedupeJoinedModuleName(editDialog.item.moduleName)
                    : editDialog.item.moduleCode}
                </div>
              </div>

              <div>
                <label className="form-label">Teacher</label>
                <InstanceTeacherSelect
                  value={editDialog.teacherName}
                  teachers={teachers}
                  onChange={(nextTeacher) =>
                    setEditDialog((prev) =>
                      prev ? { ...prev, teacherName: nextTeacher } : prev
                    )
                  }
                />
              </div>

              <div>
                <label className="form-label">{EXPECTED_SIZE_LABEL}</label>
                <div className="form-input bg-slate-50 text-slate-700">
                  {formatInstanceStudentNumber(editDialogInstance)}
                </div>
              </div>

              <div>
                <label className="form-label">Room</label>
                <select
                  className="form-select"
                  title="Room"
                  value={editDialog.roomCode}
                  onChange={(event) =>
                    setEditDialog((prev) =>
                      prev ? { ...prev, roomCode: event.target.value } : prev
                    )
                  }
                >
                  {classrooms.map((room) => (
                    <option key={room.room_code} value={room.room_code}>
                      {room.room_code} ({room.room_size}
                      {room.room_type === "computer" ? ", computer" : ""})
                    </option>
                  ))}
                </select>
                <RoomCapacityHint
                  studentNumber={editDialogStudentNumber}
                  room={editDialogSelectedRoom}
                />
              </div>
            </div>

            {editError && (
              <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {editError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setEditDialog(null);
                  setEditError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleConfirmEdit()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {addDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border bg-white p-5 shadow-lg">
            <div className="text-base font-semibold text-slate-900">
              Add module to timeslot
            </div>
            <div className="mt-1 text-sm text-slate-600">
              {weekdays.find((d) => d.id === addDialog.weekday)?.label}{" "}
              {addDialog.start}–{addDialog.end}
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="form-label">Module instance code</label>
                <input
                  className="form-input font-mono"
                  value={addDialog.moduleInstanceCode}
                  list="weekly-instance-code-options"
                  placeholder="e.g. CS401"
                  onChange={(event) =>
                    setAddDialog((prev) =>
                      prev
                        ? { ...prev, moduleInstanceCode: event.target.value }
                        : prev
                    )
                  }
                />
                <datalist id="weekly-instance-code-options">
                  {addDialogInstanceOptions.map((row) => (
                    <option
                      key={row.id}
                      value={row.module_instance_code}
                    />
                  ))}
                </datalist>
                {addDialog.moduleInstanceCode.trim() && (
                  <div className="mt-1 text-xs text-slate-600">
                    {(() => {
                      if (!addDialogInstance) return "Unknown instance code.";
                      return `${addDialogInstance.module_name || addDialogInstance.module_code} · ${
                        addDialogInstance.instance_teacher_name || "TBC"
                      } · ${EXPECTED_SIZE_LABEL}: ${formatInstanceStudentNumber(addDialogInstance)}`;
                    })()}
                  </div>
                )}
              </div>

              <div>
                <label className="form-label">Room</label>
                <select
                  className="form-select"
                  title="Room"
                  value={addDialog.roomCode}
                  onChange={(event) =>
                    setAddDialog((prev) =>
                      prev ? { ...prev, roomCode: event.target.value } : prev
                    )
                  }
                >
                  {addDialogRemainingClassrooms.map((room) => (
                    <option key={room.room_code} value={room.room_code}>
                      {room.room_code} ({room.room_size}
                      {room.room_type === "computer" ? ", computer" : ""})
                    </option>
                  ))}
                </select>
                <RemainingClassroomsCellSummary
                  remaining={filterClassroomsByLocation(
                    addDialogRemainingClassrooms,
                    summaryLocation
                  )}
                  totalCount={availabilitySummaryClassrooms.length}
                  label={
                    summaryLocation ? `${summaryLocation} remaining` : "Remaining"
                  }
                />
                <RoomCapacityHint
                  studentNumber={addDialogStudentNumber}
                  room={addDialogSelectedRoom}
                />
              </div>
            </div>

            {addError && (
              <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {addError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setAddDialog(null);
                  setAddError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={Boolean(cellBusyKey)}
                onClick={() => void handleConfirmAdd()}
              >
                Add module
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
