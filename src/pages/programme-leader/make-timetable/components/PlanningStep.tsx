import { DataTable } from "../../../../components/tables/DataTable";
import { EmptyState } from "../../../../components/ui/EmptyState";
import { StatusBadge } from "../../../../components/ui/StatusBadge";
import type { PlanningModuleWithStudentNumber } from "../../../../services/timetableService";
import { displayStream, renderModuleCodeAndName } from "../helpers";

export function PlanningStep({
  planningModules,
}: {
  planningModules: PlanningModuleWithStudentNumber[];
}) {
  if (planningModules.length === 0) {
    return (
      <EmptyState message="Modules will appear automatically after selecting a programme." />
    );
  }

  return (
    <DataTable
      rows={planningModules}
      rowKey={(row) => row.id}
      columns={[
        {
          key: "programme",
          header: "Programme",
          render: (row) => row.programme_code,
        },
        {
          key: "stream",
          header: "Stream",
          render: (row) => displayStream(row.stream_code),
        },
        {
          key: "module",
          header: "Module",
          render: (row) => renderModuleCodeAndName(row),
        },
        {
          key: "term",
          header: "Term",
          render: (row) => row.module_term,
        },
        {
          key: "expected",
          header: "Expected",
          render: (row) => row.expected_student_number ?? "-",
        },
        {
          key: "actual",
          header: "Actual",
          render: (row) => row.actual_student_number ?? "-",
        },
        {
          key: "defaultTeacher",
          header: "Default Teacher",
          render: (row) => row.default_teacher_name ?? "TBC",
        },
        {
          key: "defaultStatus",
          header: "Teaching Status",
          render: (row) => row.default_teaching_status ?? "-",
        },
        {
          key: "mode",
          header: "Mode",
          render: (row) => row.default_mode ?? "Night",
        },
        {
          key: "split",
          header: "Split",
          render: (row) => <StatusBadge status={row.split_status} />,
        },
      ]}
    />
  );
}
