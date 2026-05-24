import { DataTable } from "../../../../components/tables/DataTable";
import { EmptyState } from "../../../../components/ui/EmptyState";
import type { StudentNumberInputRow } from "../../../../services/studentNumberService";
import { renderModuleCodeAndName } from "../helpers";

export function StudentNumberStep({
  rows,
  updateRow,
  onSave,
}: {
  rows: StudentNumberInputRow[];
  updateRow: (
    index: number,
    field: "expected_student_number" | "actual_student_number",
    value: string
  ) => void;
  onSave: () => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState message="No student number rows. Select a programme to load modules automatically." />
    );
  }

  return (
    <div className="space-y-4">
      <DataTable
        rows={rows}
        rowKey={(row) =>
          `${row.academic_year}-${row.programme_code}-${row.module_code}-${row.module_term ?? ""}`
        }
        columns={[
          {
            key: "module",
            header: "Module",
            render: (row) => renderModuleCodeAndName(row),
          },
          {
            key: "programme",
            header: "Programme Code",
            render: (row) => row.programme_code,
          },
          {
            key: "term",
            header: "Term",
            render: (row) => row.module_term ?? "-",
          },
          {
            key: "streams",
            header: "Streams Included",
            render: (row) => row.streams_included.join(", "),
          },
          {
            key: "expected",
            header: "Expected Student Number",
            render: (row) => {
              const index = rows.indexOf(row);

              return (
                <input
                  className="form-input w-28"
                  type="number"
                  min={0}
                  value={row.expected_student_number ?? ""}
                  onChange={(event) =>
                    updateRow(
                      index,
                      "expected_student_number",
                      event.target.value
                    )
                  }
                />
              );
            },
          },
          {
            key: "actual",
            header: "Actual Student Number",
            render: (row) => {
              const index = rows.indexOf(row);

              return (
                <input
                  className="form-input w-28"
                  type="number"
                  min={0}
                  value={row.actual_student_number ?? ""}
                  onChange={(event) =>
                    updateRow(index, "actual_student_number", event.target.value)
                  }
                />
              );
            },
          },
        ]}
      />

      <button type="button" className="btn btn-primary" onClick={onSave}>
        Save Student Numbers
      </button>
    </div>
  );
}
