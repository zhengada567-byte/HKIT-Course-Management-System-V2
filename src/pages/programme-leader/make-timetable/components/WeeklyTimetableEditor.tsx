import { useCallback, useEffect, useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";

import { dedupeJoinedModuleName } from "../../../../lib/moduleDisplay";
import { useAuth } from "../../../../contexts/AuthContext";
import type { TimetableModuleInstanceRow } from "../../../../services/timetableModuleInstanceService";
import {
  buildDraftWeeklyPlacement,
  cloneWeeklyGridState,
  collectWeeklyPlacements,
  mergeWeeklySlotRows,
  persistWeeklyTimetableDraft,
  wouldWeeklyPlacementConflict,
  type WeeklyGridItem,
  type WeeklyGridState,
} from "../../../../services/timetableManualScheduleService";
import {
  listTimetableSessions,
  type TimetableClassroomRow,
  type TimetableScheduleTerm,
} from "../../../../services/timetableScheduleService";
import { listTimetableModulesByInstanceCodes } from "../../../../services/timetableService";

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

type ViewScope = "all" | "programme";

export function WeeklyTimetableEditor(props: {
  academicYear: string;
  term: TimetableScheduleTerm;
  programmeCode?: string;
  timetableInstances: TimetableModuleInstanceRow[];
  classrooms: TimetableClassroomRow[];
  preferredStartByCode: Record<string, string>;
  startTimeOptions: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refreshToken?: string | number | null;
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
    open,
    onOpenChange,
    refreshToken,
  } = props;

  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);
  const [weeklyGrid, setWeeklyGrid] = useState<WeeklyGridState | null>(null);
  const [savedGrid, setSavedGrid] = useState<WeeklyGridState | null>(null);
  const [viewScope, setViewScope] = useState<ViewScope>("all");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [cellBusyKey, setCellBusyKey] = useState<string | null>(null);
  const [addDialog, setAddDialog] = useState<AddDialogState | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const editableInstanceCodes = useMemo(
    () =>
      timetableInstances
        .map((row) => String(row.module_instance_code ?? "").trim())
        .filter(Boolean),
    [timetableInstances]
  );

  const editableInstanceCodeSet = useMemo(
    () => new Set(editableInstanceCodes.map((code) => code.toUpperCase())),
    [editableInstanceCodes]
  );

  const instanceByCode = useMemo(() => {
    const map = new Map<string, TimetableModuleInstanceRow>();
    for (const row of timetableInstances) {
      const code = String(row.module_instance_code ?? "").trim();
      if (code) map.set(code.toUpperCase(), row);
    }
    return map;
  }, [timetableInstances]);

  const loadWeeklyTimetable = useCallback(async () => {
    setWeeklyLoading(true);
    setWeeklyError(null);
    setSaveMessage(null);

    try {
      const programmeInstanceCodes = new Set(editableInstanceCodes);

      const sessions = await listTimetableSessions({ academicYear });
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

      const collapsed = new Map<
        string,
        WeeklyGridItem & { weekday: number; start: string; end: string }
      >();
      const sessionSlots: Array<{ start: string; end: string }> = [];

      for (const session of sessions) {
        if (session.status === "cancel") continue;

        const instanceCode = String(session.module_instance_code ?? "").trim();
        const timetableModule = moduleByInstanceCode.get(instanceCode);

        if (!timetableModule || timetableModule.module_term !== term) {
          continue;
        }

        if (viewScope === "programme") {
          if (!programmeInstanceCodes.has(instanceCode)) continue;
          if (
            programmeCode &&
            String(timetableModule.programme_code ?? "").trim() !== programmeCode
          ) {
            continue;
          }
        }

        const dateIso = String(session.session_date ?? "").slice(0, 10);
        if (!dateIso) continue;

        const jsDay = new Date(`${dateIso}T00:00:00`).getDay();
        if (jsDay === 0) continue;

        const weekday = jsDay;
        const start = String(session.start_time ?? "").slice(0, 5);
        const end = String(session.end_time ?? "").slice(0, 5);
        const roomCode = String(session.room_code ?? "").trim();

        if (!start || !end || !roomCode) continue;

        sessionSlots.push({ start, end });

        const key = [weekday, start, end, roomCode, instanceCode].join("|");
        if (collapsed.has(key)) continue;

        collapsed.set(key, {
          weekday,
          start,
          end,
          moduleInstanceCode: instanceCode,
          moduleCode: String(session.module_code ?? "").trim(),
          moduleName: String(session.module_name ?? "").trim(),
          teacherName: String(session.teacher_name ?? "").trim(),
          roomCode,
          programmeCode: String(timetableModule.programme_code ?? "").trim(),
          streamCode: String(timetableModule.stream_code ?? "").trim(),
          moduleYear: String(timetableModule.module_year ?? "").trim(),
        });
      }

      const slotKey = (start: string, end: string) => `${start}-${end}`;
      const itemsBySlotAndWeekday: WeeklyGridState["itemsBySlotAndWeekday"] = {};

      for (const item of collapsed.values()) {
        const sk = slotKey(item.start, item.end);
        itemsBySlotAndWeekday[sk] ||= {};
        itemsBySlotAndWeekday[sk][item.weekday] ||= [];
        itemsBySlotAndWeekday[sk][item.weekday]!.push({
          moduleInstanceCode: item.moduleInstanceCode,
          moduleCode: item.moduleCode,
          moduleName: item.moduleName,
          teacherName: item.teacherName,
          roomCode: item.roomCode,
          programmeCode: item.programmeCode,
          streamCode: item.streamCode,
          moduleYear: item.moduleYear,
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
        new Map(sessionSlots.map((slot) => [`${slot.start}-${slot.end}`, slot])).values()
      );

      const slots = mergeWeeklySlotRows({
        sessionSlots: uniqueSessionSlots,
        instances: timetableInstances,
        preferredStartByCode,
        startTimeOptions,
      });

      const nextGrid = { slots, itemsBySlotAndWeekday };
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
    editableInstanceCodes,
    preferredStartByCode,
    programmeCode,
    startTimeOptions,
    term,
    timetableInstances,
    viewScope,
  ]);

  useEffect(() => {
    if (open) {
      void loadWeeklyTimetable();
    }
  }, [refreshToken, open, viewScope, loadWeeklyTimetable]);

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

    return false;
  }, [editableInstanceCodeSet, savedGrid, weeklyGrid]);

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

      const next = cloneWeeklyGridState(current);
      const sk = `${params.start}-${params.end}`;
      const items = next.itemsBySlotAndWeekday[sk]?.[params.weekday] ?? [];

      next.itemsBySlotAndWeekday[sk] = {
        ...(next.itemsBySlotAndWeekday[sk] ?? {}),
        [params.weekday]: items.filter(
          (row) =>
            !(
              row.moduleInstanceCode === params.item.moduleInstanceCode &&
              row.roomCode === params.item.roomCode
            )
        ),
      };

      return next;
    });
    setSaveMessage(null);
  }

  function openAddDialog(params: {
    weekday: 1 | 2 | 3 | 4 | 5 | 6;
    start: string;
    end: string;
  }) {
    setAddError(null);
    setAddDialog({
      weekday: params.weekday,
      start: params.start,
      end: params.end,
      moduleInstanceCode: "",
      roomCode: classrooms[0]?.room_code ?? "",
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

    setCellBusyKey(`${addDialog.weekday}|${addDialog.start}|${addDialog.end}|add`);
    setAddError(null);

    try {
      const [timetableModule] = await listTimetableModulesByInstanceCodes({
        academicYear,
        moduleInstanceCodes: [code],
      });

      if (!timetableModule) {
        throw new Error(`No timetable module found for "${code}".`);
      }

      const sk = `${addDialog.start}-${addDialog.end}`;
      const existing =
        weeklyGrid.itemsBySlotAndWeekday[sk]?.[addDialog.weekday] ?? [];

      const placement = buildDraftWeeklyPlacement({
        weekday: addDialog.weekday,
        start: addDialog.start,
        end: addDialog.end,
        roomCode: addDialog.roomCode,
        instance,
        timetableModule,
      });

      const conflict = wouldWeeklyPlacementConflict(existing, placement);
      if (conflict) {
        throw new Error(conflict);
      }

      setWeeklyGrid((current) => {
        if (!current) return current;

        const next = cloneWeeklyGridState(current);
        next.itemsBySlotAndWeekday[sk] = {
          ...(next.itemsBySlotAndWeekday[sk] ?? {}),
          [addDialog.weekday]: [...existing, placement].sort((a, b) => {
            if (a.roomCode !== b.roomCode) {
              return a.roomCode.localeCompare(b.roomCode);
            }
            return a.moduleInstanceCode.localeCompare(b.moduleInstanceCode);
          }),
        };
        return next;
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
      const result = await persistWeeklyTimetableDraft({
        academicYear,
        term,
        savedGrid,
        draftGrid: weeklyGrid,
        editableInstanceCodes,
        instanceByCode,
        createdBy: user?.id ?? null,
      });

      await loadWeeklyTimetable();
      setSaveMessage(
        `已儲存至系統：新增 ${result.savedCount} 項，移除 ${result.removedCount} 項。其他 PL 自動排課會讀取這些已儲存時段。`
      );
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

  return (
    <div className="mt-3 space-y-4">
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

      {weeklyError && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {weeklyError}
        </div>
      )}

      {open && weeklyGrid && (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-3">
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
                <option value="all">全部課程（系統已儲存）</option>
                <option value="programme">
                  只看本 Programme{programmeCode ? `（${programmeCode}）` : ""}
                </option>
              </select>
            </div>

            {isDirty && (
              <span className="text-sm font-medium text-amber-800">
                有未保存的變更
              </span>
            )}

            <button
              type="button"
              className="btn btn-primary"
              disabled={!isDirty || saving || weeklyLoading}
              onClick={() => void handleSaveTimetable()}
            >
              {saving ? "Saving..." : "Save Timetable"}
            </button>
          </div>

          {saveMessage && (
            <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              {saveMessage}
            </div>
          )}

          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-[980px] table-fixed border-collapse text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="w-28 border border-slate-200 px-2 py-2 text-left">
                    Time
                  </th>
                  {weekdays.map((day) => (
                    <th
                      key={day.id}
                      className="border border-slate-200 px-2 py-2 text-left"
                    >
                      {day.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeklyGrid.slots.map((slot) => {
                  const sk = `${slot.start}-${slot.end}`;
                  return (
                    <tr key={sk}>
                      <td className="border border-slate-200 px-2 py-2 align-top font-medium">
                        {slot.start}–{slot.end}
                      </td>
                      {weekdays.map((day) => {
                        const items =
                          weeklyGrid.itemsBySlotAndWeekday[sk]?.[day.id] ?? [];
                        const cellKey = `${sk}|${day.id}`;
                        const isBusy = cellBusyKey?.startsWith(`${day.id}|${slot.start}|${slot.end}`);

                        return (
                          <td
                            key={cellKey}
                            className="border border-slate-200 px-2 py-2 align-top"
                          >
                            <div className="space-y-2">
                              {items.map((item) => (
                                <div
                                  key={`${item.roomCode}-${item.moduleInstanceCode}`}
                                  className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5"
                                >
                                  <div className="flex items-start justify-between gap-1">
                                    <div className="min-w-0 flex-1">
                                      <div className="font-medium">
                                        {item.moduleInstanceCode}
                                      </div>
                                      {viewScope === "all" && item.programmeCode && (
                                        <div className="text-xs text-slate-500">
                                          {item.programmeCode}
                                        </div>
                                      )}
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
                                    </div>
                                    <button
                                      type="button"
                                      className="btn btn-secondary shrink-0 px-1.5 py-0.5 text-xs"
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
                                          start: slot.start,
                                          end: slot.end,
                                          item,
                                        })
                                      }
                                    >
                                      <Minus className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}

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
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">
              待編時間表模組（{term}）
            </div>
            <div className="mt-1 text-xs text-slate-600">
              編輯後請按 Save Timetable 才會寫入系統；下方列表顯示本 Programme 待排模組。
              Save 後其他 PL 自動排課會避開已儲存的時段。
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Module instance code</th>
                    <th className="px-3 py-2 text-left">Module name</th>
                    <th className="px-3 py-2 text-left">Teacher</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {timetableInstances.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
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
                      return (
                        <tr key={row.id} className="border-t">
                          <td className="px-3 py-2 font-mono font-medium">
                            {row.module_instance_code}
                          </td>
                          <td className="px-3 py-2">
                            {row.module_name
                              ? dedupeJoinedModuleName(row.module_name)
                              : row.module_code}
                          </td>
                          <td className="px-3 py-2">
                            {row.instance_teacher_name || "TBC"}
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
        </>
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
                  {timetableInstances.map((row) => (
                    <option
                      key={row.id}
                      value={row.module_instance_code}
                    />
                  ))}
                </datalist>
                {addDialog.moduleInstanceCode.trim() && (
                  <div className="mt-1 text-xs text-slate-600">
                    {(() => {
                      const inst = instanceByCode.get(
                        addDialog.moduleInstanceCode.trim().toUpperCase()
                      );
                      if (!inst) return "Unknown instance code.";
                      return `${inst.module_name || inst.module_code} · ${
                        inst.instance_teacher_name || "TBC"
                      }`;
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
                  {classrooms.map((room) => (
                    <option key={room.room_code} value={room.room_code}>
                      {room.room_code} ({room.room_size}
                      {room.room_type === "computer" ? ", computer" : ""})
                    </option>
                  ))}
                </select>
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
