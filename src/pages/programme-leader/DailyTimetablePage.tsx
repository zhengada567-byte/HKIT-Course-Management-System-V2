import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Download, Loader2, Plus, RefreshCw } from "lucide-react";

import { DataTable } from "../../components/tables/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { downloadWeeklyDailyTimetableExcel } from "../../services/dailyTimetableExportService";
import {
  createDailyTimetableSession,
  loadProgrammeDailyTimetable,
  partitionDailyModuleEntries,
  type DailyTimetableBuildResult,
  type DailyTimetableEntry,
  type DailyTimetableModulePlan,
} from "../../services/dailyTimetableService";
import {
  moduleHasDraftChanges,
  saveDailyTimetableModule,
} from "../../services/dailyTimetableModuleSaveService";
import { listProgrammes } from "../../services/programmeService";
import {
  listTimetableClassrooms,
  type TimetableClassroomRow,
  type TimetableScheduleTerm,
} from "../../services/timetableScheduleService";
import {
  formatProgrammeCodeOptionLabel,
  isMixedProgrammeCode,
  MIXED_PROGRAMME_CODE,
  MIXED_STREAM_CODE,
} from "../../lib/timetableProgramme";
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
  const [savingModule, setSavingModule] = useState(false);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
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

  const programmeCodeOptions = useMemo(
    () => [...programmeCodes, MIXED_PROGRAMME_CODE],
    [programmeCodes]
  );

  const streamOptions = useMemo(() => {
    if (!programmeCode) return [];

    if (isMixedProgrammeCode(programmeCode)) {
      return [MIXED_STREAM_CODE];
    }

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

  const moduleDirty = useMemo(() => {
    if (!selectedPlan) return false;
    return moduleHasDraftChanges(selectedPlan, drafts);
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
        knownProgrammeCodes: programmeCodes,
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
      knownProgrammeCodes: programmeCodes,
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

  function handleDiscardModuleChanges() {
    if (!selectedPlan) {
      setMessage("Select a module first.");
      return;
    }

    if (!moduleDirty) {
      setMessage(t.dailyModuleNoChanges);
      return;
    }

    setDrafts((current) => {
      const next = { ...current };

      for (const entry of selectedPlan.entries) {
        if (!entry.sessionId) continue;
        next[entry.sessionId] = buildDraftFromEntry(entry);
      }

      return next;
    });
    setMessage(t.dailyModuleChangesDiscarded);
  }

  async function handleSaveModule() {
    if (!selectedPlan || !result) {
      setMessage("Select a module first.");
      return;
    }

    if (!moduleDirty) {
      setMessage("No unsaved changes for this module.");
      return;
    }

    setSavingModule(true);
    setMessage("");

    try {
      const saveResult = await saveDailyTimetableModule({
        academicYear,
        term,
        plan: selectedPlan,
        drafts,
        changedBy: user?.username ?? null,
      });

      await reload();
      setMessage(saveResult.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSavingModule(false);
    }
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

    setMessage(
      "Make-up draft applied. Click Save module to store changes and send email."
    );
  }

  async function handleExportExcel() {
    if (!user) {
      setMessage("Please login before exporting.");
      return;
    }

    setExporting(true);
    setMessage("");

    try {
      await downloadWeeklyDailyTimetableExcel({
        academicYear,
        term,
        exportedByUserId: user.id,
        exportedByLabel: user.username,
      });
      setMessage("Weekly and daily timetable Excel downloaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExporting(false);
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
        actions={
          <button
            type="button"
            className="btn btn-primary inline-flex items-center gap-2"
            disabled={exporting}
            onClick={() => void handleExportExcel()}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {exporting ? t.loading : t.exportWeeklyDailyTimetableExcel}
          </button>
        }
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
              {programmeCodeOptions.map((code) => (
                <option key={code} value={code}>
                  {formatProgrammeCodeOptionLabel(code)}
                </option>
              ))}
            </select>
            {isMixedProgrammeCode(programmeCode) && (
              <p className="mt-1 text-xs text-slate-500">{t.mixedProgrammeHint}</p>
            )}
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
                  {isMixedProgrammeCode(stream)
                    ? formatProgrammeCodeOptionLabel(stream)
                    : displayStream(stream)}
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
            className="btn btn-secondary inline-flex items-center gap-2"
            disabled={exporting}
            onClick={() => void handleExportExcel()}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {exporting ? t.loading : t.exportWeeklyDailyTimetableExcel}
          </button>

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
                  <>
                    <div className="card">
                      <div className="card-body flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-slate-600">
                          {moduleDirty
                            ? t.dailyModuleUnsavedChanges
                            : t.dailyModuleNoChanges}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={savingModule || !moduleDirty}
                            onClick={handleDiscardModuleChanges}
                          >
                            {t.discardDailyModuleChanges}
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={savingModule || !moduleDirty}
                            onClick={() => void handleSaveModule()}
                          >
                            {savingModule ? t.loading : t.saveDailyModule}
                          </button>
                        </div>
                      </div>
                    </div>
                    <EditableDailyModuleSessions
                      scheduled={selectedPlanPartitions.scheduled}
                      backup={selectedPlanPartitions.backup}
                      cancelled={selectedPlanPartitions.cancelled}
                      drafts={drafts}
                      classrooms={classrooms}
                      onDraftChange={updateDraft}
                      onApplyMakeupDraft={handleApplyMakeupDraft}
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
                  <>
                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      {t.dailyDateViewSaveHint}
                    </div>
                    <EditableDailyTable
                      rows={dateEntries}
                      drafts={drafts}
                      classrooms={classrooms}
                      showModule
                      onDraftChange={updateDraft}
                    />
                  </>
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
          .sort((a, b) => {
            const na = a.sessionNumber ?? 0;
            const nb = b.sessionNumber ?? 0;
            return na - nb;
          })
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
  showModule = false,
  onDraftChange,
  onApplyMakeupDraft,
}: {
  scheduled: DailyTimetableEntry[];
  backup: DailyTimetableEntry[];
  cancelled: DailyTimetableEntry[];
  drafts: Record<string, SessionDraft>;
  classrooms: TimetableClassroomRow[];
  showModule?: boolean;
  onDraftChange: (sessionId: string, patch: Partial<SessionDraft>) => void;
  onApplyMakeupDraft: (
    cancelled: DailyTimetableEntry,
    backupSessionId: string
  ) => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      <SessionGroupTable
        title={t.dailyScheduledSessions}
        rows={scheduled}
        drafts={drafts}
        classrooms={classrooms}
        showModule={showModule}
        backupOptions={backup}
        onDraftChange={onDraftChange}
        onApplyMakeupDraft={onApplyMakeupDraft}
      />
      {backup.length > 0 && (
        <SessionGroupTable
          title={t.dailyBackupSessions}
          description={t.dailyBackupSessionsHint}
          rows={backup}
          drafts={drafts}
          classrooms={classrooms}
          showModule={showModule}
          highlightBackup
          onDraftChange={onDraftChange}
        />
      )}
      {cancelled.length > 0 && (
        <SessionGroupTable
          title={t.dailyCancelledSessions}
          description={t.dailyCancelledSessionsHint}
          rows={cancelled}
          drafts={drafts}
          classrooms={classrooms}
          showModule={showModule}
          backupOptions={backup}
          onDraftChange={onDraftChange}
          onApplyMakeupDraft={onApplyMakeupDraft}
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
  showModule = false,
  highlightBackup = false,
  backupOptions = [],
  onDraftChange,
  onApplyMakeupDraft,
}: {
  title: string;
  description?: string;
  rows: DailyTimetableEntry[];
  drafts: Record<string, SessionDraft>;
  classrooms: TimetableClassroomRow[];
  showModule?: boolean;
  highlightBackup?: boolean;
  backupOptions?: DailyTimetableEntry[];
  onDraftChange: (sessionId: string, patch: Partial<SessionDraft>) => void;
  onApplyMakeupDraft?: (
    cancelled: DailyTimetableEntry,
    backupSessionId: string
  ) => void;
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
        <p className="mt-1 text-xs text-slate-400">{t.scrollTableHorizontally}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full text-sm">
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
              <th className="min-w-[200px] whitespace-nowrap px-3 py-2 text-left">
                {t.remark}
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
                onDraftChange={onDraftChange}
                onApplyMakeupDraft={onApplyMakeupDraft}
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
  onDraftChange,
  onApplyMakeupDraft,
}: {
  row: DailyTimetableEntry;
  draft: SessionDraft | null;
  showModule?: boolean;
  highlightBackup?: boolean;
  backupOptions?: DailyTimetableEntry[];
  classrooms: TimetableClassroomRow[];
  onDraftChange: (sessionId: string, patch: Partial<SessionDraft>) => void;
  onApplyMakeupDraft?: (
    cancelled: DailyTimetableEntry,
    backupSessionId: string
  ) => void;
}) {
  const { t } = useLanguage();
  const [selectedBackupId, setSelectedBackupId] = useState("");

  if (!row.sessionId || !draft) {
    return (
      <tr className="border-t">
        <td
          colSpan={showModule ? 8 : 6}
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
    onApplyMakeupDraft;

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
    </tr>
  );
}

function EditableDailyTable({
  rows,
  drafts,
  classrooms,
  showModule = false,
  onDraftChange,
}: {
  rows: DailyTimetableEntry[];
  drafts: Record<string, SessionDraft>;
  classrooms: TimetableClassroomRow[];
  showModule?: boolean;
  onDraftChange: (sessionId: string, patch: Partial<SessionDraft>) => void;
}) {
  const { scheduled, backup, cancelled } = partitionDailyModuleEntries(rows, drafts);

  return (
    <EditableDailyModuleSessions
      scheduled={[...scheduled, ...cancelled]}
      backup={backup}
      cancelled={[]}
      drafts={drafts}
      classrooms={classrooms}
      showModule={showModule}
      onDraftChange={onDraftChange}
      onApplyMakeupDraft={() => undefined}
    />
  );
}
