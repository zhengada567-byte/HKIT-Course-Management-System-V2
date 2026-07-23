import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Plus, Trash2 } from "lucide-react";

import { EmptyState } from "../ui/EmptyState";
import { useLanguage } from "../../contexts/LanguageContext";
import { buildDefaultNewSessionDraft, resolveModuleDefaultTeacher } from "../../lib/dailyTimetableSessionDefaults";
import type { TimetableSessionStatus } from "../../lib/dailyTimetableSessionLabels";
import { InstanceTeacherSelect } from "../../pages/programme-leader/make-timetable/components/InstanceTeacherSelect";
import {
  partitionDailyModuleEntries,
  changeDailySessionKind,
  clearDailyLabelPlanLock,
  type DailyTimetableBuildResult,
  type DailyTimetableEntry,
  type DailyTimetableModulePlan,
} from "../../services/dailyTimetableService";
import { isTutorialTimetableSession } from "../../lib/dailyTimetable";
import {
  moduleEditorIsDirty,
  saveDailyTimetableModule,
  type DailySessionDraftInput,
  type PendingDailySessionAdd,
} from "../../services/dailyTimetableModuleSaveService";
import { listTeachers } from "../../services/teacherService";
import type { TimetableClassroomRow, TimetableScheduleTerm } from "../../services/timetableScheduleService";
import type { TeacherRow } from "../../types";
import { displayStream } from "../../pages/programme-leader/make-timetable/helpers";

type ViewMode = "module" | "date";

const statusOptions: TimetableSessionStatus[] = ["normal", "cancel", "make_up"];

export type DailyModuleEditorProps = {
  academicYear: string;
  term: TimetableScheduleTerm;
  result: DailyTimetableBuildResult;
  modulePlans: DailyTimetableModulePlan[];
  classrooms: TimetableClassroomRow[];
  changedBy: string | null;
  onRefreshPlan: (timetableModuleId: string) => Promise<void>;
  onMessage: (message: string) => void;
};

function buildDraftFromEntry(
  entry: DailyTimetableEntry,
  moduleDefaultTeacher: string | null = null
): DailySessionDraftInput {
  const sessionTeacher = String(entry.teacherName ?? "").trim();

  return {
    session_date: entry.sessionDate,
    start_time: entry.startTime.slice(0, 5),
    end_time: entry.endTime.slice(0, 5),
    room_code: entry.roomCode,
    teacher_name: sessionTeacher || moduleDefaultTeacher || null,
    status: entry.status,
    remark: entry.remark ?? "",
  };
}

function initDraftsFromPlans(plans: DailyTimetableModulePlan[]) {
  const next: Record<string, DailySessionDraftInput> = {};

  for (const plan of plans) {
    const moduleDefaultTeacher = resolveModuleDefaultTeacher(plan.entries);

    for (const entry of plan.entries) {
      if (!entry.sessionId) continue;
      next[entry.sessionId] = buildDraftFromEntry(entry, moduleDefaultTeacher);
    }
  }

  return next;
}

function statusLabel(
  status: TimetableSessionStatus,
  t: ReturnType<typeof useLanguage>["t"]
) {
  if (status === "cancel") return t.sessionStatusCancel;
  if (status === "make_up") return t.sessionStatusMakeUp;
  return t.sessionStatusNormal;
}

