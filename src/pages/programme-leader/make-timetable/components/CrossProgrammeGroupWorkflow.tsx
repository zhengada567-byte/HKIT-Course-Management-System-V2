import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "../../../../components/ui/EmptyState";
import { LoadingState } from "../../../../components/ui/LoadingState";
import { dedupeJoinedModuleName } from "../../../../lib/moduleDisplay";
import { listAssignments } from "../../../../services/assignmentService";
import type {
  CrossProgrammeManualCombineGroupSummary,
  ManualCombineGroupWithDetails,
} from "../../../../services/manualCombineService";
import {
  listTimetableModuleInstances,
  type TimetableModuleInstanceRow,
} from "../../../../services/timetableModuleInstanceService";
import { listTimetableModulesBySourceIds } from "../../../../services/timetableService";
import type {
  CombineGroupRow,
  ModuleTerm,
  TeacherRow,
  TeachingMode,
  TeachingStatus,
  TimetableModuleRow,
} from "../../../../types";
import { SplitAction } from "./SplitAction";
import { ScheduleStep } from "./ScheduleStep";
import { TeacherConfirmStep } from "./TeacherConfirmStep";

const modeOptions: TeachingMode[] = ["Day", "Night", "Saturday"];

type WorkflowTab = "split" | "teachers" | "schedule";

