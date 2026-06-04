import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Download, Loader2, RefreshCw } from "lucide-react";

import { DataTable } from "../../components/tables/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { buildDayClassStartTimeOptions } from "../../lib/timetableStartTimeOptions";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { downloadWeeklyDailyTimetableExcel } from "../../services/dailyTimetableExportService";
import { WeeklyTimetableEditor } from "../programme-leader/make-timetable/components/WeeklyTimetableEditor";
import {
  buildDailyTimetable,
  persistDailyTimetableLabels,
  type DailyTimetableBuildResult,
  type DailyTimetableEntry,
  type DailyTimetableModulePlan,
} from "../../services/dailyTimetableService";
import {
  listTimetableModuleInstances,
  type TimetableModuleInstanceRow,
} from "../../services/timetableModuleInstanceService";
import {
  listTimetableClassrooms,
  pruneTimetableSessionsOutsideStudyWeeks,
  type TimetableClassroomRow,
  type TimetableScheduleTerm,
} from "../../services/timetableScheduleService";

type ViewMode = "module" | "date";

const termOptions: TimetableScheduleTerm[] = ["Sep", "Feb"];

export function DailyTimetablePage() {
  const { academicYear } = useAcademicYear();
  const { user } = useAuth();
  const { t } = useLanguage();

  const [term, setTerm] = useState<TimetableScheduleTerm>("Sep");
  const [instances, setInstances] = useState<TimetableModuleInstanceRow[]>([]);
  const [classrooms, setClassrooms] = useState<TimetableClassroomRow[]>([]);
  const [contextLoading, setContextLoading] = useState(true);
  const [weeklyOpen, setWeeklyOpen] = useState(true);
  const [weeklyRefreshToken, setWeeklyRefreshToken] = useState(0);

  const [viewMode, setViewMode] = useState<ViewMode>("module");
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [dailyLoading, setDailyLoading] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [result, setResult] = useState<DailyTimetableBuildResult | null>(null);
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);

  const startTimeOptions = useMemo(() => buildDayClassStartTimeOptions(), []);

  const instancesForTerm = useMemo(
    () => instances.filter((row) => row.module_term === term),
    [instances, term]
  );

  const editableInstanceCodes = useMemo(
    () =>
      instancesForTerm
        .map((row) => String(row.module_instance_code ?? "").trim())
        .filter(Boolean),
    [instancesForTerm]
  );

  async function loadWeeklyContext() {
    setContextLoading(true);

    try {
      const [instanceRows, roomRows] = await Promise.all([
        listTimetableModuleInstances({ academicYear }),
        listTimetableClassrooms(),
      ]);

      setInstances(instanceRows);
      setClassrooms(roomRows);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to load timetable data."
      );
    } finally {
      setContextLoading(false);
    }
  }

  useEffect(() => {
    void loadWeeklyContext();
  }, [academicYear]);

  useEffect(() => {
    setResult(null);
    setSelectedModuleId("");
    setSelectedDate("");
  }, [term]);

  const filteredModules = useMemo(() => result?.modules ?? [], [result]);

  const availableDates = useMemo(() => {
    if (!result) return [];

    return Array.from(result.entriesByDate.keys()).sort();
  }, [result]);

  const selectedPlan = useMemo(() => {
    if (!result || !selectedModuleId) return null;

    return (
      filteredModules.find((row) => row.timetableModuleId === selectedModuleId) ??
      null
    );
  }, [filteredModules, result, selectedModuleId]);

  const dateEntries = useMemo(() => {
    if (!result || !selectedDate) return [];

    return result.entriesByDate.get(selectedDate) ?? [];
  }, [result, selectedDate]);

  async function handlePruneOutsideStudyWeeks() {
    const ok = window.confirm(
      `Delete timetable sessions on revision/exam/marking weeks for ${academicYear} ${term} term?\n\nStudy weeks are capped at 14 per term.`
    );

    if (!ok) return;

    setPruning(true);
    setMessage("");

    try {
      const { deletedCount, studyWeekCount } =
        await pruneTimetableSessionsOutsideStudyWeeks({
          academicYear,
          term,
        });

      setWeeklyRefreshToken((value) => value + 1);
      setMessage(
        deletedCount === 0
          ? `No non-study-week sessions to remove (${studyWeekCount} study weeks in calendar).`
          : `Removed ${deletedCount} session(s) outside study weeks.`
      );

      if (result) {
        await handleBuildDaily();
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to remove sessions."
      );
    } finally {
      setPruning(false);
    }
  }

  async function handleBuildDaily() {
    setDailyLoading(true);
    setMessage("");

    try {
      const built = await buildDailyTimetable({
        academicYear,
        term,
      });

      const persisted = await persistDailyTimetableLabels(built);

      setResult(built);
      setSelectedModuleId(built.modules[0]?.timetableModuleId ?? "");
      setSelectedDate(Array.from(built.entriesByDate.keys()).sort()[0] ?? "");

      setMessage(
        built.modules.length === 0
          ? "No modules with weekly sessions for this term. Adjust the weekly timetable above first."
          : `Generated and saved daily labels for ${persisted.moduleCount} module(s) (${persisted.updatedCount} session row(s) updated).`
      );
    } catch (error) {
      setResult(null);
      setMessage(
        error instanceof Error ? error.message : "Failed to generate daily timetable."
      );
    } finally {
      setDailyLoading(false);
    }
  }

  function handleWeeklySaved() {
    setWeeklyRefreshToken((value) => value + 1);
    setMessage("Weekly timetable saved. You can generate the daily timetable below.");
    setResult(null);
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

  return (
    <div className="page-container">
      <PageHeader
        title={t.weeklyDailyTimetable}
        description={t.weeklyDailyTimetableDescription}
        actions={
          <button
            type="button"
            className="btn btn-primary inline-flex items-center gap-2"
            disabled={exporting || contextLoading}
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
        </div>
      </div>

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      <section className="card mb-6">
        <div className="card-body space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {t.weeklyTimetableStep}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {t.weeklyTimetableStepHint}
            </p>
          </div>

          {contextLoading ? (
            <LoadingState />
          ) : (
            <WeeklyTimetableEditor
              variant="embedded"
              academicYear={academicYear}
              term={term}
              timetableInstances={instancesForTerm}
              classrooms={classrooms}
              preferredStartByCode={{}}
              startTimeOptions={startTimeOptions}
              open={weeklyOpen}
              onOpenChange={setWeeklyOpen}
              refreshToken={weeklyRefreshToken}
              forceViewScopeAll
              instancePanelTitle={`${t.allProgrammes} · ${term}`}
              instancePanelDescription={t.weeklyTimetableAdminInstanceHint}
              onAfterSave={handleWeeklySaved}
            />
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-body space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {t.dailyTimetableStep}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {t.dailyTimetableStepHint}
            </p>
          </div>

          <p className="text-xs text-slate-500">{t.exportWeeklyDailyTimetableHint}</p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary inline-flex items-center gap-2"
              disabled={exporting || contextLoading}
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
              disabled={dailyLoading || pruning || contextLoading}
              onClick={() => void handleBuildDaily()}
            >
              {dailyLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {dailyLoading ? t.loading : t.buildDailyTimetable}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              disabled={dailyLoading || pruning || contextLoading}
              onClick={() => void handlePruneOutsideStudyWeeks()}
            >
              {pruning ? t.loading : t.removeNonStudyWeekSessions}
            </button>
          </div>

          {result && (
            <div className="space-y-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <span className="font-medium">{result.term}</span> term:{" "}
                {result.termStartDate} → {result.termEndDate}
                {" · "}
                {result.modules.length} module(s) with daily L/T labels
                {" · "}
                {editableInstanceCodes.length} instance(s) in {term}
              </div>
            </div>
          )}

          {result && result.warnings.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <div className="font-semibold">Warnings</div>
              <ul className="mt-1 list-disc pl-4">
                {result.warnings.slice(0, 20).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              {result.warnings.length > 20 && (
                <p className="mt-1">…and {result.warnings.length - 20} more.</p>
              )}
            </div>
          )}

          {result && result.modules.length > 0 && (
            <>
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
                    <div className="card-body space-y-2">
                      <label className="form-label">{t.selectModule}</label>
                      <select
                        className="form-select"
                        value={selectedModuleId}
                        onChange={(event) =>
                          setSelectedModuleId(event.target.value)
                        }
                      >
                        <option value="">—</option>
                        {filteredModules.map((plan) => (
                          <option
                            key={plan.timetableModuleId}
                            value={plan.timetableModuleId}
                          >
                            {plan.moduleInstanceCode} ({plan.programmeCode})
                          </option>
                        ))}
                      </select>

                      {selectedPlan && <ModulePlanSummary plan={selectedPlan} />}
                    </div>
                  </div>

                  <div>
                    {selectedPlan ? (
                      <DailyEntriesTable rows={selectedPlan.entries} />
                    ) : (
                      <EmptyState message={t.selectModule} />
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
                  <div className="card">
                    <div className="card-body space-y-2">
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

                  <div>
                    {selectedDate && dateEntries.length > 0 ? (
                      <DailyEntriesTable rows={dateEntries} showModule />
                    ) : (
                      <EmptyState message={t.selectDate} />
                    )}
                  </div>
                </div>
              )}

              <div className="card">
                <div className="card-body">
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">
                    All modules summary
                  </h3>
                  <DataTable
                    rows={filteredModules}
                    rowKey={(row) => row.timetableModuleId}
                    columns={[
                      {
                        key: "code",
                        header: t.moduleCode,
                        render: (row) => row.moduleInstanceCode,
                      },
                      {
                        key: "programme",
                        header: t.programmeCode,
                        render: (row) => row.programmeCode,
                      },
                      {
                        key: "weekday",
                        header: "Weekday",
                        render: (row) => row.weekdayLabel,
                      },
                      {
                        key: "type",
                        header: "Type",
                        render: (row) => (row.isHd ? "HD" : "Degree"),
                      },
                      {
                        key: "weekly",
                        header: "Weekly / L-T",
                        render: (row) => (
                          <span>
                            {row.weeklySlotCount} / {row.labelledSessionCount}
                            {row.outsideStudyWeekSlotCount > 0 && (
                              <span className="text-red-700">
                                {" "}
                                (+{row.outsideStudyWeekSlotCount} non-study)
                              </span>
                            )}
                          </span>
                        ),
                      },
                      {
                        key: "pattern",
                        header: "Labels",
                        render: (row) =>
                          row.labelSequence.map((slot) => slot.label).join(", "),
                      },
                    ]}
                  />
                </div>
              </div>
            </>
          )}

          {result && result.modules.length === 0 && <EmptyState />}
        </div>
      </section>
    </div>
  );
}

function ModulePlanSummary({ plan }: { plan: DailyTimetableModulePlan }) {
  return (
    <div className="space-y-1 text-xs text-slate-600">
      <p>
        <span className="font-medium text-slate-800">{plan.moduleCode}</span>
        {plan.moduleName ? ` · ${plan.moduleName}` : ""}
      </p>
      <p>
        {plan.programmeCode} / {plan.streamCode || "nil"} · {plan.weekdayLabel}
      </p>
      <p>
        Study-week slots {plan.weeklySlotCount} · L/T labels{" "}
        {plan.labelledSessionCount}
      </p>
      <p className="font-mono text-[11px] leading-snug">
        {plan.labelSequence.map((slot) => slot.label).join(" → ")}
      </p>
    </div>
  );
}

function DailyEntriesTable({
  rows,
  showModule = false,
}: {
  rows: DailyTimetableEntry[];
  showModule?: boolean;
}) {
  const { t } = useLanguage();

  return (
    <div className="card">
      <div className="card-body">
        <DataTable
          rows={rows}
          rowKey={(row) =>
            `${row.timetableModuleId}|${row.sessionLabel}|${row.sessionDate}`
          }
          columns={[
            ...(showModule
              ? [
                  {
                    key: "module",
                    header: t.moduleCode,
                    render: (row: DailyTimetableEntry) => (
                      <span className="font-mono text-sm">
                        {row.moduleInstanceCode}
                      </span>
                    ),
                  },
                  {
                    key: "programme",
                    header: t.programmeCode,
                    render: (row: DailyTimetableEntry) => row.programmeCode,
                  },
                ]
              : []),
            {
              key: "label",
              header: "Session",
              render: (row) => (
                <span className="font-semibold text-slate-900">
                  {row.sessionLabel}
                </span>
              ),
            },
            {
              key: "kind",
              header: "Type",
              render: (row) =>
                row.sessionKind === "teaching" ? "Lecture" : "Tutorial",
            },
            {
              key: "date",
              header: t.selectDate,
              render: (row) => row.sessionDate,
            },
            {
              key: "time",
              header: "Time",
              render: (row) =>
                `${row.startTime.slice(0, 5)} – ${row.endTime.slice(0, 5)}`,
            },
            {
              key: "room",
              header: "Room",
              render: (row) => row.roomCode || "—",
            },
          ]}
        />
      </div>
    </div>
  );
}
