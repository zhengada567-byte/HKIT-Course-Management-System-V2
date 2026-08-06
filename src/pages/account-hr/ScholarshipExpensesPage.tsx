import { useEffect, useMemo, useState } from "react";

import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  calculateScholarshipTotal,
  listProgrammeScholarshipExpenses,
  SCHOLARSHIP_AMOUNT_PER_STUDENT,
  SCHOLARSHIP_PROGRAMME_CODES,
  upsertProgrammeScholarshipExpense,
  type ScholarshipProgrammeCode,
} from "../../services/scholarshipExpenseService";
import { ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR } from "./accountHrAcademicYear";
import { AccountHrAcademicYearSelect } from "./AccountHrAcademicYearSelect";

type DraftRow = {
  y1Count: string;
  y2Count: string;
};

function emptyDrafts(): Record<ScholarshipProgrammeCode, DraftRow> {
  return {
    HDBA: { y1Count: "", y2Count: "" },
    HDHC: { y1Count: "", y2Count: "" },
    HDC: { y1Count: "", y2Count: "" },
  };
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
  const [drafts, setDrafts] = useState(emptyDrafts);

  async function loadAll() {
    setLoading(true);
    setMessage("");
    try {
      const rows = await listProgrammeScholarshipExpenses(academicYear);
      const next = emptyDrafts();
      for (const code of SCHOLARSHIP_PROGRAMME_CODES) {
        const row = rows.find((item) => item.programme_code === code);
        next[code] = {
          y1Count: row ? String(row.y1_count) : "",
          y2Count: row ? String(row.y2_count) : "",
        };
      }
      setDrafts(next);
    } catch (error) {
      setDrafts(emptyDrafts());
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
    void loadAll();
  }, [academicYear]);

  const rowTotals = useMemo(() => {
    const map: Record<ScholarshipProgrammeCode, number> = {
      HDBA: 0,
      HDHC: 0,
      HDC: 0,
    };
    for (const code of SCHOLARSHIP_PROGRAMME_CODES) {
      map[code] = calculateScholarshipTotal({
        y1Count: Number(drafts[code].y1Count || 0),
        y2Count: Number(drafts[code].y2Count || 0),
      });
    }
    return map;
  }, [drafts]);

  const grandTotal = useMemo(
    () =>
      SCHOLARSHIP_PROGRAMME_CODES.reduce(
        (sum, code) => sum + rowTotals[code],
        0
      ),
    [rowTotals]
  );

  async function saveRow(programmeCode: ScholarshipProgrammeCode) {
    setSavingCode(programmeCode);
    setMessage("");
    try {
      await upsertProgrammeScholarshipExpense({
        academicYear,
        programmeCode,
        y1Count: drafts[programmeCode].y1Count || "0",
        y2Count: drafts[programmeCode].y2Count || "0",
        amountPerStudent: SCHOLARSHIP_AMOUNT_PER_STUDENT,
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
          <p className="text-sm font-medium text-slate-800">
            {t.scholarshipAmountPerStudent}:{" "}
            {money(SCHOLARSHIP_AMOUNT_PER_STUDENT)}
          </p>
        </div>
      </div>

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto card">
            <div className="card-body">
              <table className="data-table min-w-[860px]">
                <thead>
                  <tr>
                    <th>{t.programmeCode}</th>
                    <th>{t.scholarshipY1DaeCount}</th>
                    <th>{t.scholarshipY2DaeCount}</th>
                    <th>{t.scholarshipTotalExpense}</th>
                    <th>{t.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {SCHOLARSHIP_PROGRAMME_CODES.map((code) => (
                    <tr key={code}>
                      <td className="font-medium">{code}</td>
                      <td>
                        <input
                          className="form-input min-w-24"
                          type="number"
                          min="0"
                          step="1"
                          value={drafts[code].y1Count}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [code]: {
                                ...prev[code],
                                y1Count: event.target.value,
                              },
                            }))
                          }
                          placeholder="0"
                        />
                      </td>
                      <td>
                        <input
                          className="form-input min-w-24"
                          type="number"
                          min="0"
                          step="1"
                          value={drafts[code].y2Count}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [code]: {
                                ...prev[code],
                                y2Count: event.target.value,
                              },
                            }))
                          }
                          placeholder="0"
                        />
                      </td>
                      <td className="font-semibold">
                        {money(rowTotals[code])}
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
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-semibold">
                    <td colSpan={3}>{t.total}</td>
                    <td>{money(grandTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            {t.scholarshipFormulaHint}
          </p>
        </div>
      )}
    </div>
  );
}
