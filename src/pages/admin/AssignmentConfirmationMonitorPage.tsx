import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Users,
} from "lucide-react";

import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  AssignmentMonitorModule,
  AssignmentMonitorResult,
  getAssignmentConfirmationMonitor,
  getProgrammePipelineProgress,
  type PipelineStageStatus,
  type ProgrammePipelineProgress,
} from "../../services/adminAssignmentMonitorService";
import {
  hasCompletedTeacherLoadingRun,
  updateTeacherLoading,
} from "../../services/loadingService";

function getTeacherText(module: AssignmentMonitorModule): string {
  if (!module.assigned_teacher_names.length) {
    return "TBC";
  }

  return module.assigned_teacher_names.join(", ");
}

function StageBadge({ status }: { status: PipelineStageStatus }) {
  if (status === "complete") {
    return (
      <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        完成
      </span>
    );
  }

  if (status === "in_progress") {
    return (
      <span className="inline-flex rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
        進行中
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      待開始
    </span>
  );
}

function StatusBadge({ confirmed }: { confirmed: boolean }) {
  if (confirmed) {
    return (
      <span className="inline-flex rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
        Confirmed
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-800">
      Pending
    </span>
  );
}

function TeacherBadge({ hasTbcTeacher }: { hasTbcTeacher: boolean }) {
  if (hasTbcTeacher) {
    return (
      <span className="inline-flex rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
        TBC / Empty
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
      Assigned
    </span>
  );
}

function ProgrammeProgressTable({
  rows,
}: {
  rows: ProgrammePipelineProgress[];
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-white px-5 py-8 text-sm text-slate-500">
        No programme planning data for this academic year.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="p-3 text-left">Programme</th>
            <th className="p-3 text-left">Stream</th>
            <th className="p-3 text-left">Planning Modules</th>
            <th className="p-3 text-left">學生人數</th>
            <th className="p-3 text-left">合班</th>
            <th className="p-3 text-left">分班</th>
            <th className="p-3 text-left">分配確認</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.programmeCode}|${row.streamCode}`} className="border-t">
              <td className="p-3 font-medium">{row.programmeCode}</td>
              <td className="p-3">{row.streamCode}</td>
              <td className="p-3">{row.planningModuleCount}</td>
              <td className="p-3">
                <div className="flex items-center gap-2">
                  <StageBadge status={row.studentNumbersStatus} />
                  <span className="text-xs text-slate-500">
                    {row.studentNumbersReadyCount}/{row.planningModuleCount}
                  </span>
                </div>
              </td>
              <td className="p-3">
                <StageBadge status={row.combineStatus} />
              </td>
              <td className="p-3">
                <div className="flex items-center gap-2">
                  <StageBadge status={row.splitStatus} />
                  <span className="text-xs text-slate-500">
                    {row.splitReadyCount}/{row.planningModuleCount}
                  </span>
                </div>
              </td>
              <td className="p-3">
                <div className="flex items-center gap-2">
                  <StageBadge status={row.assignmentStatus} />
                  <span className="text-xs text-slate-500">
                    {row.confirmedAssignmentCount}/{row.timetableModuleCount}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModuleTable({
  title,
  modules,
  emptyText,
}: {
  title: string;
  modules: AssignmentMonitorModule[];
  emptyText: string;
}) {
  return (
    <div className="rounded-lg border bg-white">
      <div className="border-b px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      </div>

      {modules.length === 0 ? (
        <div className="px-5 py-8 text-sm text-slate-500">{emptyText}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  Module
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  Term
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  Programme
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  Stream
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  Teacher
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  Teacher Check
                </th>
              </tr>
            </thead>
            <tbody>
              {modules.map((module) => (
                <tr key={module.timetable_module_id} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">
                      {module.module_code ?? "-"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {module.module_name ?? "-"}
                    </div>
                  </td>
                  <td className="px-4 py-3">{module.module_term ?? "-"}</td>
                  <td className="px-4 py-3">{module.programme_code ?? "-"}</td>
                  <td className="px-4 py-3">{module.stream_code ?? "-"}</td>
                  <td className="px-4 py-3">{getTeacherText(module)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge confirmed={module.assignment_confirmed} />
                  </td>
                  <td className="px-4 py-3">
                    <TeacherBadge hasTbcTeacher={module.has_tbc_teacher} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AssignmentConfirmationMonitorPage() {
  const { user } = useAuth();
  const { academicYear } = useAcademicYear();
  const { t } = useLanguage();

  const [monitor, setMonitor] = useState<AssignmentMonitorResult | null>(null);
  const [programmeProgress, setProgrammeProgress] = useState<
    ProgrammePipelineProgress[]
  >([]);
  const [hasLoadingRun, setHasLoadingRun] = useState(false);

  const [loading, setLoading] = useState(false);
  const [updatingLoading, setUpdatingLoading] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const canUpdateTeacherLoading = useMemo(() => {
    return Boolean(monitor?.summary.canUpdateTeacherLoading);
  }, [monitor]);

  async function loadMonitor() {
    try {
      setLoading(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      const monitorResult = await getAssignmentConfirmationMonitor(academicYear);
      setMonitor(monitorResult);

      const [pipelineRows, runExists] = await Promise.all([
        getProgrammePipelineProgress(academicYear).catch((pipelineError) => {
          console.error(
            "[AssignmentConfirmationMonitorPage] Pipeline progress failed:",
            pipelineError
          );

          setErrorMessage(
            pipelineError instanceof Error
              ? `Pipeline progress unavailable: ${pipelineError.message}`
              : "Pipeline progress unavailable."
          );

          return [] as ProgrammePipelineProgress[];
        }),
        hasCompletedTeacherLoadingRun(academicYear).catch((runError) => {
          console.error(
            "[AssignmentConfirmationMonitorPage] Teacher loading run check failed:",
            runError
          );

          return false;
        }),
      ]);

      setProgrammeProgress(pipelineRows);
      setHasLoadingRun(runExists);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load monitor.";

      setErrorMessage(message);
      setMonitor(null);
      setProgrammeProgress([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateTeacherLoading() {
    if (!user) return;

    try {
      setUpdatingLoading(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      const result = await updateTeacherLoading({
        academicYear,
        updatedBy: user.id,
        sourceConfirmedVersion: 1,
      });

      setSuccessMessage(
        `Teacher loading updated successfully. ${result.insertedCount} aggregate row(s) generated.`
      );

      await loadMonitor();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update teacher loading.";

      setErrorMessage(message);
    } finally {
      setUpdatingLoading(false);
    }
  }

  useEffect(() => {
    void loadMonitor();
  }, [academicYear]);

  return (
    <div className="page-container space-y-6">
      <PageHeader
        title="教學分配進度"
        description="Review programme pipeline progress and assignment confirmation status before generating teacher loading."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadMonitor}
              disabled={loading || updatingLoading}
              className="btn btn-secondary"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {t.reset}
            </button>

            <button
              type="button"
              onClick={handleUpdateTeacherLoading}
              disabled={!canUpdateTeacherLoading || updatingLoading || loading}
              className="btn btn-primary"
            >
              {updatingLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Users className="h-4 w-4" />
              )}
              Update Teacher Loading
            </button>
          </div>
        }
      />

      <div className="rounded-lg border bg-slate-50 px-4 py-3 text-sm">
        {t.academicYear}: <span className="font-medium">{academicYear}</span>
      </div>

      {errorMessage && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>{errorMessage}</div>
        </div>
      )}

      {successMessage && (
        <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-700">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <div>{successMessage}</div>
        </div>
      )}

      {loading && !monitor ? (
        <LoadingState />
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900">
              Programme Progress
            </h2>
            <ProgrammeProgressTable rows={programmeProgress} />
          </section>

          {monitor && (
            <>
              <section className="grid gap-4 md:grid-cols-5">
                <div className="rounded-lg border bg-white px-5 py-4">
                  <div className="text-sm text-slate-500">Total Modules</div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {monitor.summary.totalModules}
                  </div>
                </div>

                <div className="rounded-lg border bg-white px-5 py-4">
                  <div className="text-sm text-slate-500">Confirmed</div>
                  <div className="mt-2 text-2xl font-bold text-green-600">
                    {monitor.summary.confirmedModules}
                  </div>
                </div>

                <div className="rounded-lg border bg-white px-5 py-4">
                  <div className="text-sm text-slate-500">Pending</div>
                  <div className="mt-2 text-2xl font-bold text-yellow-600">
                    {monitor.summary.pendingModules}
                  </div>
                </div>

                <div className="rounded-lg border bg-white px-5 py-4">
                  <div className="text-sm text-slate-500">TBC / Empty Teacher</div>
                  <div className="mt-2 text-2xl font-bold text-red-600">
                    {monitor.summary.modulesWithTbcTeacher}
                  </div>
                </div>

                <div className="rounded-lg border bg-white px-5 py-4">
                  <div className="text-sm text-slate-500">Teacher Loading</div>
                  <div
                    className={`mt-2 text-sm font-semibold ${
                      hasLoadingRun ? "text-green-600" : "text-slate-500"
                    }`}
                  >
                    {hasLoadingRun ? "Generated" : "Not generated"}
                  </div>
                </div>
              </section>

              {!monitor.summary.canUpdateTeacherLoading && (
                <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-5 py-4 text-sm text-yellow-800">
                  Teacher loading can only be updated when all modules are
                  confirmed and no confirmed assignment has TBC / empty teacher.
                </div>
              )}

              <ModuleTable
                title="Pending Modules"
                modules={monitor.pendingModules}
                emptyText="No pending modules."
              />

              <ModuleTable
                title="Confirmed Modules"
                modules={monitor.confirmedModules}
                emptyText="No confirmed modules found."
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
