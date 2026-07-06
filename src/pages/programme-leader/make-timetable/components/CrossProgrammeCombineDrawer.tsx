import { useEffect, useState } from "react";

import { LoadingState } from "../../../../components/ui/LoadingState";
import { formatCrossProgrammeDownstreamLabel } from "../../../../lib/crossProgrammeCombine";
import {
  getManualCombineGroupWithDetailsById,
  listCrossProgrammeCombineOrphans,
  type CrossProgrammeCombineOrphan,
  type CrossProgrammeManualCombineGroupSummary,
  type ManualCombineGroupWithDetails,
} from "../../../../services/manualCombineService";
import type { TimetableModuleInstanceRow } from "../../../../services/timetableModuleInstanceService";
import type {
  CombineGroupRow,
  ModuleTerm,
  TeacherRow,
  TeachingStatus,
  TimetableModuleRow,
} from "../../../../types";
import { CrossProgrammeGroupWorkflow } from "./CrossProgrammeGroupWorkflow";

export function CrossProgrammeCombineDrawer(props: {
  open: boolean;
  academicYear: string;
  groupSummary: CrossProgrammeManualCombineGroupSummary | null;
  refreshKey?: number;
  isAdmin: boolean;
  teachers: TeacherRow[];
  onClose: () => void;
  onJoinOrphan: (
    orphan: CrossProgrammeCombineOrphan
  ) => Promise<{ ok: boolean; message: string }>;
  onUndoCombine: (groupId: string) => void;
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
    open,
    academicYear,
    groupSummary,
    refreshKey = 0,
    isAdmin,
    teachers,
    onClose,
    onJoinOrphan,
    onUndoCombine,
    onCombinedSplit,
    onSaveInstanceEdits,
    onConfirmTeachers,
    onUndoSplit,
    onRefresh,
  } = props;

  const [loading, setLoading] = useState(false);
  const [joiningOrphanId, setJoiningOrphanId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [groupDetails, setGroupDetails] =
    useState<ManualCombineGroupWithDetails | null>(null);
  const [orphans, setOrphans] = useState<CrossProgrammeCombineOrphan[]>([]);

  useEffect(() => {
    if (!open || !groupSummary) {
      setGroupDetails(null);
      setOrphans([]);
      setActionMessage(null);
      setJoiningOrphanId(null);
      return;
    }

    setActionMessage(null);

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const [details, orphanRows] = await Promise.all([
          getManualCombineGroupWithDetailsById(groupSummary.id),
          listCrossProgrammeCombineOrphans({
            academicYear,
            moduleTerm: groupSummary.module_term,
            combineGroupId: groupSummary.id,
          }),
        ]);

        if (cancelled) return;

        setGroupDetails(details);
        setOrphans(orphanRows);
      } catch (error) {
        console.error(
          "[CrossProgrammeCombineDrawer] Load group details failed:",
          error
        );
        if (!cancelled) {
          setGroupDetails(null);
          setOrphans([]);
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
  }, [open, groupSummary, academicYear, refreshKey]);

  if (!open || !groupSummary) {
    return null;
  }

  const downstreamState = groupSummary.downstream_state;
  const isPairedGroup = groupSummary.module_codes.length > 1;

  async function handleJoinOrphanClick(orphan: CrossProgrammeCombineOrphan) {
    setActionMessage(null);
    setJoiningOrphanId(orphan.planning_module_id);

    try {
      const result = await onJoinOrphan(orphan);
      setActionMessage({
        type: result.ok ? "success" : "error",
        text: result.message,
      });
      if (result.ok) {
        await onRefresh();
      }
    } finally {
      setJoiningOrphanId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close drawer"
        onClick={onClose}
      />

      <div className="relative flex h-full w-full max-w-4xl flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-violet-700">
              Cross-programme combine group
            </div>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">
              {groupSummary.combined_code}
            </h2>
            <div className="mt-1 text-sm text-slate-600">
              {groupSummary.module_term} ·{" "}
              {formatCrossProgrammeDownstreamLabel(downstreamState)}
            </div>
            {isPairedGroup ? (
              <div className="mt-1 text-xs text-violet-800">
                Paired modules: {groupSummary.module_codes.join(", ")}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            {isAdmin ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => onUndoCombine(groupSummary.id)}
              >
                Undo combine
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {actionMessage ? (
            <div
              className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
                actionMessage.type === "success"
                  ? "border-green-200 bg-green-50 text-green-900"
                  : "border-red-200 bg-red-50 text-red-900"
              }`}
            >
              {actionMessage.text}
            </div>
          ) : null}

          {loading ? (
            <LoadingState />
          ) : (
            <div className="space-y-6">
              <section>
                <h3 className="text-sm font-semibold text-slate-900">Members</h3>
                <p className="mt-1 text-xs text-slate-600">
                  Programme Leaders maintain expected student numbers for their
                  modules in Step 1 before Admin joins them here.
                </p>
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                          Programme
                        </th>
                        <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                          Stream
                        </th>
                        <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                          Module
                        </th>
                        <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                          Expected
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(groupDetails?.details ?? []).map((member) => (
                        <tr key={member.planning_module_id}>
                          <td className="border border-slate-200 px-2 py-2">
                            {member.programme_code}
                          </td>
                          <td className="border border-slate-200 px-2 py-2">
                            {member.stream_code}
                          </td>
                          <td className="border border-slate-200 px-2 py-2">
                            {member.module_code}
                          </td>
                          <td className="border border-slate-200 px-2 py-2">
                            {member.expected_student_number ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {orphans.length > 0 ? (
                <section>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Orphan modules
                  </h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Active planning modules with a matching module code and term
                    that are not yet in this group.
                    {isPairedGroup
                      ? " Paired groups can include more than one module code."
                      : null}
                  </p>

                  <div className="mt-2 overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <th className="border border-amber-200 bg-amber-50 px-2 py-2 text-left">
                            Programme
                          </th>
                          <th className="border border-amber-200 bg-amber-50 px-2 py-2 text-left">
                            Stream
                          </th>
                          <th className="border border-amber-200 bg-amber-50 px-2 py-2 text-left">
                            Module
                          </th>
                          {isAdmin ? (
                            <th className="border border-amber-200 bg-amber-50 px-2 py-2 text-left">
                              Action
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {orphans.map((orphan) => (
                          <tr key={orphan.planning_module_id}>
                            <td className="border border-amber-200 px-2 py-2">
                              {orphan.programme_code}
                            </td>
                            <td className="border border-amber-200 px-2 py-2">
                              {orphan.stream_code}
                            </td>
                            <td className="border border-amber-200 px-2 py-2">
                              {orphan.module_code}
                            </td>
                            {isAdmin ? (
                              <td className="border border-amber-200 px-2 py-2">
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  disabled={
                                    joiningOrphanId === orphan.planning_module_id
                                  }
                                  onClick={() =>
                                    void handleJoinOrphanClick(orphan)
                                  }
                                >
                                  {joiningOrphanId === orphan.planning_module_id
                                    ? "Joining..."
                                    : "Join group"}
                                </button>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {!isAdmin ? (
                    <p className="mt-2 text-xs text-amber-800">
                      Contact Admin to join orphan modules to this group.
                    </p>
                  ) : null}
                </section>
              ) : null}

              {isAdmin ? (
                <CrossProgrammeGroupWorkflow
                  academicYear={academicYear}
                  moduleTerm={groupSummary.module_term}
                  groupSummary={groupSummary}
                  groupDetails={groupDetails}
                  refreshKey={refreshKey}
                  teachers={teachers}
                  onCombinedSplit={onCombinedSplit}
                  onSaveInstanceEdits={onSaveInstanceEdits}
                  onConfirmTeachers={onConfirmTeachers}
                  onUndoSplit={onUndoSplit}
                  onRefresh={onRefresh}
                />
              ) : (
                <p className="text-sm text-slate-600">
                  Split, mode, teachers, and scheduling for this group are
                  managed by Admin in this drawer.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
