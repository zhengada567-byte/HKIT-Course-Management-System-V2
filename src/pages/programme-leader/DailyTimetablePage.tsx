import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, Plus, RefreshCw } from "lucide-react";

import { DataTable } from "../../components/tables/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  applyDailyMakeupFromBackup,
  createDailyTimetableSession,
  loadProgrammeDailyTimetable,
  partitionDailyModuleEntries,
  updateDailyTimetableSession,
  type DailyTimetableBuildResult,
  type DailyTimetableEntry,
  type DailyTimetableModulePlan,
} from "../../services/dailyTimetableService";
import { listProgrammes } from "../../services/programmeService";
import {
  listTimetableClassrooms,
  type TimetableClassroomRow,
  type TimetableScheduleTerm,
} from "../../services/timetableScheduleService";
import { normalizeStream } from "../../lib/utils";
import type { ProgrammeRow } from "../../types";
import type { TimetableSessionStatus } from "../../lib/dailyTimetableSessionLabels";
import { displayStream } from "./make-timetable/helpers";

type ViewMode = "module" | "date";

const termOptions: TimetableScheduleTerm[] = ["Sep", "Feb"];
const statusOptions: TimetableSessionStatus[] = ["normal", "cancel", "make_up"];

export function DailyTimetablePage() {
  const { academicYear } = useAcademicYear();
  const { user } = useAuth();
  const { t } = useLanguage();

  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [programmeCode, setProgrammeCode] = useState("");
  const [streamCode, setStreamCode] = useState("");
  const [term, setTerm] = useState<TimetableScheduleTerm>("Sep");
  const [classrooms, setClassrooms] = useState<TimetableClassroomRow[]>([]);

  const [viewMode, setViewMode] = useState<ViewMode>("module");
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<DailyTimetableBuildResult | null>(null);
  const [message, setMessage] = useState("");

  const [showAddForm, setShowAddForm] = useState(false);
  const [newSession, setNewSession] = useState({
    session_date: "",
    start_time: "09:00",
    end_time: "13:00",
    room_code: "",
    status: "normal" as TimetableSessionStatus,
  });

  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        session_date: string;
        start_time: string;
        end_time: string;
        room_code: string;
        status: TimetableSessionStatus;
        remark: string;
      }
    >
  >({});

  useEffect(() => {
    void listProgrammes().then(setProgrammes);
    void listTimetableClassrooms().then(setClassrooms);
  }, []);

  const programmeCodes = useMemo(
    () =>
      [
        ...new Set(
          programmes.map((row) => String(row.programme_code ?? "").trim()).filter(Boolean)
        ),
      ].sort(),
    [programmes]
  );

  const streamOptions = useMemo(() => {
    if (!programmeCode) return [];

    const streams = programmes
      .filter((row) => row.programme_code === programmeCode)
      .map((row) => normalizeStream(row.programme_stream));

    return [...new Set(streams)].sort((a, b) => {
      if (a === "nil") return -1;
      if (b === "nil") return 1;
      return a.localeCompare(b);
    });
  }, [programmeCode, programmes]);

  const selectedPlan = useMemo(() => {
    if (!result || !selectedModuleId) return null;
    return result.modules.find((row) => row.timetableModuleId === selectedModuleId) ?? null;
  }, [result, selectedModuleId]);

  const selectedPlanPartitions = useMemo(() => {
    if (!selectedPlan) {
      return { scheduled: [], backup: [], cancelled: [] };
    }

    return partitionDailyModuleEntries(selectedPlan.entries, drafts);
  }, [selectedPlan, drafts]);

  const availableDates = useMemo(() => {
    if (!result) return [];
    return Array.from(result.entriesByDate.keys()).sort();
  }, [result]);

  const dateEntries = useMemo(() => {
    if (!result || !selectedDate) return [];
    return result.entriesByDate.get(selectedDate) ?? [];
  }, [result, selectedDate]);

  function initDraftsFromResult(data: DailyTimetableBuildResult) {
    const next: typeof drafts = {};

    for (const plan of data.modules) {
      for (const entry of plan.entries) {
        if (!entry.sessionId) continue;

        next[entry.sessionId] = {
          session_date: entry.sessionDate,
          start_time: entry.startTime.slice(0, 5),
          end_time: entry.endTime.slice(0, 5),
          room_code: entry.roomCode,
          status: entry.status,
          remark: entry.remark ?? "",
        };
      }
    }

    setDrafts(next);
  }

  async function handleLoad() {
    if (!programmeCode) {
      setMessage("Please select a programme code.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const data = await loadProgrammeDailyTimetable({
        academicYear,
        term,
        programmeCode,
        streamCode: streamCode || undefined,
      });

      setResult(data);
      initDraftsFromResult(data);
      setSelectedModuleId(data.modules[0]?.timetableModuleId ?? "");
      setSelectedDate(Array.from(data.entriesByDate.keys()).sort()[0] ?? "");

      setMessage(
        data.modules.length === 0
          ? "No daily timetable found. Ask admin to generate daily labels first."
          : `Loaded daily timetable for ${data.modules.length} module(s).`
      );
    } catch (error) {
      setResult(null);
      setMessage(error instanceof Error ? error.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }

  async function reload() {
    if (!programmeCode) return;

    const data = await loadProgrammeDailyTimetable({
      academicYear,
      term,
      programmeCode,
      streamCode: streamCode || undefined,
    });

    setResult(data);
    initDraftsFromResult(data);
  }

  function updateDraft(sessionId: string, patch: Partial<SessionDraft>) {
    setDrafts((current) => {
      let base = current[sessionId];

      if (!base && result) {
        for (const plan of result.modules) {
          const entry = plan.entries.find((row) => row.sessionId === sessionId);
          if (entry) {
            base = buildDraftFromEntry(entry);
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
            status: "normal" as TimetableSessionStatus,
            remark: "",
          }),
          ...patch,
        },
      };
    });
  }

  async function handleSaveEntry(entry: DailyTimetableEntry) {
    if (!entry.sessionId) return;

    const draft = drafts[entry.sessionId];
    if (!draft) return;

    setSavingId(entry.sessionId);
    setMessage("");

    try {
      const modulePlan = result?.modules.find(
        (plan) => plan.timetableModuleId === entry.timetableModuleId
      );

      const pendingCancels =
        modulePlan?.entries.filter(
          (row) =>
            row.sessionId &&
            row.sessionId !== entry.sessionId &&
            drafts[row.sessionId]?.status === "cancel" &&
            row.status !== "cancel"
        ) ?? [];

      for (const row of pendingCancels) {
        const cancelDraft = drafts[row.sessionId!];
        if (!cancelDraft) continue;

        await updateDailyTimetableSession({
          sessionId: row.sessionId!,
          session_date: cancelDraft.session_date,
          start_time: cancelDraft.start_time,
          end_time: cancelDraft.end_time,
          room_code: cancelDraft.room_code,
          status: "cancel",
          remark: cancelDraft.remark,
          relabel: false,
        });
      }

      await updateDailyTimetableSession({
        sessionId: entry.sessionId,
        session_date: draft.session_date,
        start_time: draft.start_time,
        end_time: draft.end_time,
        room_code: draft.room_code,
        status: draft.status,
        remark: draft.remark,
        relabel: true,
      });

      await reload();
      setMessage(
        pendingCancels.length > 0 && draft.status === "make_up"
          ? `Saved cancel + make-up. ${entry.sessionLabel} should now appear under scheduled sessions with the vacated L/T label.`
          : `Saved ${entry.sessionLabel} (${entry.moduleInstanceCode}). L/T labels re-ordered.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleApplyMakeup(
    cancelledEntry: DailyTimetableEntry,
    backupSessionId: string
  ) {
    const backupDraft = drafts[backupSessionId];
    if (!backupDraft) return;

    setSavingId(cancelledEntry.sessionId);
    setMessage("");

    try {
      await applyDailyMakeupFromBackup({
        cancelSessionId: cancelledEntry.sessionId!,
        backupSessionId,
        remark: backupDraft.remark || cancelledEntry.remark,
        session_date: backupDraft.session_date,
        start_time: backupDraft.start_time,
        end_time: backupDraft.end_time,
        room_code: backupDraft.room_code,
      });

      await reload();
      setMessage(
        `Make-up applied using backup slot for ${cancelledEntry.sessionLabel}. Labels re-ordered by date.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Make-up failed.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleAddSession() {
    if (!selectedPlan) {
      setMessage("Select a module first.");
      return;
    }

    if (!newSession.session_date || !newSession.room_code) {
      setMessage("Date and room are required for a new session.");
      return;
    }

    setAdding(true);
    setMessage("");

    try {
      await createDailyTimetableSession({
        academicYear,
        timetableModuleId: selectedPlan.timetableModuleId,
        session_date: newSession.session_date,
        start_time: newSession.start_time,
        end_time: newSession.end_time,
        room_code: newSession.room_code,
        status: newSession.status,
        createdBy: user?.id ?? null,
      });

      setShowAddForm(false);
      setNewSession({
        session_date: "",
        start_time: "09:00",
        end_time: "13:00",
        room_code: classrooms[0]?.room_code ?? "",
        status: "normal",
      });

      await reload();
      setMessage("New session added. L/T labels re-ordered by date.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to add session.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.plDailyTimetable}
        description={t.plDailyTimetableDescription}
      />

      <div className="card mb-4">
        <div className="card-body flex flex-wrap items-end gap-3">
          <div>
            <label className="form-label">{t.academicYear}</label>
            <input className="form-input bg-slate-50" value={academicYear} readOnly />
          </div>

          <div>
            <label className="form-label">{t.programmeCode}</label>
            <select
              className="form-select min-w-32"
              value={programmeCode}
              onChange={(event) => {
                setProgrammeCode(event.target.value);
                setStreamCode("");
              }}
            >
              <option value="">—</option>
              {programmeCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">{t.programmeStream}</label>
            <select
              className="form-select min-w-36"
              value={streamCode}
              onChange={(event) => setStreamCode(event.target.value)}
              disabled={!programmeCode}
            >
              <option value="">All</option>
              {streamOptions.map((stream) => (
                <option key={stream} value={stream}>
                  {displayStream(stream)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">{t.moduleTerm}</label>
            <select
              className="form-select"
              value={term}
              onChange={(event) =>
                setTerm(event.target.value as TimetableScheduleTerm)
              }
            >
              {termOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="btn btn-primary inline-flex items-center gap-2"
            disabled={loading || !programmeCode}
            onClick={() => void handleLoad()}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {loading ? t.loading : t.loadDailyTimetable}
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      {result && result.warnings.length > 0 && (
        <div className="mb-4 max-h-32 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <ul className="list-disc pl-4">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {loading && <LoadingState />}

      {!loading && result && result.modules.length > 0 && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
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
                    {result.modules.map((plan) => (
                      <option key={plan.timetableModuleId} value={plan.timetableModuleId}>
                        {plan.moduleInstanceCode}
                      </option>
                    ))}
                  </select>

                  {selectedPlan && (
                    <>
                      <ModulePlanSummary plan={selectedPlan} />
                      <button
                        type="button"
                        className="btn btn-secondary w-full text-sm"
                        onClick={() => {
                          setShowAddForm((value) => !value);
                          setNewSession((prev) => ({
                            ...prev,
                            room_code: prev.room_code || classrooms[0]?.room_code || "",
                          }));
                        }}
                      >
                        <Plus className="mr-1 inline h-4 w-4" />
                        {t.addSession}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="min-w-0 space-y-4">
                {showAddForm && selectedPlan && (
                  <div className="card">
                    <div className="card-body grid gap-3 md:grid-cols-5">
                      <div>
                        <label className="form-label">{t.selectDate}</label>
                        <input
                          type="date"
                          className="form-input"
                          value={newSession.session_date}
                          onChange={(event) =>
                            setNewSession((prev) => ({
                              ...prev,
                              session_date: event.target.value,
                            }))
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
                            setNewSession((prev) => ({
                              ...prev,
                              start_time: event.target.value,
                            }))
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
                            setNewSession((prev) => ({
                              ...prev,
                              end_time: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div>
                        <label className="form-label">Room</label>
                        <select
                          className="form-select"
                          value={newSession.room_code}
                          onChange={(event) =>
                            setNewSession((prev) => ({
                              ...prev,
                              room_code: event.target.value,
                            }))
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
                      <div className="flex items-end">
                        <button
                          type="button"
                          className="btn btn-primary w-full"
                          disabled={adding}
                          onClick={() => void handleAddSession()}
                        >
                          {adding ? t.loading : t.create}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {selectedPlan ? (
                  <EditableDailyModuleSessions
                    scheduled={selectedPlanPartitions.scheduled}
                    backup={selectedPlanPartitions.backup}
                    cancelled={selectedPlanPartitions.cancelled}
                    drafts={drafts}
                    classrooms={classrooms}
                    savingId={savingId}
                    onDraftChange={updateDraft}
                    onSave={(row) => void handleSaveEntry(row)}
                    onApplyMakeup={(cancelled, backupId) =>
                      void handleApplyMakeup(cancelled, backupId)
                    }
                  />
                ) : (
                  <EmptyState message={t.selectModule} />
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
              <div className="card">
                <div className="card-body">
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
                </div>
              </div>

              <div className="min-w-0">
                {selectedDate && dateEntries.length > 0 ? (
                  <EditableDailyTable
                    rows={dateEntries}
                    drafts={drafts}
                    classrooms={classrooms}
                    savingId={savingId}
                    showModule
                    onDraftChange={updateDraft}
                    onSave={(row) => void handleSaveEntry(row)}
                  />
                ) : (
                  <EmptyState message={t.selectDate} />
                )}
              </div>
            </div>
          )}
        </>
      )}

      {!loading && result && result.modules.length === 0 && <EmptyState />}
    </div>
  );
}

function ModulePlanSummary({ plan }: { plan: DailyTimetableModulePlan }) {
  return (
    <div className="space-y-1 text-xs text-slate-600">
      <p className="font-medium text-slate-800">{plan.moduleInstanceCode}</p>
      <p>
        {displayStream(plan.streamCode)} · {plan.weekdayLabel} ·{" "}
        {plan.isHd ? "HD" : "Degree"}
      </p>
      {plan.extraWeeklySlotCount > 0 ? (
        <p className="text-amber-700">
          {plan.extraWeeklySlotCount} backup slot(s)
        </p>
      ) : null}
      <p className="font-mono text-[11px] leading-snug">
        {plan.entries
          .filter((row) => !row.isBackup && row.status !== "cancel")
          .map((row) => row.sessionLabel)
          .join(" → ")}
      </p>
    </div>
  );
}

type SessionDraft = {
  session_date: string;
  start_time: string;
  end_time: string;
  room_code: string;
  status: TimetableSessionStatus;
  remark: string;
};

function buildDraftFromEntry(entry: DailyTimetableEntry): SessionDraft {
  return {
    session_date: entry.sessionDate,
    start_time: entry.startTime.slice(0, 5),
    end_time: entry.endTime.slice(0, 5),
    room_code: entry.roomCode,
    status: entry.status,
    remark: entry.remark ?? "",
  };
}

function EditableDailyModuleSessions({
  scheduled,
  backup,
  cancelled,
  drafts,
  classrooms,
  savingId,
  onDraftChange,
  onSave,
  onApplyMakeup,
}: {
  scheduled: DailyTimetableEntry[];
  backup: DailyTimetableEntry[];
  cancelled: DailyTimetableEntry[];
  drafts: Record<string, SessionDraft>;
  classrooms: TimetableClassroomRow[];
  savingId: string | null;
  onDraftChange: (sessionId: string, patch: Partial<SessionDraft>) => void;
  onSave: (row: DailyTimetableEntry) => void;
  onApplyMakeup: (cancelled: DailyTimetableEntry, backupSessionId: string) => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      <SessionGroupTable
        title={t.dailyScheduledSessions}
        rows={scheduled}
        drafts={drafts}
        classrooms={classrooms}
        savingId={savingId}
        backupOptions={backup}
        onDraftChange={onDraftChange}
        onSave={onSave}
        onApplyMakeup={onApplyMakeup}
      />
      {backup.length > 0 && (
        <SessionGroupTable
          title={t.dailyBackupSessions}
          description={t.dailyBackupSessionsHint}
          rows={backup}
          drafts={drafts}
          classrooms={classrooms}
          savingId={savingId}
          highlightBackup
          onDraftChange={onDraftChange}
          onSave={onSave}
        />
      )}
      {cancelled.length > 0 && (
        <SessionGroupTable
          title={t.dailyCancelledSessions}
          description={t.dailyCancelledSessionsHint}
          rows={cancelled}
          drafts={drafts}
          classrooms={classrooms}
          savingId={savingId}
          backupOptions={backup}
          onDraftChange={onDraftChange}
          onSave={onSave}
          onApplyMakeup={onApplyMakeup}
        />
      )}
    </div>
  );
}

function SessionGroupTable({
  title,
  description,
  rows,
  drafts,
  classrooms,
  savingId,
  showModule = false,
  highlightBackup = false,
  backupOptions = [],
  onDraftChange,
  onSave,
  onApplyMakeup,
}: {
  title: string;
  description?: string;
  rows: DailyTimetableEntry[];
  drafts: Record<string, SessionDraft>;
  classrooms: TimetableClassroomRow[];
  savingId: string | null;
  showModule?: boolean;
  highlightBackup?: boolean;
  backupOptions?: DailyTimetableEntry[];
  onDraftChange: (sessionId: string, patch: Partial<SessionDraft>) => void;
  onSave: (row: DailyTimetableEntry) => void;
  onApplyMakeup?: (cancelled: DailyTimetableEntry, backupSessionId: string) => void;
}) {
  const { t } = useLanguage();

  if (rows.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      <div className="border-b bg-slate-50 px-3 py-2">
        <p className="text-sm font-medium text-slate-800">{title}</p>
        {description ? (
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        ) : null}
        <p className="mt-1 text-xs text-slate-400">{t.scrollTableForRemarkSave}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1020px] w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {showModule && (
                <>
                  <th className="whitespace-nowrap px-3 py-2 text-left">
                    {t.moduleCode}
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-left">
                    {t.programmeCode}
                  </th>
                </>
              )}
              <th className="whitespace-nowrap px-3 py-2 text-left">Session</th>
              <th className="whitespace-nowrap px-3 py-2 text-left">
                {t.selectDate}
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-left">Time</th>
              <th className="whitespace-nowrap px-3 py-2 text-left">Room</th>
              <th className="whitespace-nowrap px-3 py-2 text-left">
                {t.sessionStatus}
              </th>
              <th className="min-w-[180px] whitespace-nowrap px-3 py-2 text-left">
                {t.remark}
              </th>
              <th className="min-w-[140px] whitespace-nowrap px-3 py-2 text-left">
                {t.action}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <SessionEditRow
                key={row.sessionId ?? `${row.moduleInstanceCode}-${row.sessionLabel}`}
                row={row}
                draft={
                  row.sessionId
                    ? (drafts[row.sessionId] ?? buildDraftFromEntry(row))
                    : null
                }
                showModule={showModule}
                highlightBackup={highlightBackup}
                backupOptions={backupOptions}
                classrooms={classrooms}
                savingId={savingId}
                onDraftChange={onDraftChange}
                onSave={onSave}
                onApplyMakeup={onApplyMakeup}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SessionEditRow({
  row,
  draft,
  showModule,
  highlightBackup,
  backupOptions,
  classrooms,
  savingId,
  onDraftChange,
  onSave,
  onApplyMakeup,
}: {
  row: DailyTimetableEntry;
  draft: SessionDraft | null;
  showModule?: boolean;
  highlightBackup?: boolean;
  backupOptions?: DailyTimetableEntry[];
  classrooms: TimetableClassroomRow[];
  savingId: string | null;
  onDraftChange: (sessionId: string, patch: Partial<SessionDraft>) => void;
  onSave: (row: DailyTimetableEntry) => void;
  onApplyMakeup?: (cancelled: DailyTimetableEntry, backupSessionId: string) => void;
}) {
  const { t } = useLanguage();
  const [selectedBackupId, setSelectedBackupId] = useState("");

  if (!row.sessionId || !draft) {
    return (
      <tr className="border-t">
        <td
          colSpan={showModule ? 9 : 7}
          className="px-3 py-2 text-slate-500"
        >
          {row.sessionLabel} — not linked to a saved session
        </td>
      </tr>
    );
  }

  const sessionId = row.sessionId;

  const rowClass = highlightBackup || row.isBackup
    ? "border-t bg-amber-50/60"
    : draft.status === "cancel" || row.status === "cancel"
      ? "border-t bg-red-50/50"
      : draft.status === "make_up" || row.status === "make_up"
        ? "border-t bg-emerald-50/40"
        : "border-t";

  const backupChoices = backupOptions ?? [];

  const canApplyMakeup =
    draft.status === "cancel" &&
    !row.isBackup &&
    backupChoices.length > 0 &&
    onApplyMakeup;

  return (
    <tr className={rowClass}>
      {showModule && (
        <>
          <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
            {row.moduleInstanceCode}
          </td>
          <td className="whitespace-nowrap px-3 py-2">{row.programmeCode}</td>
        </>
      )}
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
              {status}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          className="form-input min-w-40"
          placeholder={t.remarkPlaceholder}
          value={draft.remark}
          onChange={(event) =>
            onDraftChange(sessionId, { remark: event.target.value })
          }
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex min-w-[120px] flex-col gap-1">
          <button
            type="button"
            className="btn btn-primary py-1 text-xs"
            disabled={savingId === sessionId}
            onClick={() => onSave(row)}
          >
            {savingId === sessionId ? t.loading : t.save}
          </button>
          {canApplyMakeup ? (
            <>
              <select
                className="form-select text-xs"
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
                className="btn btn-secondary py-1 text-xs"
                disabled={!selectedBackupId || savingId === sessionId}
                onClick={() => onApplyMakeup!(row, selectedBackupId)}
              >
                {t.applyMakeupBackup}
              </button>
            </>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function EditableDailyTable({
  rows,
  drafts,
  classrooms,
  savingId,
  showModule = false,
  onDraftChange,
  onSave,
}: {
  rows: DailyTimetableEntry[];
  drafts: Record<string, SessionDraft>;
  classrooms: TimetableClassroomRow[];
  savingId: string | null;
  showModule?: boolean;
  onDraftChange: (sessionId: string, patch: Partial<SessionDraft>) => void;
  onSave: (row: DailyTimetableEntry) => void;
}) {
  const { scheduled, backup, cancelled } = partitionDailyModuleEntries(rows, drafts);

  return (
    <EditableDailyModuleSessions
      scheduled={[...scheduled, ...cancelled]}
      backup={backup}
      cancelled={[]}
      drafts={drafts}
      classrooms={classrooms}
      savingId={savingId}
      onDraftChange={onDraftChange}
      onSave={onSave}
      onApplyMakeup={() => undefined}
    />
  );
}