export function DailyModuleEditor({
  academicYear,
  term,
  result,
  modulePlans,
  classrooms,
  changedBy,
  onRefreshPlan,
  onMessage,
}: DailyModuleEditorProps) {
  const { t } = useLanguage();

  const [viewMode, setViewMode] = useState<ViewMode>("module");
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DailySessionDraftInput>>({});
  const [pendingAddsByModule, setPendingAddsByModule] = useState<
    Record<string, PendingDailySessionAdd[]>
  >({});
  const [pendingDeletesByModule, setPendingDeletesByModule] = useState<
    Record<string, Set<string>>
  >({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSession, setNewSession] = useState<DailySessionDraftInput>({
    session_date: "",
    start_time: "09:00",
    end_time: "13:00",
    room_code: "",
    teacher_name: null,
    status: "normal",
    remark: "",
  });
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [savingModuleId, setSavingModuleId] = useState<string | null>(null);
  const [kindBusySessionId, setKindBusySessionId] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    setDrafts(initDraftsFromPlans(modulePlans));
    setPendingAddsByModule({});
    setPendingDeletesByModule({});
    setSelectedSessionIds(new Set());
  }, [result, modulePlans]);

  useEffect(() => {
    let cancelled = false;

    void listTeachers(academicYear).then((rows) => {
      if (!cancelled) {
        setTeachers(rows);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [academicYear]);

  useEffect(() => {
    setSelectedSessionIds(new Set());
  }, [selectedModuleId, selectedDate, viewMode]);

  useEffect(() => {
    if (
      selectedModuleId &&
      modulePlans.some((plan) => plan.timetableModuleId === selectedModuleId)
    ) {
      return;
    }

    setSelectedModuleId(modulePlans[0]?.timetableModuleId ?? "");
  }, [modulePlans, selectedModuleId]);

  const availableDates = useMemo(() => {
    const dates = new Set<string>();

    for (const plan of modulePlans) {
      for (const entry of plan.entries) {
        dates.add(entry.sessionDate);
      }

      for (const pending of pendingAddsByModule[plan.timetableModuleId] ?? []) {
        if (pending.session_date) {
          dates.add(pending.session_date);
        }
      }
    }

    return Array.from(dates).sort();
  }, [modulePlans, pendingAddsByModule]);

  useEffect(() => {
    if (selectedDate && availableDates.includes(selectedDate)) {
      return;
    }

    setSelectedDate(availableDates[0] ?? "");
  }, [availableDates, selectedDate]);

  const selectedPlan = useMemo(
    () =>
      modulePlans.find((plan) => plan.timetableModuleId === selectedModuleId) ?? null,
    [modulePlans, selectedModuleId]
  );

  const moduleDefaultTeachersById = useMemo(() => {
    const map = new Map<string, string | null>();

    for (const plan of modulePlans) {
      map.set(
        plan.timetableModuleId,
        resolveModuleDefaultTeacher(plan.entries)
      );
    }

    return map;
  }, [modulePlans]);

  const selectedModuleDefaultTeacher = selectedPlan
    ? (moduleDefaultTeachersById.get(selectedPlan.timetableModuleId) ?? null)
    : null;

  const selectedPendingAdds = pendingAddsByModule[selectedModuleId] ?? [];
  const selectedPendingDeletes =
    pendingDeletesByModule[selectedModuleId] ?? new Set<string>();

  const selectedPlanPartitions = useMemo(() => {
    if (!selectedPlan) {
      return { scheduled: [], backup: [], cancelled: [] };
    }

    const visibleEntries = selectedPlan.entries.filter(
      (entry) => !entry.sessionId || !selectedPendingDeletes.has(entry.sessionId)
    );

    return partitionDailyModuleEntries(visibleEntries, drafts);
  }, [drafts, selectedPendingDeletes, selectedPlan]);

  const moduleDirty = useMemo(() => {
    if (!selectedPlan) return false;

    return moduleEditorIsDirty({
      plan: selectedPlan,
      drafts,
      pendingAdds: selectedPendingAdds,
      pendingDeletes: selectedPendingDeletes,
    });
  }, [drafts, selectedPendingAdds, selectedPendingDeletes, selectedPlan]);

  const dirtyModulePlans = useMemo(
    () =>
      modulePlans.filter((plan) =>
        moduleEditorIsDirty({
          plan,
          drafts,
          pendingAdds: pendingAddsByModule[plan.timetableModuleId] ?? [],
          pendingDeletes:
            pendingDeletesByModule[plan.timetableModuleId] ?? new Set<string>(),
        })
      ),
    [drafts, modulePlans, pendingAddsByModule, pendingDeletesByModule]
  );

  const dateEntries = useMemo(() => {
    if (!selectedDate) return [];

    const moduleIds = new Set(modulePlans.map((plan) => plan.timetableModuleId));
    const rows: DailyTimetableEntry[] = [];

    for (const plan of modulePlans) {
      for (const entry of plan.entries) {
        if (entry.sessionId && selectedPendingDeletes.has(entry.sessionId)) {
          continue;
        }

        const draftDate =
          entry.sessionId && drafts[entry.sessionId]
            ? drafts[entry.sessionId].session_date
            : entry.sessionDate;

        if (draftDate === selectedDate) {
          rows.push(entry);
        }
      }
    }

    return rows.filter((row) => moduleIds.has(row.timetableModuleId));
  }, [
    drafts,
    modulePlans,
    pendingDeletesByModule,
    selectedDate,
    selectedPendingDeletes,
  ]);

  function getPendingDeletes(moduleId: string) {
    return pendingDeletesByModule[moduleId] ?? new Set<string>();
  }

  function updateDraft(sessionId: string, patch: Partial<DailySessionDraftInput>) {
    setDrafts((current) => {
      let base = current[sessionId];

      if (!base) {
        for (const plan of modulePlans) {
          const entry = plan.entries.find((row) => row.sessionId === sessionId);
          if (entry) {
            base = buildDraftFromEntry(
              entry,
              moduleDefaultTeachersById.get(plan.timetableModuleId) ?? null
            );
            break;
          }
        }
      }

      return {
        ...current,
        [sessionId]: {
          ...(base ?? {
            session_date: "",
            start_time: "09:00",
            end_time: "13:00",
            room_code: "",
            teacher_name: null,
            status: "normal" as TimetableSessionStatus,
            remark: "",
          }),
          ...patch,
        },
      };
    });
  }

  function resetModuleEditorState(moduleId: string, plan: DailyTimetableModulePlan) {
    const moduleDefaultTeacher =
      moduleDefaultTeachersById.get(moduleId) ??
      resolveModuleDefaultTeacher(plan.entries);

    setDrafts((current) => {
      const next = { ...current };

      for (const entry of plan.entries) {
        if (!entry.sessionId) continue;
        next[entry.sessionId] = buildDraftFromEntry(entry, moduleDefaultTeacher);
      }

      return next;
    });

    setPendingAddsByModule((current) => {
      if (!current[moduleId]) return current;
      const next = { ...current };
      delete next[moduleId];
      return next;
    });

    setPendingDeletesByModule((current) => {
      if (!current[moduleId]) return current;
      const next = { ...current };
      delete next[moduleId];
      return next;
    });
  }

  async function handleSaveModule(plan: DailyTimetableModulePlan) {
    const moduleId = plan.timetableModuleId;
    const pendingAdds = pendingAddsByModule[moduleId] ?? [];
    const pendingDeletes = Array.from(getPendingDeletes(moduleId));

    if (
      !moduleEditorIsDirty({
        plan,
        drafts,
        pendingAdds,
        pendingDeletes: getPendingDeletes(moduleId),
      })
    ) {
      onMessage(t.dailyModuleNoChanges);
      return;
    }

    setSavingModuleId(moduleId);
    onMessage("");

    try {
      const saveResult = await saveDailyTimetableModule({
        academicYear,
        term,
        plan,
        drafts,
        pendingAdds,
        pendingDeletes,
        changedBy,
      });

      await onRefreshPlan(moduleId);
      onMessage(saveResult.message);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSavingModuleId(null);
    }
  }

  async function handleSaveAllDirtyModules() {
    if (dirtyModulePlans.length === 0) {
      onMessage(t.dailyModuleNoChanges);
      return;
    }

    setSavingModuleId("__all__");
    onMessage("");

    try {
      const messages: string[] = [];

      for (const plan of dirtyModulePlans) {
        const moduleId = plan.timetableModuleId;
        const saveResult = await saveDailyTimetableModule({
          academicYear,
          term,
          plan,
          drafts,
          pendingAdds: pendingAddsByModule[moduleId] ?? [],
          pendingDeletes: Array.from(getPendingDeletes(moduleId)),
          changedBy,
        });

        await onRefreshPlan(moduleId);
        messages.push(`${plan.moduleInstanceCode}: ${saveResult.message}`);
      }

      onMessage(messages.join("\n"));
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSavingModuleId(null);
    }
  }

  function handleDiscardModuleChanges(plan: DailyTimetableModulePlan) {
    resetModuleEditorState(plan.timetableModuleId, plan);
    setSelectedSessionIds(new Set());
    onMessage(t.dailyModuleChangesDiscarded);
  }

  function handleApplyMakeupDraft(
    cancelledEntry: DailyTimetableEntry,
    backupSessionId: string
  ) {
    const backupDraft = drafts[backupSessionId];
    if (!cancelledEntry.sessionId || !backupDraft) return;

    updateDraft(cancelledEntry.sessionId, { status: "cancel" });

    const remarkParts = [
      cancelledEntry.sessionLabel &&
      !cancelledEntry.sessionLabel.startsWith("Backup")
        ? `Make-up for ${cancelledEntry.sessionLabel}`
        : "Make-up session",
      backupDraft.remark,
    ].filter(Boolean);

    updateDraft(backupSessionId, {
      status: "make_up",
      remark: remarkParts.join(" — "),
    });

    onMessage(t.dailyMakeupDraftApplied);
  }

  function openAddSessionForm(plan: DailyTimetableModulePlan) {
    const defaults = buildDefaultNewSessionDraft({
      entries: plan.entries,
      drafts,
      pendingDeletes: getPendingDeletes(plan.timetableModuleId),
      fallbackRoomCode: classrooms[0]?.room_code ?? "",
    });

    setNewSession({
      session_date: defaults.session_date,
      start_time: defaults.start_time,
      end_time: defaults.end_time,
      room_code: defaults.room_code,
      teacher_name: defaults.teacherName,
      status: defaults.status,
      remark: defaults.remark,
    });
    setShowAddForm(true);
  }

  function handleQueueAddSession(plan: DailyTimetableModulePlan) {
    if (!newSession.session_date || !newSession.room_code) {
      onMessage(t.dailyAddSessionRequiredFields);
      return;
    }

    const pending: PendingDailySessionAdd = {
      clientId: crypto.randomUUID(),
      session_date: newSession.session_date,
      start_time: newSession.start_time,
      end_time: newSession.end_time,
      room_code: newSession.room_code,
      teacher_name: newSession.teacher_name,
      status: newSession.status,
      remark: newSession.remark,
    };

    setPendingAddsByModule((current) => ({
      ...current,
      [plan.timetableModuleId]: [
        ...(current[plan.timetableModuleId] ?? []),
        pending,
      ],
    }));

    setShowAddForm(false);
    onMessage(t.dailyAddSessionQueued);
  }

  function handleRemovePendingAdd(moduleId: string, clientId: string) {
    setPendingAddsByModule((current) => ({
      ...current,
      [moduleId]: (current[moduleId] ?? []).filter((row) => row.clientId !== clientId),
    }));
  }

  function toggleSessionSelection(sessionId: string, checked: boolean) {
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(sessionId);
      } else {
        next.delete(sessionId);
      }
      return next;
    });
  }

  function toggleGroupSelection(rows: DailyTimetableEntry[], checked: boolean) {
    setSelectedSessionIds((current) => {
      const next = new Set(current);

      for (const row of rows) {
        if (!row.sessionId || row.sessionId.startsWith("pending:")) continue;
        if (checked) {
          next.add(row.sessionId);
        } else {
          next.delete(row.sessionId);
        }
      }

      return next;
    });
  }

  function getSelectedDeletableItems(): Array<{
    sessionId: string;
    label: string;
    moduleId: string;
    sessionDate: string;
  }> {
    const items: Array<{
      sessionId: string;
      label: string;
      moduleId: string;
      sessionDate: string;
    }> = [];

    const sourceRows =
      viewMode === "date"
        ? dateEntries
        : selectedPlan
          ? [
              ...selectedPlanPartitions.scheduled,
              ...selectedPlanPartitions.backup,
              ...selectedPlanPartitions.cancelled,
            ]
          : [];

    for (const row of sourceRows) {
      if (!row.sessionId || row.sessionId.startsWith("pending:")) continue;
      if (!selectedSessionIds.has(row.sessionId)) continue;

      const pendingDeletes = getPendingDeletes(row.timetableModuleId);
      if (pendingDeletes.has(row.sessionId)) continue;

      const draftDate =
        drafts[row.sessionId]?.session_date ?? row.sessionDate;

      items.push({
        sessionId: row.sessionId,
        label: row.sessionLabel,
        moduleId: row.timetableModuleId,
        sessionDate: draftDate,
      });
    }

    return items;
  }

  function handleBulkDeleteSelected() {
    const items = getSelectedDeletableItems();
    if (items.length === 0) return;

    const list = items
      .map((item) => `• ${item.label} · ${item.sessionDate}`)
      .join("\n");

    const ok = window.confirm(
      t.deleteDailySessionsBulkConfirm
        .replace("{count}", String(items.length))
        .replace("{list}", list)
    );

    if (!ok) return;

    setPendingDeletesByModule((current) => {
      const next = { ...current };

      for (const item of items) {
        const bucket = new Set(next[item.moduleId] ?? []);
        bucket.add(item.sessionId);
        next[item.moduleId] = bucket;
      }

      return next;
    });

    setSelectedSessionIds(new Set());
    onMessage(
      t.dailyBulkDeleteQueued.replace("{count}", String(items.length))
    );
  }

  function handleQueueDeleteSession(moduleId: string, sessionId: string, label: string) {
    const ok = window.confirm(
      t.deleteDailySessionConfirm.replace("{label}", label)
    );

    if (!ok) return;

    setPendingDeletesByModule((current) => {
      const next = { ...current };
      const bucket = new Set(next[moduleId] ?? []);
      bucket.add(sessionId);
      next[moduleId] = bucket;
      return next;
    });

    setSelectedSessionIds((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Set(current);
      next.delete(sessionId);
      return next;
    });

    onMessage(t.dailyDeleteSessionQueued);
  }

  async function handleChangeSessionKind(
    sessionId: string,
    label: string,
    targetKind: "teaching" | "tutorial"
  ) {
    const confirmText =
      targetKind === "teaching"
        ? t.promoteSessionToLectureConfirm.replace("{label}", label)
        : t.demoteSessionToTutorialConfirm.replace("{label}", label);

    if (!window.confirm(confirmText)) {
      return;
    }

    setKindBusySessionId(sessionId);

    try {
      const result = await changeDailySessionKind({
        sessionId,
        targetKind,
        academicYear,
        term,
      });
      await onRefreshPlan(result.timetableModuleId);
      onMessage(t.dailySessionKindChanged);
    } catch (error) {
      onMessage(
        error instanceof Error
          ? error.message
          : t.dailySessionKindChangeFailed
      );
    } finally {
      setKindBusySessionId(null);
    }
  }

  async function handleClearLabelPlanLock(plan: DailyTimetableModulePlan) {
    if (!window.confirm(t.clearDailyLabelPlanLockConfirm)) {
      return;
    }

    setSavingModuleId(plan.timetableModuleId);

    try {
      await clearDailyLabelPlanLock({
        timetableModuleId: plan.timetableModuleId,
        academicYear,
        term,
      });
      await onRefreshPlan(plan.timetableModuleId);
      onMessage(t.dailyLabelPlanLockCleared);
    } catch (error) {
      onMessage(
        error instanceof Error
          ? error.message
          : t.dailyLabelPlanLockClearFailed
      );
    } finally {
      setSavingModuleId(null);
    }
  }

  const selectedDeletableCount = getSelectedDeletableItems().length;

  function renderSaveBar(plan: DailyTimetableModulePlan | null, allowSaveAll = false) {
    const dirty = plan
      ? moduleEditorIsDirty({
          plan,
          drafts,
          pendingAdds: pendingAddsByModule[plan.timetableModuleId] ?? [],
          pendingDeletes: getPendingDeletes(plan.timetableModuleId),
        })
      : false;

    const saving = savingModuleId !== null;

    return (
      <div className="card border-amber-200 bg-amber-50/40">
        <div className="card-body flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-amber-950">
            {allowSaveAll && dirtyModulePlans.length > 1
              ? t.dailyMultipleModulesUnsaved.replace(
                  "{count}",
                  String(dirtyModulePlans.length)
                )
              : dirty
                ? t.dailyModuleUnsavedChanges
                : t.dailyModuleNoChanges}
          </p>
          <div className="flex flex-wrap gap-2">
            {plan?.labelPlanLocked ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving}
                onClick={() => void handleClearLabelPlanLock(plan)}
              >
                {t.clearDailyLabelPlanLock}
              </button>
            ) : null}
            {selectedDeletableCount > 0 ? (
              <button
                type="button"
                className="btn btn-secondary text-red-700 border-red-200 hover:bg-red-50"
                disabled={saving}
                onClick={handleBulkDeleteSelected}
              >
                {t.deleteSelectedSessions.replace(
                  "{count}",
                  String(selectedDeletableCount)
                )}
              </button>
            ) : null}
            {plan ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving || !dirty}
                onClick={() => handleDiscardModuleChanges(plan)}
              >
                {t.discardDailyModuleChanges}
              </button>
            ) : null}
            {allowSaveAll && dirtyModulePlans.length > 0 ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={() => void handleSaveAllDirtyModules()}
              >
                {savingModuleId === "__all__" ? t.loading : t.saveAllDailyChanges}
              </button>
            ) : null}
            {plan ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || !dirty}
                onClick={() => void handleSaveModule(plan)}
              >
                {savingModuleId === plan.timetableModuleId
                  ? t.loading
                  : t.saveDailyModule}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (modulePlans.length === 0) {
    return <EmptyState message={t.selectModule} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`btn ${viewMode === "module" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setViewMode("module")}
        >
          {t.viewByModule}
        </button>
        <button
          type="button"
          className={`btn ${viewMode === "date" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setViewMode("date")}
        >
          {t.viewByDate}
        </button>
      </div>

      {viewMode === "module" ? (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="card">
            <div className="card-body space-y-3">
              <label className="form-label">{t.selectModule}</label>
              <select
                className="form-select"
                value={selectedModuleId}
                onChange={(event) => {
                  setSelectedModuleId(event.target.value);
                  setShowAddForm(false);
                }}
              >
                <option value="">—</option>
                {modulePlans.map((plan) => (
                  <option key={plan.timetableModuleId} value={plan.timetableModuleId}>
                    {plan.moduleInstanceCode} ({plan.programmeCode})
                  </option>
                ))}
              </select>

              {selectedPlan ? (
                <>
                  <ModulePlanSummary plan={selectedPlan} />
                  <button
                    type="button"
                    className="btn btn-secondary w-full text-sm"
                    onClick={() => openAddSessionForm(selectedPlan)}
                  >
                    <Plus className="mr-1 inline h-4 w-4" />
                    {t.addSession}
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            {selectedPlan ? (
              <>
                {renderSaveBar(selectedPlan)}
                {showAddForm ? (
                  <AddSessionCard
                    newSession={newSession}
                    teachers={teachers}
                    classrooms={classrooms}
                    onChange={setNewSession}
                    onCancel={() => setShowAddForm(false)}
                    onAdd={() => handleQueueAddSession(selectedPlan)}
                  />
                ) : null}
                <EditableDailyModuleSessions
                  scheduled={selectedPlanPartitions.scheduled}
                  backup={selectedPlanPartitions.backup}
                  cancelled={selectedPlanPartitions.cancelled}
                  pendingAdds={selectedPendingAdds}
                  drafts={drafts}
                  teachers={teachers}
                  moduleDefaultTeacher={selectedModuleDefaultTeacher}
                  classrooms={classrooms}
                  selectedSessionIds={selectedSessionIds}
                  onToggleSessionSelection={toggleSessionSelection}
                  onToggleGroupSelection={toggleGroupSelection}
                  onDraftChange={updateDraft}
                  onApplyMakeupDraft={handleApplyMakeupDraft}
                  onDeleteSession={(sessionId, label) =>
                    handleQueueDeleteSession(
                      selectedPlan.timetableModuleId,
                      sessionId,
                      label
                    )
                  }
                  onChangeSessionKind={handleChangeSessionKind}
                  kindBusySessionId={kindBusySessionId}
                  onRemovePendingAdd={(clientId) =>
                    handleRemovePendingAdd(selectedPlan.timetableModuleId, clientId)
                  }
                />
              </>
            ) : (
              <EmptyState message={t.selectModule} />
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <div className="card">
            <div className="card-body space-y-3">
              <label className="form-label flex items-center gap-1">
                <CalendarDays className="h-4 w-4" />
                {t.selectDate}
              </label>
              <select
                className="form-select"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
              >
                <option value="">—</option>
                {availableDates.map((iso) => (
                  <option key={iso} value={iso}>
                    {iso}
                  </option>
                ))}
              </select>

              <label className="form-label">{t.selectModule}</label>
              <select
                className="form-select"
                value={selectedModuleId}
                onChange={(event) => setSelectedModuleId(event.target.value)}
              >
                <option value="">—</option>
                {modulePlans.map((plan) => (
                  <option key={plan.timetableModuleId} value={plan.timetableModuleId}>
                    {plan.moduleInstanceCode}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            {renderSaveBar(
              modulePlans.find((plan) => plan.timetableModuleId === selectedModuleId) ??
                modulePlans[0] ??
                null,
              true
            )}
            {selectedDate && dateEntries.length > 0 ? (
              <EditableDailyTable
                rows={dateEntries}
                drafts={drafts}
                teachers={teachers}
                moduleDefaultTeachersById={moduleDefaultTeachersById}
                classrooms={classrooms}
                showModule
                selectedSessionIds={selectedSessionIds}
                onToggleSessionSelection={toggleSessionSelection}
                onToggleGroupSelection={toggleGroupSelection}
                onDraftChange={updateDraft}
                onDeleteSession={(sessionId, label, moduleId) =>
                  handleQueueDeleteSession(moduleId, sessionId, label)
                }
                onChangeSessionKind={handleChangeSessionKind}
                kindBusySessionId={kindBusySessionId}
              />
            ) : (
              <EmptyState message={t.selectDate} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ModulePlanSummary({ plan }: { plan: DailyTimetableModulePlan }) {
  const { t } = useLanguage();

  return (
    <div className="space-y-1 text-xs text-slate-600">
      <p className="font-medium text-slate-800">{plan.moduleInstanceCode}</p>
      <p>
        {displayStream(plan.streamCode)} · {plan.weekdayLabel} ·{" "}
        {plan.isHd ? "HD" : "Degree"}
      </p>
      {plan.labelPlanLocked ? (
        <p className="font-medium text-violet-700">{t.dailyLabelPlanLockedBadge}</p>
      ) : null}
      {plan.extraWeeklySlotCount > 0 ? (
        <p className="text-amber-700">
          {plan.extraWeeklySlotCount} backup slot(s)
        </p>
      ) : null}
      <p className="font-mono text-[11px] leading-snug">
        {plan.entries
          .filter((row) => !row.isBackup && row.status !== "cancel")
          .sort((a, b) => (a.sessionNumber ?? 0) - (b.sessionNumber ?? 0))
          .map((row) => row.sessionLabel)
          .join(" → ")}
      </p>
    </div>
  );
}

function AddSessionCard({
  newSession,
  teachers,
  classrooms,
  onChange,
  onCancel,
  onAdd,
}: {
  newSession: DailySessionDraftInput;
  teachers: TeacherRow[];
  classrooms: TimetableClassroomRow[];
  onChange: (value: DailySessionDraftInput) => void;
  onCancel: () => void;
  onAdd: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="card border-blue-200">
      <div className="card-body space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{t.addSession}</h3>
            <p className="text-xs text-slate-500">{t.dailyAddSessionDefaultsHint}</p>
          </div>
          <button type="button" className="btn btn-secondary text-sm" onClick={onCancel}>
            {t.cancel}
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-7">
          <div>
            <label className="form-label">{t.selectDate}</label>
            <input
              type="date"
              className="form-input"
              value={newSession.session_date}
              onChange={(event) =>
                onChange({ ...newSession, session_date: event.target.value })
              }
            />
          </div>
          <div>
            <label className="form-label">Start</label>
            <input
              type="time"
              className="form-input"
              value={newSession.start_time}
              onChange={(event) =>
                onChange({ ...newSession, start_time: event.target.value })
              }
            />
          </div>
          <div>
            <label className="form-label">End</label>
            <input
              type="time"
              className="form-input"
              value={newSession.end_time}
              onChange={(event) =>
                onChange({ ...newSession, end_time: event.target.value })
              }
            />
          </div>
          <div>
            <label className="form-label">Room</label>
            <select
              className="form-select"
              value={newSession.room_code}
              onChange={(event) =>
                onChange({ ...newSession, room_code: event.target.value })
              }
            >
              <option value="">—</option>
              {classrooms.map((room) => (
                <option key={room.room_code} value={room.room_code}>
                  {room.room_code}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">{t.teacherName}</label>
            <InstanceTeacherSelect
              value={newSession.teacher_name}
              teachers={teachers}
              onChange={(teacherName) =>
                onChange({ ...newSession, teacher_name: teacherName })
              }
            />
          </div>
          <div>
            <label className="form-label">{t.sessionStatus}</label>
            <select
              className="form-select"
              value={newSession.status}
              onChange={(event) =>
                onChange({
                  ...newSession,
                  status: event.target.value as TimetableSessionStatus,
                })
              }
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status, t)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button type="button" className="btn btn-primary w-full" onClick={onAdd}>
              {t.dailyQueueAddSession}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditableDailyModuleSessions({
  scheduled,
  backup,
  cancelled,
  pendingAdds,
  drafts,
  teachers,
  moduleDefaultTeacher,
  classrooms,
  showModule = false,
  selectedSessionIds,
  onToggleSessionSelection,
  onToggleGroupSelection,
  onDraftChange,
  onApplyMakeupDraft,
  onDeleteSession,
  onChangeSessionKind,
  kindBusySessionId = null,
  onRemovePendingAdd,
}: {
  scheduled: DailyTimetableEntry[];
  backup: DailyTimetableEntry[];
  cancelled: DailyTimetableEntry[];
  pendingAdds: PendingDailySessionAdd[];
  drafts: Record<string, DailySessionDraftInput>;
  teachers: TeacherRow[];
  moduleDefaultTeacher: string | null;
  classrooms: TimetableClassroomRow[];
  showModule?: boolean;
  selectedSessionIds: Set<string>;
  onToggleSessionSelection: (sessionId: string, checked: boolean) => void;
  onToggleGroupSelection: (rows: DailyTimetableEntry[], checked: boolean) => void;
  onDraftChange: (sessionId: string, patch: Partial<DailySessionDraftInput>) => void;
  onApplyMakeupDraft: (
    cancelled: DailyTimetableEntry,
    backupSessionId: string
  ) => void;
  onDeleteSession: (sessionId: string, label: string) => void;
  onChangeSessionKind?: (
    sessionId: string,
    label: string,
    targetKind: "teaching" | "tutorial"
  ) => void;
  kindBusySessionId?: string | null;
  onRemovePendingAdd: (clientId: string) => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      {pendingAdds.length > 0 ? (
        <SessionGroupTable
          title={t.dailyPendingSessions}
          description={t.dailyPendingSessionsHint}
          rows={pendingAdds.map((pending) => ({
            key: pending.clientId,
            label: t.dailyPendingSessionLabel,
            draft: pending,
            onRemove: () => onRemovePendingAdd(pending.clientId),
          }))}
          mode="pending"
          teachers={teachers}
          classrooms={classrooms}
          showModule={showModule}
        />
      ) : null}

      <SessionGroupTable
        title={t.dailyScheduledSessions}
        rows={scheduled}
        drafts={drafts}
        teachers={teachers}
        moduleDefaultTeacher={moduleDefaultTeacher}
        classrooms={classrooms}
        showModule={showModule}
        backupOptions={backup}
        selectedSessionIds={selectedSessionIds}
        onToggleSessionSelection={onToggleSessionSelection}
        onToggleGroupSelection={onToggleGroupSelection}
        onDraftChange={onDraftChange}
        onApplyMakeupDraft={onApplyMakeupDraft}
        onDeleteSession={onDeleteSession}
        onChangeSessionKind={onChangeSessionKind}
        kindBusySessionId={kindBusySessionId}
      />
      {backup.length > 0 ? (
        <SessionGroupTable
          title={t.dailyBackupSessions}
          description={t.dailyBackupSessionsHint}
          rows={backup}
          drafts={drafts}
          teachers={teachers}
          moduleDefaultTeacher={moduleDefaultTeacher}
          classrooms={classrooms}
          showModule={showModule}
          highlightBackup
          selectedSessionIds={selectedSessionIds}
          onToggleSessionSelection={onToggleSessionSelection}
          onToggleGroupSelection={onToggleGroupSelection}
          onDraftChange={onDraftChange}
          onDeleteSession={onDeleteSession}
          onChangeSessionKind={onChangeSessionKind}
          kindBusySessionId={kindBusySessionId}
        />
      ) : null}
      {cancelled.length > 0 ? (
        <SessionGroupTable
          title={t.dailyCancelledSessions}
          description={t.dailyCancelledSessionsHint}
          rows={cancelled}
          drafts={drafts}
          teachers={teachers}
          moduleDefaultTeacher={moduleDefaultTeacher}
          classrooms={classrooms}
          showModule={showModule}
          backupOptions={backup}
          selectedSessionIds={selectedSessionIds}
          onToggleSessionSelection={onToggleSessionSelection}
          onToggleGroupSelection={onToggleGroupSelection}
          onDraftChange={onDraftChange}
          onApplyMakeupDraft={onApplyMakeupDraft}
          onDeleteSession={onDeleteSession}
          onChangeSessionKind={onChangeSessionKind}
          kindBusySessionId={kindBusySessionId}
        />
      ) : null}
    </div>
  );
}

type PendingRow = {
  key: string;
  label: string;
  draft: PendingDailySessionAdd;
  onRemove: () => void;
};

function SessionGroupTable({
  title,
  description,
  rows,
  drafts,
  teachers,
  moduleDefaultTeacher = null,
  moduleDefaultTeachersById,
  classrooms,
  showModule = false,
  highlightBackup = false,
  backupOptions = [],
  mode = "existing",
  selectedSessionIds,
  onToggleSessionSelection,
  onToggleGroupSelection,
  onDraftChange,
  onApplyMakeupDraft,
  onDeleteSession,
  onChangeSessionKind,
  kindBusySessionId = null,
}: {
  title: string;
  description?: string;
  rows: DailyTimetableEntry[] | PendingRow[];
  drafts?: Record<string, DailySessionDraftInput>;
  teachers: TeacherRow[];
  moduleDefaultTeacher?: string | null;
  moduleDefaultTeachersById?: Map<string, string | null>;
  classrooms: TimetableClassroomRow[];
  showModule?: boolean;
  highlightBackup?: boolean;
  backupOptions?: DailyTimetableEntry[];
  mode?: "existing" | "pending";
  selectedSessionIds?: Set<string>;
  onToggleSessionSelection?: (sessionId: string, checked: boolean) => void;
  onToggleGroupSelection?: (rows: DailyTimetableEntry[], checked: boolean) => void;
  onDraftChange?: (sessionId: string, patch: Partial<DailySessionDraftInput>) => void;
  onApplyMakeupDraft?: (
    cancelled: DailyTimetableEntry,
    backupSessionId: string
  ) => void;
  onDeleteSession?: (sessionId: string, label: string) => void;
  onChangeSessionKind?: (
    sessionId: string,
    label: string,
    targetKind: "teaching" | "tutorial"
  ) => void;
  kindBusySessionId?: string | null;
}) {
  const { t } = useLanguage();

  if (rows.length === 0) return null;

  const existingRows =
    mode === "existing" ? (rows as DailyTimetableEntry[]) : [];
  const selectableRows = existingRows.filter(
    (row) => row.sessionId && !row.sessionId.startsWith("pending:")
  );
  const selectedInGroup = selectableRows.filter((row) =>
    selectedSessionIds?.has(row.sessionId!)
  ).length;
  const allGroupSelected =
    selectableRows.length > 0 && selectedInGroup === selectableRows.length;
  const someGroupSelected =
    selectedInGroup > 0 && selectedInGroup < selectableRows.length;

  return (
    <div className="card overflow-hidden">
      <div className="border-b bg-slate-50 px-3 py-2">
        <p className="text-sm font-medium text-slate-800">{title}</p>
        {description ? (
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1180px] w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {showModule ? (
                <>
                  <th className="px-3 py-2 text-left">{t.moduleCode}</th>
                  <th className="px-3 py-2 text-left">{t.programmeCode}</th>
                </>
              ) : null}
              {mode === "existing" ? (
                <th className="w-10 px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={allGroupSelected}
                    ref={(element) => {
                      if (element) {
                        element.indeterminate = someGroupSelected;
                      }
                    }}
                    aria-label={t.selectAllSessionsInGroup}
                    title={t.selectAllSessionsInGroup}
                    onChange={(event) =>
                      onToggleGroupSelection?.(selectableRows, event.target.checked)
                    }
                  />
                </th>
              ) : (
                <th className="w-10 px-2 py-2" />
              )}
              <th className="px-3 py-2 text-left">Session</th>
              <th className="px-3 py-2 text-left">{t.selectDate}</th>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Room</th>
              <th className="px-3 py-2 text-left">{t.teacherName}</th>
              <th className="px-3 py-2 text-left">{t.sessionStatus}</th>
              <th className="px-3 py-2 text-left">{t.remark}</th>
              <th className="px-3 py-2 text-left">{t.actions}</th>
            </tr>
          </thead>
          <tbody>
            {mode === "pending"
              ? (rows as PendingRow[]).map((row) => (
                  <PendingSessionRow
                    key={row.key}
                    row={row}
                    teachers={teachers}
                    classrooms={classrooms}
                  />
                ))
              : (rows as DailyTimetableEntry[]).map((row) => {
                  const rowModuleDefaultTeacher =
                    moduleDefaultTeachersById?.get(row.timetableModuleId) ??
                    moduleDefaultTeacher ??
                    null;

                  return (
                  <SessionEditRow
                    key={row.sessionId ?? `${row.moduleInstanceCode}-${row.sessionLabel}`}
                    row={row}
                    draft={
                      row.sessionId && drafts
                        ? (drafts[row.sessionId] ??
                            buildDraftFromEntry(row, rowModuleDefaultTeacher))
                        : buildDraftFromEntry(row, rowModuleDefaultTeacher)
                    }
                    teachers={teachers}
                    showModule={showModule}
                    highlightBackup={highlightBackup}
                    backupOptions={backupOptions}
                    classrooms={classrooms}
                    selected={Boolean(
                      row.sessionId && selectedSessionIds?.has(row.sessionId)
                    )}
                    onToggleSelected={
                      row.sessionId && onToggleSessionSelection
                        ? (checked) =>
                            onToggleSessionSelection(row.sessionId!, checked)
                        : undefined
                    }
                    onDraftChange={onDraftChange!}
                    onApplyMakeupDraft={onApplyMakeupDraft}
                    onDeleteSession={onDeleteSession}
                    onChangeSessionKind={onChangeSessionKind}
                    kindBusy={Boolean(
                      row.sessionId && kindBusySessionId === row.sessionId
                    )}
                  />
                  );
                })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PendingSessionRow({
  row,
  teachers,
  classrooms,
}: {
  row: PendingRow;
  teachers: TeacherRow[];
  classrooms: TimetableClassroomRow[];
}) {
  const { t } = useLanguage();

  return (
    <tr className="border-t bg-blue-50/50">
      <td className="px-2 py-2" />
      <td className="px-3 py-2 font-semibold">{row.label}</td>
      <td className="px-3 py-2">{row.draft.session_date}</td>
      <td className="px-3 py-2">
        {row.draft.start_time}–{row.draft.end_time}
      </td>
      <td className="px-3 py-2">{row.draft.room_code}</td>
      <td className="px-3 py-2">
        <InstanceTeacherSelect
          value={row.draft.teacher_name}
          teachers={teachers}
          disabled
          onChange={() => {}}
        />
      </td>
      <td className="px-3 py-2">{statusLabel(row.draft.status, t)}</td>
      <td className="px-3 py-2">{row.draft.remark || "—"}</td>
      <td className="px-3 py-2">
        <button
          type="button"
          className="btn btn-secondary py-1 text-xs"
          onClick={row.onRemove}
        >
          {t.removePendingSession}
        </button>
      </td>
    </tr>
  );
}

function SessionEditRow({
  row,
  draft,
  teachers,
  showModule,
  highlightBackup,
  backupOptions,
  classrooms,
  selected = false,
  onToggleSelected,
  onDraftChange,
  onApplyMakeupDraft,
  onDeleteSession,
  onChangeSessionKind,
  kindBusy = false,
}: {
  row: DailyTimetableEntry;
  draft: DailySessionDraftInput;
  teachers: TeacherRow[];
  showModule?: boolean;
  highlightBackup?: boolean;
  backupOptions?: DailyTimetableEntry[];
  classrooms: TimetableClassroomRow[];
  selected?: boolean;
  onToggleSelected?: (checked: boolean) => void;
  onDraftChange: (sessionId: string, patch: Partial<DailySessionDraftInput>) => void;
  onApplyMakeupDraft?: (
    cancelled: DailyTimetableEntry,
    backupSessionId: string
  ) => void;
  onDeleteSession?: (sessionId: string, label: string) => void;
  onChangeSessionKind?: (
    sessionId: string,
    label: string,
    targetKind: "teaching" | "tutorial"
  ) => void;
  kindBusy?: boolean;
}) {
  const { t } = useLanguage();
  const [selectedBackupId, setSelectedBackupId] = useState("");
  const isPending = row.sessionId?.startsWith("pending:") ?? false;

  if (!row.sessionId) {
    return (
      <tr className="border-t">
        <td
          colSpan={showModule ? 11 : 9}
          className="px-3 py-2 text-slate-500"
        >
          {row.sessionLabel} — not linked to a saved session
        </td>
      </tr>
    );
  }

  const sessionId = row.sessionId;

  const rowClass = selected
    ? "border-t bg-sky-50/80 ring-1 ring-inset ring-sky-200"
    : highlightBackup || row.isBackup
      ? "border-t bg-amber-50/60"
      : draft.status === "cancel" || row.status === "cancel"
        ? "border-t bg-red-50/50"
        : draft.status === "make_up" || row.status === "make_up"
          ? "border-t bg-emerald-50/40"
          : isPending
            ? "border-t bg-blue-50/50"
            : "border-t";

  const backupChoices = backupOptions ?? [];
  const canApplyMakeup =
    draft.status === "cancel" &&
    !row.isBackup &&
    backupChoices.length > 0 &&
    onApplyMakeupDraft;

  const isTutorial = isTutorialTimetableSession({
    session_kind: row.sessionKind,
    session_label: row.sessionLabel,
  });
  const canChangeKind =
    !isPending &&
    !row.isBackup &&
    draft.status !== "cancel" &&
    row.status !== "cancel" &&
    onChangeSessionKind;

  return (
    <tr className={rowClass}>
      {showModule ? (
        <>
          <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
            {row.moduleInstanceCode}
          </td>
          <td className="whitespace-nowrap px-3 py-2">{row.programmeCode}</td>
        </>
      ) : null}
      <td className="px-2 py-2 text-center">
        {!isPending && onToggleSelected ? (
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={selected}
            aria-label={`${t.selectSession} ${row.sessionLabel}`}
            title={`${t.selectSession} ${row.sessionLabel}`}
            onChange={(event) => onToggleSelected(event.target.checked)}
          />
        ) : (
          <span className="inline-block w-4" />
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-semibold">
        {row.sessionLabel}
        {row.isBackup ? (
          <span className="ml-1 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
            Backup
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <input
          type="date"
          className="form-input min-w-32"
          value={draft.session_date}
          onChange={(event) =>
            onDraftChange(sessionId, { session_date: event.target.value })
          }
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <input
            type="time"
            className="form-input w-24"
            value={draft.start_time}
            onChange={(event) =>
              onDraftChange(sessionId, { start_time: event.target.value })
            }
          />
          <input
            type="time"
            className="form-input w-24"
            value={draft.end_time}
            onChange={(event) =>
              onDraftChange(sessionId, { end_time: event.target.value })
            }
          />
        </div>
      </td>
      <td className="px-3 py-2">
        <select
          className="form-select min-w-24"
          value={draft.room_code}
          onChange={(event) =>
            onDraftChange(sessionId, { room_code: event.target.value })
          }
        >
          {classrooms.map((room) => (
            <option key={room.room_code} value={room.room_code}>
              {room.room_code}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <InstanceTeacherSelect
          value={draft.teacher_name}
          teachers={teachers}
          onChange={(teacherName) =>
            onDraftChange(sessionId, { teacher_name: teacherName })
          }
        />
      </td>
      <td className="px-3 py-2">
        <select
          className="form-select min-w-28"
          value={draft.status}
          onChange={(event) =>
            onDraftChange(sessionId, {
              status: event.target.value as TimetableSessionStatus,
            })
          }
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status, t)}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <div className="flex min-w-[200px] flex-col gap-1">
          <input
            type="text"
            className="form-input w-full"
            placeholder={t.remarkPlaceholder}
            value={draft.remark}
            onChange={(event) =>
              onDraftChange(sessionId, { remark: event.target.value })
            }
          />
          {canApplyMakeup ? (
            <div className="flex flex-wrap items-center gap-1">
              <select
                className="form-select min-w-0 flex-1 text-xs"
                value={selectedBackupId}
                onChange={(event) => setSelectedBackupId(event.target.value)}
              >
                <option value="">{t.selectBackupSession}</option>
                {backupChoices.map((backup) => (
                  <option key={backup.sessionId!} value={backup.sessionId!}>
                    {backup.sessionDate} {backup.startTime.slice(0, 5)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary py-1 text-xs whitespace-nowrap"
                disabled={!selectedBackupId}
                onClick={() => onApplyMakeupDraft!(row, selectedBackupId)}
              >
                {t.applyMakeupDraft}
              </button>
            </div>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1">
          {canChangeKind ? (
            <button
              type="button"
              className="btn btn-secondary py-1 text-xs whitespace-nowrap"
              disabled={kindBusy}
              onClick={() =>
                onChangeSessionKind!(
                  sessionId,
                  row.sessionLabel,
                  isTutorial ? "teaching" : "tutorial"
                )
              }
            >
              {isTutorial
                ? t.promoteSessionToLecture
                : t.demoteSessionToTutorial}
            </button>
          ) : null}
          {!isPending && onDeleteSession ? (
            <button
              type="button"
              className="btn btn-secondary inline-flex items-center gap-1 py-1 text-xs text-red-700"
              disabled={kindBusy}
              onClick={() => onDeleteSession(sessionId, row.sessionLabel)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t.deleteSession}
            </button>
          ) : !canChangeKind ? (
            <span className="text-xs text-slate-400">—</span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function EditableDailyTable({
  rows,
  drafts,
  teachers,
  moduleDefaultTeachersById,
  classrooms,
  showModule = false,
  selectedSessionIds,
  onToggleSessionSelection,
  onToggleGroupSelection,
  onDraftChange,
  onDeleteSession,
  onChangeSessionKind,
  kindBusySessionId = null,
}: {
  rows: DailyTimetableEntry[];
  drafts: Record<string, DailySessionDraftInput>;
  teachers: TeacherRow[];
  moduleDefaultTeachersById: Map<string, string | null>;
  classrooms: TimetableClassroomRow[];
  showModule?: boolean;
  selectedSessionIds: Set<string>;
  onToggleSessionSelection: (sessionId: string, checked: boolean) => void;
  onToggleGroupSelection: (rows: DailyTimetableEntry[], checked: boolean) => void;
  onDraftChange: (sessionId: string, patch: Partial<DailySessionDraftInput>) => void;
  onDeleteSession: (sessionId: string, label: string, moduleId: string) => void;
  onChangeSessionKind?: (
    sessionId: string,
    label: string,
    targetKind: "teaching" | "tutorial"
  ) => void;
  kindBusySessionId?: string | null;
}) {
  const { scheduled, backup, cancelled } = partitionDailyModuleEntries(rows, drafts);

  return (
    <div className="space-y-4">
      <SessionGroupTable
        title="Sessions on this date"
        rows={[...scheduled, ...cancelled]}
        drafts={drafts}
        teachers={teachers}
        moduleDefaultTeachersById={moduleDefaultTeachersById}
        classrooms={classrooms}
        showModule={showModule}
        backupOptions={backup}
        selectedSessionIds={selectedSessionIds}
        onToggleSessionSelection={onToggleSessionSelection}
        onToggleGroupSelection={onToggleGroupSelection}
        onDraftChange={onDraftChange}
        onDeleteSession={(sessionId, label) => {
          const row = rows.find((entry) => entry.sessionId === sessionId);
          if (!row) return;
          onDeleteSession(sessionId, label, row.timetableModuleId);
        }}
        onChangeSessionKind={onChangeSessionKind}
        kindBusySessionId={kindBusySessionId}
      />
      {backup.length > 0 ? (
        <SessionGroupTable
          title="Backup sessions on this date"
          rows={backup}
          drafts={drafts}
          teachers={teachers}
          moduleDefaultTeachersById={moduleDefaultTeachersById}
          classrooms={classrooms}
          showModule={showModule}
          highlightBackup
          selectedSessionIds={selectedSessionIds}
          onToggleSessionSelection={onToggleSessionSelection}
          onToggleGroupSelection={onToggleGroupSelection}
          onDraftChange={onDraftChange}
          onDeleteSession={(sessionId, label) => {
            const row = rows.find((entry) => entry.sessionId === sessionId);
            if (!row) return;
            onDeleteSession(sessionId, label, row.timetableModuleId);
          }}
          onChangeSessionKind={onChangeSessionKind}
          kindBusySessionId={kindBusySessionId}
        />
      ) : null}
    </div>
  );
}
