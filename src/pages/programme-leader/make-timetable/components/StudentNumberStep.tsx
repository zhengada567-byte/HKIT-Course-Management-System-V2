import { Loader2 } from "lucide-react";

import { DataTable } from "../../../../components/tables/DataTable";
import { EmptyState } from "../../../../components/ui/EmptyState";
import { useLanguage } from "../../../../contexts/LanguageContext";
import type { PlanningModuleWithStudentNumber } from "../../../../services/timetableService";
import type { StudentNumberInputRow } from "../../../../services/studentNumberService";
import { renderModuleCodeAndName } from "../helpers";

export function StudentNumberStep({
  rows,
  excludedModules,
  updateRow,
  onSync,
  onSave,
  onExclude,
  onRestoreExcluded,
  syncDisabled = false,
  syncing = false,
  offeringBusy = false,
  programmeSelected = true,
}: {
  rows: StudentNumberInputRow[];
  excludedModules: PlanningModuleWithStudentNumber[];
  updateRow: (
    index: number,
    field: "expected_student_number" | "actual_student_number",
    value: string
  ) => void;
  onSync: () => void;
  onSave: () => void;
  onExclude: (row: StudentNumberInputRow) => void;
  onRestoreExcluded: (module: PlanningModuleWithStudentNumber) => void;
  syncDisabled?: boolean;
  syncing?: boolean;
  offeringBusy?: boolean;
  programmeSelected?: boolean;
}) {
  const { t } = useLanguage();
  const isBusy = syncing || offeringBusy;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Sync loads actual from study plan; expected defaults to actual (you can
        edit either field). Use &quot;{t.excludeFromOffering}&quot; for modules
        you will not run this year (catalogue unchanged). Undo combine/split
        first if the button is blocked.
      </p>

      {!programmeSelected && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Please select a programme before syncing from study plan.
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
            {
              key: "offering",
              header: t.action,
              render: (row) => (
                <button
                  type="button"
                  className="btn btn-secondary py-1 text-xs"
                  disabled={isBusy || row.planning_module_ids.length === 0}
                  onClick={() => onExclude(row)}
                >
                  {offeringBusy ? t.loading : t.excludeFromOffering}
                </button>
              ),
            },
          ]}
        />
      )}

      {excludedModules.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">
            {t.excludedModules} ({excludedModules.length})
          </summary>
          <div className="border-t border-slate-200 p-3">
            <DataTable
              rows={excludedModules}
              rowKey={(row) => row.id}
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
                  render: (row) => row.module_term,
                },
                {
                  key: "stream",
                  header: "Stream",
                  render: (row) => row.stream_code,
                },
                {
                  key: "action",
                  header: t.action,
                  render: (row) => (
                    <button
                      type="button"
                      className="btn btn-secondary py-1 text-xs"
                      disabled={isBusy}
                      onClick={() => onRestoreExcluded(row)}
                    >
                      {offeringBusy ? t.loading : t.restoreToOffering}
                    </button>
                  ),
                },
              ]}
            />
          </div>
        </details>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secondary inline-flex items-center gap-2"
          onClick={onSync}
          disabled={syncDisabled || isBusy}
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Sync from Study Plan
        </button>

        <button
          type="button"
          className="btn btn-primary"
          onClick={onSave}
          disabled={rows.length === 0 || isBusy}
        >
          Save Student Numbers
        </button>
      </div>
    </div>
  );
}
