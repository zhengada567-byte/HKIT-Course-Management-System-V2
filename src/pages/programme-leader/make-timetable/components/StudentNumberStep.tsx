import { Loader2 } from "lucide-react";

import { DataTable } from "../../../../components/tables/DataTable";
import { EmptyState } from "../../../../components/ui/EmptyState";
import type { StudentNumberInputRow } from "../../../../services/studentNumberService";
import { renderModuleCodeAndName } from "../helpers";

export function StudentNumberStep({
  rows,
  updateRow,
  onSync,
  onSave,
  syncDisabled = false,
  syncing = false,
  programmeSelected = true,
  quotaConfirmed = true,
  expectedReadOnly = false,
  quotaBlockedMessage,
}: {
  rows: StudentNumberInputRow[];
  updateRow: (
    index: number,
    field: "expected_student_number" | "actual_student_number",
    value: string
  ) => void;
  onSync: () => void;
  onSave: () => void;
  syncDisabled?: boolean;
  syncing?: boolean;
  programmeSelected?: boolean;
  quotaConfirmed?: boolean;
  expectedReadOnly?: boolean;
  quotaBlockedMessage?: string;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Student numbers are synced from study plan by default (missing modules
        use actual = 0). You can adjust values before saving.
      </p>

      {!programmeSelected && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Please select a programme before syncing from study plan.
        </div>
      )}

      {programmeSelected && !quotaConfirmed && quotaBlockedMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {quotaBlockedMessage}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState message="No student number rows yet. Select a programme and click Sync from Study Plan." />
      ) : (
        <DataTable
          rows={rows}
          rowKey={(row) =>
            `${row.academic_year}-${row.programme_code}-${row.module_code}-${row.programme_stream}-${row.study_term}`
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

                return expectedReadOnly ? (
                  <span>{row.expected_student_number ?? 0}</span>
                ) : (
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
                    value={row.actual_student_number ?? 0}
                    onChange={(event) =>
                      updateRow(
                        index,
                        "actual_student_number",
                        event.target.value
                      )
                    }
                  />
                );
              },
            },
          ]}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secondary inline-flex items-center gap-2"
          onClick={onSync}
          disabled={syncDisabled || syncing || !quotaConfirmed}
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Sync from Study Plan
        </button>

        <button
          type="button"
          className="btn btn-primary"
          onClick={onSave}
          disabled={rows.length === 0 || syncing || !quotaConfirmed}
        >
          Save Student Numbers
        </button>
      </div>
    </div>
  );
}
