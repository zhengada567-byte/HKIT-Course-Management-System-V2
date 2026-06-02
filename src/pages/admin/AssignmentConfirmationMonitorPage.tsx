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
import { confirmReadyAssignments } from "../../services/assignmentService";
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

function StatusBadge({ splitComplete }: { splitComplete: boolean }) {
  if (splitComplete) {
    return (
      <span className="inline-flex rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
        已完成分班
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-800">
      待分班
    </span>
  );
}

function TeacherBadge({ hasTbcTeacher }: { hasTbcTeacher: boolean }) {
  if (hasTbcTeacher) {
    return (
      <span className="inline-flex rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
        TBC / 未指定
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
      已指定
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
        此學年尚無課程規劃資料。
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="p-3 text-left">Programme</th>
            <th className="p-3 text-left">Planning Modules</th>
            <th className="p-3 text-left">1. 學生人數</th>
            <th className="p-3 text-left">2. 合班</th>
            <th className="p-3 text-left">3. 分班</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.programmeCode} className="border-t">
              <td className="p-3 font-medium">{row.programmeCode}</td>
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
                <div className="flex items-center gap-2">
                  <StageBadge status={row.combineStatus} />
                  <span className="text-xs text-slate-500">
                    {row.combineReadyCount}/{row.planningModuleCount}
                  </span>
                </div>
              </td>
              <td className="p-3">
                <div className="flex items-center gap-2">
                  <StageBadge status={row.splitStatus} />
                  <span className="text-xs text-slate-500">
                    {row.splitReadyCount}/{row.planningModuleCount}
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
                  教師
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  分班狀態
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  教師狀態
                </th>
              </tr>
            </thead>
            <tbody>
              {modules.map((module) => (
                <tr
                  key={
                    module.timetable_module_id ??
                    module.planning_module_id ??
                    `${module.programme_code}|${module.module_code}`
                  }
                  className="border-t"
                >
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
                    <StatusBadge splitComplete={module.split_complete} />
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

      if (user) {
        await confirmReadyAssignments({
          academicYear,
          confirmedBy: user.id,
        }).catch((confirmError) => {
          console.warn(
            "[AssignmentConfirmationMonitorPage] Auto-confirm ready assignments skipped:",
            confirmError
          );
        });
      }

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
        description="按課程檢視 Make Timetable 三步流程（同步學生人數、合班、分班）。Programme Leader 完成 Confirm All Split 即代表該課程完成；下方「已分配教師模組」列出已完成分班的 timetable 實例。"
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
              課程進度
            </h2>
            <ProgrammeProgressTable rows={programmeProgress} />
          </section>

          {monitor && (
            <>
              <section className="grid gap-4 md:grid-cols-5">
                <div className="rounded-lg border bg-white px-5 py-4">
                  <div className="text-sm text-slate-500">Planning Modules</div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {monitor.summary.totalPlanningModules}
                  </div>
                </div>

                <div className="rounded-lg border bg-white px-5 py-4">
                  <div className="text-sm text-slate-500">已完成分班</div>
                  <div className="mt-2 text-2xl font-bold text-green-600">
                    {monitor.summary.splitCompleteModules}
                  </div>
                </div>

                <div className="rounded-lg border bg-white px-5 py-4">
                  <div className="text-sm text-slate-500">待分班</div>
                  <div className="mt-2 text-2xl font-bold text-yellow-600">
                    {monitor.summary.pendingSplitModules}
                  </div>
                </div>

                <div className="rounded-lg border bg-white px-5 py-4">
                  <div className="text-sm text-slate-500">TBC 模組</div>
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
                  生成 Teacher Loading 須全部 planning 模組已完成分班，且已分班模組均有非 TBC 教師。
                </div>
              )}

              <ModuleTable
                title="待分班模組"
                modules={monitor.pendingSplitModules}
                emptyText="沒有待分班模組。"
              />

              <ModuleTable
                title="已分配教師模組（已完成分班）"
                modules={monitor.splitCompleteModules}
                emptyText="沒有已完成分班的模組。"
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