export function CrossProgrammeGroupWorkflow(props: {
  academicYear: string;
  moduleTerm: ModuleTerm;
  groupSummary: CrossProgrammeManualCombineGroupSummary;
  groupDetails: ManualCombineGroupWithDetails | null;
  refreshKey: number;
  teachers: TeacherRow[];
  onCombinedSplit: (
    group: CombineGroupRow,
    numberOfClasses: number
  ) => Promise<{ ok: boolean; message: string }>;
  onSaveInstanceEdits: (
    rows: Array<{
      id: string;
      instance_mode?: string | null;
      instance_expected_size?: number;
      instance_actual_size?: number | null;
    }>
  ) => Promise<void>;
  onConfirmTeachers: (
    rows: Array<{
      instance: TimetableModuleInstanceRow;
      teacherName: string;
      teachingStatus: TeachingStatus;
    }>,
    scopeSourceTimetableModules: TimetableModuleRow[]
  ) => Promise<{ ok: boolean; message: string }>;
  onUndoSplit: (row: TimetableModuleRow) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const {
    academicYear,
    moduleTerm,
    groupSummary,
    groupDetails,
    refreshKey,
    teachers,
    onCombinedSplit,
    onSaveInstanceEdits,
    onConfirmTeachers,
    onUndoSplit,
    onRefresh,
  } = props;

  const [tab, setTab] = useState<WorkflowTab>("split");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [workflowMessage, setWorkflowMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [timetableModules, setTimetableModules] = useState<TimetableModuleRow[]>(
    []
  );
  const [instances, setInstances] = useState<TimetableModuleInstanceRow[]>([]);
  const [assignments, setAssignments] = useState<
    Awaited<ReturnType<typeof listAssignments>>
  >([]);
  const [instanceEdits, setInstanceEdits] = useState<
    Record<
      string,
      {
        instance_mode?: string | null;
        instance_expected_size?: number;
      }
    >
  >({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setWorkflowMessage(null);

    void (async () => {
      try {
        const [modules, allInstances, assignmentRows] = await Promise.all([
          listTimetableModulesBySourceIds({
            academicYear,
            combineGroupIds: [groupSummary.id],
          }),
          listTimetableModuleInstances({ academicYear }),
          listAssignments(academicYear),
        ]);

        if (cancelled) return;

        setTimetableModules(modules);
        setInstances(
          allInstances.filter(
            (row) => row.source_combine_group_id === groupSummary.id
          )
        );
        setAssignments(assignmentRows);
        setInstanceEdits({});
      } catch (error) {
        console.error("[CrossProgrammeGroupWorkflow] Load failed:", error);
        if (!cancelled) {
          setTimetableModules([]);
          setInstances([]);
          setAssignments([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [academicYear, groupSummary.id, refreshKey]);

  const instanceRows = useMemo(() => {
    return instances.map((row) => {
      const edit = instanceEdits[row.id];
      return {
        ...row,
        instance_mode: edit?.instance_mode ?? row.instance_mode ?? null,
        instance_expected_size:
          edit?.instance_expected_size ?? row.instance_expected_size ?? 0,
      };
    });
  }, [instances, instanceEdits]);

  const hasSplitDecision = timetableModules.length > 0;

  async function handleSplit(numberOfClasses: number) {
    if (!groupDetails) {
      setWorkflowMessage({
        type: "error",
        text: "Group details are not loaded yet.",
      });
      return;
    }

    setBusy(true);
    setWorkflowMessage(null);

    try {
      const result = await onCombinedSplit(groupDetails, numberOfClasses);
      setWorkflowMessage({
        type: result.ok ? "success" : "error",
        text: result.message,
      });
      if (result.ok) {
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveInstanceEdits() {
    const rows = Object.entries(instanceEdits).map(([id, edit]) => ({
      id,
      ...edit,
    }));

    if (rows.length === 0) {
      return;
    }

    setBusy(true);
    setWorkflowMessage(null);

    try {
      await onSaveInstanceEdits(rows);
      setInstanceEdits({});
      setWorkflowMessage({
        type: "success",
        text: "Instance mode and size saved.",
      });
      await onRefresh();
    } catch (error) {
      setWorkflowMessage({
        type: "error",
        text:
          error instanceof Error ? error.message : "Failed to save instance edits.",
      });
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<{ key: WorkflowTab; label: string; disabled?: boolean }> = [
    { key: "split", label: "Split / Mode" },
    { key: "teachers", label: "Teachers", disabled: !hasSplitDecision },
    { key: "schedule", label: "Schedule", disabled: !hasSplitDecision },
  ];

  return (
    <section className="space-y-4 border-t border-slate-200 pt-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">
          Admin workflow
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Split, mode, teachers, and scheduling for this cross-programme group
          are managed here — not in programme Step 3–5.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={
              tab === item.key
                ? "btn btn-primary py-1 text-xs"
                : "btn btn-secondary py-1 text-xs"
            }
            disabled={item.disabled}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {workflowMessage ? (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            workflowMessage.type === "success"
              ? "border-green-200 bg-green-50 text-green-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {workflowMessage.text}
        </div>
      ) : null}

      {loading ? (
        <LoadingState />
      ) : tab === "split" ? (
        <div className="space-y-4">
          {!hasSplitDecision ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="font-medium text-slate-900">
                {groupSummary.combined_code}
              </div>
              <div className="mt-1 text-sm text-slate-600">
                Expected students: {groupSummary.total_expected_student_number ?? 0}
              </div>
              <div className="mt-3">
                <SplitAction
                  expected={groupSummary.total_expected_student_number ?? 0}
                  onNoSplit={() => void handleSplit(1)}
                  onSplit={(count) => void handleSplit(count)}
                />
              </div>
              {busy ? (
                <div className="mt-2 text-xs text-slate-500">Processing split...</div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-slate-600">
                  {instances.length} instance(s) for this combine group.
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy || timetableModules.length === 0}
                  onClick={() => {
                    const row = timetableModules[0];
                    if (!row) return;
                    void onUndoSplit(row).then(() => onRefresh());
                  }}
                >
                  Undo split
                </button>
              </div>

              {instances.length === 0 ? (
                <EmptyState message="Split recorded but instances are not ready yet. Refresh or run Confirm Split again." />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                            Instance
                          </th>
                          <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                            Mode
                          </th>
                          <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                            Size
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {instanceRows.map((row) => (
                          <tr key={row.id}>
                            <td className="border border-slate-200 px-2 py-2">
                              <div className="font-medium">
                                {row.module_instance_code}
                              </div>
                              <div className="text-xs text-slate-600">
                                {dedupeJoinedModuleName(row.module_name)}
                              </div>
                            </td>
                            <td className="border border-slate-200 px-2 py-2">
                              <select
                                className="form-select min-w-28"
                                value={row.instance_mode ?? ""}
                                title="Mode"
                                onChange={(event) => {
                                  setInstanceEdits((prev) => ({
                                    ...prev,
                                    [row.id]: {
                                      ...(prev[row.id] ?? {}),
                                      instance_mode: event.target.value || null,
                                    },
                                  }));
                                }}
                              >
                                <option value="">(empty)</option>
                                {modeOptions.map((mode) => (
                                  <option key={mode} value={mode}>
                                    {mode}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="border border-slate-200 px-2 py-2">
                              <input
                                className="form-input w-24"
                                type="number"
                                value={row.instance_expected_size ?? 0}
                                title="Instance size"
                                onChange={(event) => {
                                  const next = Number(event.target.value);
                                  setInstanceEdits((prev) => ({
                                    ...prev,
                                    [row.id]: {
                                      ...(prev[row.id] ?? {}),
                                      instance_expected_size: Number.isFinite(next)
                                        ? next
                                        : 0,
                                    },
                                  }));
                                }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy || Object.keys(instanceEdits).length === 0}
                    onClick={() => void handleSaveInstanceEdits()}
                  >
                    Save mode / size
                  </button>
                </>
              )}
            </>
          )}
        </div>
      ) : tab === "teachers" ? (
        hasSplitDecision ? (
          <TeacherConfirmStep
            instances={instances}
            sourceTimetableModules={timetableModules}
            assignments={assignments}
            teachers={teachers}
            confirming={busy}
            onConfirmAllTeachers={async (rows) => {
              setBusy(true);
              setWorkflowMessage(null);
              try {
                const result = await onConfirmTeachers(rows, timetableModules);
                setWorkflowMessage({
                  type: result.ok ? "success" : "error",
                  text: result.message,
                });
                if (result.ok) {
                  await onRefresh();
                }
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : (
          <EmptyState message="Complete Split / Mode before assigning teachers." />
        )
      ) : hasSplitDecision ? (
        <ScheduleStep
          academicYear={academicYear}
          moduleTerm={moduleTerm}
          timetableInstances={instances}
          sourceTimetableModuleCount={timetableModules.length}
        />
      ) : (
        <EmptyState message="Complete Split / Mode before scheduling." />
      )}
    </section>
  );
}
