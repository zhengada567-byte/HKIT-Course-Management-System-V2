// src/pages/admin/AssignmentConfirmationMonitorPage.tsx

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Users,
} from "lucide-react";

import {
  AssignmentMonitorModule,
  AssignmentMonitorResult,
  getAssignmentConfirmationMonitor,
} from "@/services/adminAssignmentMonitorService";

import {
  hasCompletedTeacherLoadingRun,
  updateTeacherLoading,
} from "@/services/loadingService";

import { supabase } from "@/integrations/supabase/client";

const DEFAULT_ACADEMIC_YEAR = "2025/26";

function getTeacherText(module: AssignmentMonitorModule): string {
  if (!module.assigned_teacher_names.length) {
    return "TBC";
  }

  return module.assigned_teacher_names.join(", ");
}

function StatusBadge({ confirmed }: { confirmed: boolean }) {
  if (confirmed) {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
        Confirmed
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-800">
      Pending
    </span>
  );
}

function TeacherBadge({ hasTbcTeacher }: { hasTbcTeacher: boolean }) {
  if (hasTbcTeacher) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
        TBC / Empty
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
      Assigned
    </span>
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
    <div className="rounded-xl border bg-white shadow-sm">
      <div className="border-b px-5 py-4">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      </div>

      {modules.length === 0 ? (
        <div className="px-5 py-8 text-sm text-gray-500">{emptyText}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  Module
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  Term
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  Programme
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  Stream
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  Teacher
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  Teacher Check
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100 bg-white">
              {modules.map((module) => (
                <tr key={module.timetable_module_id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">
                      {module.module_code ?? "-"}
                    </div>
                    <div className="text-xs text-gray-500">
                      {module.module_name ?? "-"}
                    </div>
                  </td>

                  <td className="px-4 py-3 text-gray-700">
                    {module.module_term ?? "-"}
                  </td>

                  <td className="px-4 py-3 text-gray-700">
                    {module.programme_code ?? "-"}
                  </td>

                  <td className="px-4 py-3 text-gray-700">
                    {module.stream_code ?? "-"}
                  </td>

                  <td className="px-4 py-3 text-gray-700">
                    {getTeacherText(module)}
                  </td>

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

export default function AssignmentConfirmationMonitorPage() {
  const [academicYear, setAcademicYear] = useState(DEFAULT_ACADEMIC_YEAR);
  const [monitor, setMonitor] = useState<AssignmentMonitorResult | null>(null);
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

      const [monitorResult, runExists] = await Promise.all([
        getAssignmentConfirmationMonitor(academicYear),
        hasCompletedTeacherLoadingRun(academicYear),
      ]);

      setMonitor(monitorResult);
      setHasLoadingRun(runExists);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load monitor.";
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateTeacherLoading() {
    try {
      setUpdatingLoading(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const result = await updateTeacherLoading({
        academicYear,
        updatedBy: user?.id ?? null,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col justify-between gap-4 rounded-xl border bg-white px-6 py-5 shadow-sm md:flex-row md:items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Assignment Confirmation Monitor
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Review assignment confirmation progress before generating teacher
              actual loading.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              value={academicYear}
              onChange={(event) => setAcademicYear(event.target.value)}
              className="h-10 rounded-lg border px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              placeholder="Academic Year"
            />

            <button
              type="button"
              onClick={loadMonitor}
              disabled={loading || updatingLoading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </button>

            <button
              type="button"
              onClick={handleUpdateTeacherLoading}
              disabled={!canUpdateTeacherLoading || updatingLoading || loading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {updatingLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Users className="h-4 w-4" />
              )}
              Update Teacher Loading
            </button>
          </div>
        </div>

        {errorMessage && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>{errorMessage}</div>
          </div>
        )}

        {successMessage && (
          <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-700">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <div>{successMessage}</div>
          </div>
        )}

        {monitor && (
          <>
            <section className="grid gap-4 md:grid-cols-5">
              <div className="rounded-xl border bg-white px-5 py-4 shadow-sm">
                <div className="text-sm text-gray-500">Total Modules</div>
                <div className="mt-2 text-2xl font-bold text-gray-900">
                  {monitor.summary.totalModules}
                </div>
              </div>

              <div className="rounded-xl border bg-white px-5 py-4 shadow-sm">
                <div className="text-sm text-gray-500">Confirmed</div>
                <div className="mt-2 text-2xl font-bold text-green-600">
                  {monitor.summary.confirmedModules}
                </div>
              </div>

              <div className="rounded-xl border bg-white px-5 py-4 shadow-sm">
                <div className="text-sm text-gray-500">Pending</div>
                <div className="mt-2 text-2xl font-bold text-yellow-600">
                  {monitor.summary.pendingModules}
                </div>
              </div>

              <div className="rounded-xl border bg-white px-5 py-4 shadow-sm">
                <div className="text-sm text-gray-500">TBC / Empty Teacher</div>
                <div className="mt-2 text-2xl font-bold text-red-600">
                  {monitor.summary.modulesWithTbcTeacher}
                </div>
              </div>

              <div className="rounded-xl border bg-white px-5 py-4 shadow-sm">
                <div className="text-sm text-gray-500">Teacher Loading</div>
                <div
                  className={`mt-2 text-sm font-semibold ${
                    hasLoadingRun ? "text-green-600" : "text-gray-500"
                  }`}
                >
                  {hasLoadingRun ? "Generated" : "Not generated"}
                </div>
              </div>
            </section>

            {!monitor.summary.canUpdateTeacherLoading && (
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-5 py-4 text-sm text-yellow-800">
                Teacher loading can only be updated when all modules are
                confirmed and no confirmed assignment has TBC / empty teacher.
              </div>
            )}

            {monitor.summary.canUpdateTeacherLoading && (
              <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-800">
                All assignment checks passed. Teacher loading is ready to be
                generated.
              </div>
            )}

            <ModuleTable
              title="Pending Modules"
              modules={monitor.pendingModules}
              emptyText="No pending modules. Nice and tidy."
            />

            <ModuleTable
              title="Confirmed Modules"
              modules={monitor.confirmedModules}
              emptyText="No confirmed modules found."
            />
          </>
        )}

        {loading && !monitor && (
          <div className="flex items-center justify-center rounded-xl border bg-white py-20 text-gray-500 shadow-sm">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading assignment monitor...
          </div>
        )}
      </div>
    </main>
  );
}
