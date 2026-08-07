import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { isHDProgrammeType } from "../programme-leader/make-study-plan/helpers";
import { listProgrammes } from "../../services/programmeService";
import {
  calculateScholarshipTotal,
  defaultScholarshipAmountPerStudent,
  listProgrammeScholarshipExpenses,
  upsertProgrammeScholarshipExpense,
} from "../../services/scholarshipExpenseService";
import type { ProgrammeRow } from "../../types";
import { ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR } from "./accountHrAcademicYear";
import { AccountHrAcademicYearSelect } from "./AccountHrAcademicYearSelect";

type DraftRow = {
  y1Count: string;
  y2Count: string;
  amountPerStudent: string;
};

function uniqueHdProgrammeCodes(programmes: ProgrammeRow[]) {
  const codes = new Set<string>();
  for (const row of programmes) {
    const code = String(row.programme_code ?? "").trim().toUpperCase();
    if (!code || !isHDProgrammeType(row.programme_type)) continue;
    codes.add(code);
  }
  return Array.from(codes).sort((a, b) => a.localeCompare(b));
}

function money(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

export function ScholarshipExpensesPage() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [academicYear, setAcademicYear] = useState(
    ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR
  );
  const [loading, setLoading] = useState(false);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [programmeCodes, setProgrammeCodes] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});

  function buildDefaultDrafts(codes: string[]): Record<string, DraftRow> {
    const next: Record<string, DraftRow> = {};
    for (const code of codes) {
      next[code] = {
        y1Count: "",
        y2Count: "",
        amountPerStudent: money(defaultScholarshipAmountPerStudent(code)),
      };
    }
    return next;
  }

  async function loadProgrammes() {
    try {
      const programmes = await listProgrammes();
      setProgrammeCodes(uniqueHdProgrammeCodes(programmes));
    } catch (error) {
      setProgrammeCodes([]);
      setMessage(
        error instanceof Error ? error.message : "Failed to load programmes."
      );
    }
  }

  async function loadAll() {
    setLoading(true);
    setMessage("");
    try {
      const rows = await listProgrammeScholarshipExpenses(academicYear);
      const next = buildDefaultDrafts(programmeCodes);
      for (const code of programmeCodes) {
        const row = rows.find((item) => item.programme_code === code);
        if (!row) continue;
        next[code] = {
          y1Count: String(row.y1_count),
          y2Count: String(row.y2_count),
          amountPerStudent: money(Number(row.amount_per_student)),
        };
      }
      setDrafts(next);
    } catch (error) {
      setDrafts(buildDefaultDrafts(programmeCodes));
      const detail =
        error instanceof Error
          ? error.message
          : "Failed to load scholarship expenses.";
      setMessage(
        /could not find the table|does not exist|schema cache/i.test(detail)
          ? `${detail} — please apply migration 058 on Supabase.`
          : detail
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProgrammes();
  }, []);

  useEffect(() => {
    if (programmeCodes.length === 0) {
      setDrafts({});
      return;
    }
    void loadAll();
  }, [academicYear, programmeCodes]);

  const rowTotals = useMemo(() => {
    const map: Record<string, number> = {};
    for (const code of programmeCodes) {
      const draft = drafts[code];
      map[code] = calculateScholarshipTotal({
        y1Count: Number(draft?.y1Count || 0),
        y2Count: Number(draft?.y2Count || 0),
        amountPerStudent: Number(
          draft?.amountPerStudent ?? defaultScholarshipAmountPerStudent(code)
        ),
      });
    }
    return map;
  }, [drafts, programmeCodes]);

  const grandTotal = useMemo(
    () => programmeCodes.reduce((sum, code) => sum + (rowTotals[code] ?? 0), 0),
    [programmeCodes, rowTotals]
  );

  function updateDraft(code: string, patch: Partial<DraftRow>) {
    setDrafts((prev) => ({
      ...prev,
      [code]: {
        y1Count: prev[code]?.y1Count ?? "",
        y2Count: prev[code]?.y2Count ?? "",
        amountPerStudent:
          prev[code]?.amountPerStudent ??
          money(defaultScholarshipAmountPerStudent(code)),
        ...patch,
      },
    }));
  }

  async function saveRow(programmeCode: string) {
    setSavingCode(programmeCode);
    setMessage("");
    try {
      const draft = drafts[programmeCode];
      await upsertProgrammeScholarshipExpense({
        academicYear,
        programmeCode,
        y1Count: draft?.y1Count || "0",
        y2Count: draft?.y2Count || "0",
        amountPerStudent:
          draft?.amountPerStudent ??
          defaultScholarshipAmountPerStudent(programmeCode),
        updatedBy: user?.id ?? null,
      });
      setMessage(t.scholarshipExpenseSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSavingCode(null);
    }
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.scholarshipExpensesTitle}
        description={t.scholarshipExpensesDescription}
      />

      <div className="mb-4 card">
        <div className="card-body space-y-2">
          <AccountHrAcademicYearSelect
            label={t.academicYear}
            value={academicYear}
            onChange={setAcademicYear}
          />
          <p className="text-sm text-slate-600">{t.scholarshipExpensesHint}</p>
        </div>
      </div>

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : programmeCodes.length === 0 ? (
        <EmptyState message={t.selectProgrammeRequiredShort} />
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto card">
            <div className="card-body">
              <table className="data-table min-w-[960px]">
                <thead>
                  <tr>
                    <th>{t.programmeCode}</th>
                    <th>{t.scholarshipY1DaeCount}</th>
                    <th>{t.scholarshipY2DaeCount}</th>
                    <th>{t.scholarshipAmountPerStudent}</th>
                    <th>{t.scholarshipTotalExpense}</th>
                    <th>{t.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {programmeCodes.map((code) => {
                    const draft = drafts[code] ?? {
                      y1Count: "",
                      y2Count: "",
                      amountPerStudent: money(
                        defaultScholarshipAmountPerStudent(code)
                      ),
                    };
                    return (
                      <tr key={code}>
                        <td className="font-medium">{code}</td>
                        <td>
                          <input
                            className="form-input h-8 w-24"
                            type="number"
                            min="0"
                            step="1"
                            value={draft.y1Count}
                            onChange={(event) =>
                              updateDraft(code, {
                                y1Count: event.target.value,
                              })
                            }
                            placeholder="0"
                          />
                        </td>
                        <td>
                          <input
                            className="form-input h-8 w-24"
                            type="number"
                            min="0"
                            step="1"
                            value={draft.y2Count}
                            onChange={(event) =>
                              updateDraft(code, {
                                y2Count: event.target.value,
                              })
                            }
                            placeholder="0"
                          />
                        </td>
                        <td>
                          <input
                            className="form-input h-8 w-28"
                            type="number"
                            min="0"
                            step="0.01"
                            value={draft.amountPerStudent}
                            onChange={(event) =>
                              updateDraft(code, {
                                amountPerStudent: event.target.value,
                              })
                            }
                            placeholder="0.00"
                          />
                        </td>
                        <td className="font-semibold">
                          {money(rowTotals[code] ?? 0)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={savingCode === code}
                            onClick={() => void saveRow(code)}
                          >
                            {savingCode === code ? t.loading : t.save}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-semibold">
                    <td colSpan={4}>{t.total}</td>
                    <td>{money(grandTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <p className="text-xs text-slate-500">{t.scholarshipFormulaHint}</p>
        </div>
      )}
    </div>
  );
}
