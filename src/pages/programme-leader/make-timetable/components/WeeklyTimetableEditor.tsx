import { useCallback, useEffect, useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";

import { dedupeJoinedModuleName } from "../../../../lib/moduleDisplay";
import { useAuth } from "../../../../contexts/AuthContext";
import type { TimetableModuleInstanceRow } from "../../../../services/timetableModuleInstanceService";
import {
  addModuleToWeeklySlot,
  mergeWeeklySlotRows,
  removeModuleFromWeeklySlot,
  type WeeklyGridItem,
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

type WeeklyGridState = {
  slots: Array<{ start: string; end: string }>;
  itemsBySlotAndWeekday: Record<string, Record<number, WeeklyGridItem[]>>;
};

type AddDialogState = {
  weekday: 1 | 2 | 3 | 4 | 5 | 6;
  start: string;
  end: string;
  moduleInstanceCode: string;
  roomCode: string;
};

export function WeeklyTimetableEditor(props: {
  academicYear: string;
  term: TimetableScheduleTerm;
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
  const [cellBusyKey, setCellBusyKey] = useState<string | null>(null);
  const [addDialog, setAddDialog] = useState<AddDialogState | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

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

    try {
      const instanceCodesForTerm = new Set(
        timetableInstances
          .map((row) => String(row.module_instance_code ?? "").trim())
          .filter(Boolean)
      );

      const [sessions, timetableModules] = await Promise.all([
        listTimetableSessions({ academicYear }),
        listTimetableModulesByInstanceCodes({
          academicYear,
          moduleInstanceCodes: Array.from(instanceCodesForTerm),
        }),
      ]);

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
        if (!instanceCodesForTerm.has(instanceCode)) continue;

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

        const timetableModule = moduleByInstanceCode.get(instanceCode);

        collapsed.set(key, {
          weekday,
          start,
          end,
          moduleInstanceCode: instanceCode,
          moduleCode: String(session.module_code ?? "").trim(),
          moduleName: String(session.module_name ?? "").trim(),
          teacherName: String(session.teacher_name ?? "").trim(),
          roomCode,
          programmeCode: String(timetableModule?.programme_code ?? "").trim(),
          streamCode: String(timetableModule?.stream_code ?? "").trim(),
          moduleYear: String(timetableModule?.module_year ?? "").trim(),
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

      setWeeklyGrid({ slots, itemsBySlotAndWeekday });
    } catch (error) {
      setWeeklyError(
        error instanceof Error ? error.message : "Failed to load weekly timetable."
      );
    } finally {
      setWeeklyLoading(false);
    }
  }, [
    academicYear,
    preferredStartByCode,
    startTimeOptions,
    timetableInstances,
  ]);

  useEffect(() => {
    if (open && !weeklyGrid && !weeklyLoading) {
      void loadWeeklyTimetable();
    }
  }, [open, weeklyGrid, weeklyLoading, loadWeeklyTimetable]);

  useEffect(() => {
    if (open) {
      void loadWeeklyTimetable();
    }
  }, [refreshToken, open, loadWeeklyTimetable]);

  async function handleRemoveItem(params: {
    weekday: 1 | 2 | 3 | 4 | 5 | 6;
    start: string;
    end: string;
    item: WeeklyGridItem;
  }) {
    const busyKey = `${params.weekday}|${params.start}|${params.end}|remove|${params.item.moduleInstanceCode}`;
    setCellBusyKey(busyKey);
    setWeeklyError(null);

    try {
      await removeModuleFromWeeklySlot({
        academicYear,
        term,
        weekday: params.weekday,
        startTime: params.start,
        endTime: params.end,
        roomCode: params.item.roomCode,
        moduleInstanceCode: params.item.moduleInstanceCode,
      });
      await loadWeeklyTimetable();
    } catch (error) {
      setWeeklyError(
        error instanceof Error ? error.message : "Failed to remove module."
      );
    } finally {
      setCellBusyKey(null);
    }
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
    if (!addDialog) return;

    const code = addDialog.moduleInstanceCode.trim();
    const instance = instanceByCode.get(code.toUpperCase());

    if (!instance) {
      setAddError(`Unknown module instance code "${code}" for ${term} semester.`);
      return;
    }

    const sk = `${addDialog.start}-${addDialog.end}`;
    const existing =
      weeklyGrid?.itemsBySlotAndWeekday[sk]?.[addDialog.weekday] ?? [];

    setCellBusyKey(`${addDialog.weekday}|${addDialog.start}|${addDialog.end}|add`);
    setAddError(null);

    try {
      await addModuleToWeeklySlot({
        academicYear,
        term,
        weekday: addDialog.weekday,
        startTime: addDialog.start,
        endTime: addDialog.end,
        roomCode: addDialog.roomCode,
        moduleInstanceCode: code,
        instance,
        existingOccupants: existing,
        createdBy: user?.id ?? null,
      });
      setAddDialog(null);
      await loadWeeklyTimetable();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Failed to add module.");
    } finally {
      setCellBusyKey(null);
    }
  }

  const scheduledInstanceCodes = useMemo(() => {
    const set = new Set<string>();
    if (!weeklyGrid) return set;
    for (const sk of Object.keys(weeklyGrid.itemsBySlotAndWeekday)) {
      for (const day of Object.keys(weeklyGrid.itemsBySlotAndWeekday[sk] ?? {})) {
        for (const item of weeklyGrid.itemsBySlotAndWeekday[sk]![Number(day)] ?? []) {
          set.add(item.moduleInstanceCode);
        }
      }
    }
    return set;
  }, [weeklyGrid]);

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
                                      disabled={Boolean(isBusy)}
                                      onClick={() =>
                                        void handleRemoveItem({
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
              填寫 module instance code 後會自動帶入 module name 及教師；衝突規則：同一時段內，相同
              老師 + programme + stream + 年級 不能重複。
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
