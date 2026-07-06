import { useMemo, useState } from "react";

import { DataTable } from "../../../../components/tables/DataTable";
import { EmptyState } from "../../../../components/ui/EmptyState";
import { StatusBadge } from "../../../../components/ui/StatusBadge";
import { isTBC } from "../../../../lib/utils";
import { hasValidTeacherAssignment } from "../../../../services/assignmentService";
import type { TimetableModuleInstanceRow } from "../../../../services/timetableModuleInstanceService";
import type {
  TeacherRow,
  TeachingAssignmentRow,
  TeachingStatus,
  TimetableModuleRow,
} from "../../../../types";
import { dedupeJoinedModuleName } from "../../../../lib/moduleDisplay";
import { teachingStatusOptions } from "../types";
import { InstanceTeacherSelect } from "./InstanceTeacherSelect";

export function TeacherConfirmStep(props: {
  instances: TimetableModuleInstanceRow[];
  sourceTimetableModules: TimetableModuleRow[];
  assignments: TeachingAssignmentRow[];
  teachers: TeacherRow[];
  programmeCode?: string;
  confirming?: boolean;
  crossProgrammeInstanceCount?: number;
  onConfirmAllTeachers: (
    rows: Array<{
      instance: TimetableModuleInstanceRow;
      teacherName: string;
      teachingStatus: TeachingStatus;
    }>
  ) => Promise<void>;
}) {
  const {
    instances,
    sourceTimetableModules,
    assignments,
    teachers,
    programmeCode,
    confirming = false,
    crossProgrammeInstanceCount = 0,
    onConfirmAllTeachers,
  } = props;

  const timetableModuleByInstanceCode = useMemo(() => {
    const map = new Map<string, TimetableModuleRow>();
    for (const row of sourceTimetableModules) {
      if (!row.module_instance_code) continue;
      map.set(row.module_instance_code, row);
    }
    return map;
  }, [sourceTimetableModules]);

  const assignmentByTimetableModuleId = useMemo(() => {
    const map = new Map<string, TeachingAssignmentRow>();
    for (const row of assignments) {
      const existing = map.get(row.timetable_module_id);
      if (!existing || row.assignment_version > existing.assignment_version) {
        map.set(row.timetable_module_id, row);
      }
    }
    return map;
  }, [assignments]);

  const [edits, setEdits] = useState<
    Record<
      string,
      {
        teacherName?: string;
        teachingStatus?: TeachingStatus;
      }
    >
  >({});

  const rows = useMemo(() => {
    return instances.map((instance) => {
      const timetableModule = timetableModuleByInstanceCode.get(
        instance.module_instance_code
      );
      const assignment = timetableModule
        ? assignmentByTimetableModuleId.get(timetableModule.id)
        : undefined;
      const edit = edits[instance.id];

      const teacherName =
        edit?.teacherName ??
        instance.instance_teacher_name ??
        assignment?.teacher_name ??
        "TBC";

      const mode =
        instance.instance_mode || timetableModule?.mode || "Night";

      const teachingStatus =
        edit?.teachingStatus ??
        ((assignment?.teaching_status ?? "FT") as TeachingStatus);

      return {
        instance,
        timetableModule,
        assignment,
        teacherName,
        mode,
        teachingStatus,
      };
    });
  }, [
    instances,
    timetableModuleByInstanceCode,
    assignmentByTimetableModuleId,
    edits,
  ]);

  const tbcCount = rows.filter((row) => isTBC(row.teacherName)).length;
  const confirmedCount = rows.filter(
    (row) =>
      row.assignment?.confirmed && hasValidTeacherAssignment(row.assignment)
  ).length;

  async function handleConfirmAll() {
    await onConfirmAllTeachers(
      rows.map((row) => ({
        instance: row.instance,
        teacherName: row.teacherName,
        teachingStatus: row.teachingStatus,
      }))
    );
  }

  if (instances.length === 0) {
    return (
      <EmptyState message="No module instances yet. Complete the split step and click Confirm All Split Decisions first." />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="font-medium text-blue-900">Confirm all teachers</div>
          <div className="text-sm text-blue-700">
            Review every module instance for {programmeCode || "this programme"}.
            Assign a real teacher (not TBC) for each instance before scheduling.
            Mode is set in step 3 (分班).
          </div>
          <div className="mt-1 text-xs text-blue-600">
            {instances.length} instance(s) · {tbcCount} still TBC ·{" "}
            {confirmedCount} already confirmed
          </div>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          disabled={confirming || tbcCount > 0}
          title={
            tbcCount > 0
              ? `Assign teachers for all instances (${tbcCount} still TBC).`
              : "Confirm all teachers and continue to scheduling."
          }
          onClick={() => void handleConfirmAll()}
        >
          {confirming ? "Confirming…" : "Confirm All Teachers → Schedule"}
        </button>
      </div>

      {crossProgrammeInstanceCount > 0 && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
          {crossProgrammeInstanceCount} cross-programme combined instance(s) on
          this page are managed by Admin only and are hidden from this list.
        </div>
      )}

      {tbcCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {tbcCount} instance(s) still have TBC teacher. Please assign a teacher
          for each row before continuing.
        </div>
      )}

      <div className="card">
        <div className="card-header font-semibold">Module instances</div>
        <div className="card-body">
          <DataTable
            rows={rows}
            rowKey={(row) => row.instance.id}
            columns={[
              {
                key: "instance",
                header: "Instance",
                render: (row) => (
                  <div className="space-y-0.5">
                    <div className="font-medium">
                      {row.instance.module_instance_code}
                    </div>
                    <div className="text-xs text-slate-600">
                      {dedupeJoinedModuleName(row.instance.module_name)}
                    </div>
                  </div>
                ),
              },
              {
                key: "term",
                header: "Term",
                render: (row) => row.instance.module_term,
              },
              {
                key: "size",
                header: "Size",
                render: (row) => row.instance.instance_expected_size ?? 0,
              },
              {
                key: "mode",
                header: "Mode",
                render: (row) => row.mode,
              },
              {
                key: "teacher",
                header: "Teacher",
                render: (row) => (
                  <InstanceTeacherSelect
                    value={row.teacherName}
                    teachers={teachers}
                    onChange={(teacherName) => {
                      setEdits((prev) => ({
                        ...prev,
                        [row.instance.id]: {
                          ...(prev[row.instance.id] ?? {}),
                          teacherName,
                        },
                      }));
                    }}
                  />
                ),
              },
              {
                key: "teachingStatus",
                header: "Teaching Status",
                render: (row) => (
                  <select
                    className="form-select min-w-24"
                    value={row.teachingStatus}
                    title="Teaching status"
                    onChange={(event) => {
                      setEdits((prev) => ({
                        ...prev,
                        [row.instance.id]: {
                          ...(prev[row.instance.id] ?? {}),
                          teachingStatus: event.target.value as TeachingStatus,
                        },
                      }));
                    }}
                  >
                    {teachingStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (row) => {
                  if (isTBC(row.teacherName)) {
                    return <StatusBadge status="pending" />;
                  }

                  if (
                    row.assignment?.confirmed &&
                    hasValidTeacherAssignment(row.assignment)
                  ) {
                    return <StatusBadge status="confirmed" />;
                  }

                  return <StatusBadge status="draft" />;
                },
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
