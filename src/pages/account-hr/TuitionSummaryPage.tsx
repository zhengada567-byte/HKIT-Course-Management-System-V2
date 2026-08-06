import { useEffect, useMemo, useState } from "react";

import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  getPublishedTuitionFee,
  HKIT_TUITION_SOURCE_DEGREE,
  HKIT_TUITION_SOURCE_HD,
} from "../../lib/hkitPublishedTuitionFees";
import { offeredTermToStudyTerm } from "../../lib/utils";
import { listProgrammes } from "../../services/programmeService";
import {
  downloadProgrammeTermStudentListCsv,
  listProgrammeTuitionFees,
  loadAllProgrammeStudentBreakdownsForTerm,
  upsertProgrammeTuitionFee,
  type ProgrammeStudentBreakdown,
} from "../../services/tuitionSummaryService";
import {
  listTuitionIncome,
  upsertTuitionIncome,
} from "../../services/tuitionPartnerSharingService";
import type { ModuleTerm, ProgrammeRow } from "../../types";
import { ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR } from "./accountHrAcademicYear";
import { AccountHrAcademicYearSelect } from "./AccountHrAcademicYearSelect";

const TERM_OPTIONS: ModuleTerm[] = ["Sep", "Feb", "Jun"];

function uniqueProgrammeMeta(programmes: ProgrammeRow[]) {
  const byCode = new Map<string, { code: string; name: string }>();
  for (const row of programmes) {
    const code = String(row.programme_code ?? "").trim().toUpperCase();
    if (!code || byCode.has(code)) continue;
    byCode.set(code, {
      code,
      name:
        String(row.programme_name ?? "").trim() ||
        getPublishedTuitionFee(code)?.programmeName ||
        code,
    });
  }
  return Array.from(byCode.values()).sort((a, b) =>
    a.code.localeCompare(b.code)
  );
}

export function TuitionSummaryPage() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [academicYear, setAcademicYear] = useState(
    ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR
  );
  const [moduleTerm, setModuleTerm] = useState<ModuleTerm>("Sep");
  const [loading, setLoading] = useState(false);
  const [loadingTerm, setLoadingTerm] = useState(false);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [savingIncomeCode, setSavingIncomeCode] = useState<string | null>(null);
  const [exportingCode, setExportingCode] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [programmeMeta, setProgrammeMeta] = useState<
    Array<{ code: string; name: string }>
  >([]);
  const [feeByCode, setFeeByCode] = useState<Record<string, string>>({});
  const [incomeByCode, setIncomeByCode] = useState<Record<string, string>>({});
  const [termBreakdownByCode, setTermBreakdownByCode] = useState<
    Record<string, ProgrammeStudentBreakdown>
  >({});

  const programmeCodes = useMemo(
    () => programmeMeta.map((row) => row.code),
    [programmeMeta]
  );

  const studyTerm = useMemo(
    () => offeredTermToStudyTerm(academicYear, moduleTerm),
    [academicYear, moduleTerm]
  );

  async function loadFeesAndProgrammes() {
    setLoading(true);
    setMessage("");

    try {
      const programmes = await listProgrammes();
      const meta = uniqueProgrammeMeta(programmes);
      setProgrammeMeta(meta);

      let fees: Awaited<ReturnType<typeof listProgrammeTuitionFees>> = [];
      try {
        fees = await listProgrammeTuitionFees(academicYear);
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "Failed to load fees.";
        if (/could not find the table|does not exist|schema cache/i.test(detail)) {
          setMessage(`${detail} — please apply migration 056 on Supabase.`);
        } else {
          setMessage(detail);
        }
      }

      const feeMap: Record<string, string> = {};
      for (const row of meta) {
        const saved = fees.find((f) => f.programme_code === row.code);
        if (saved) {
          feeMap[row.code] = String(saved.tuition_fee_per_student);
        } else {
          const published = getPublishedTuitionFee(row.code);
          feeMap[row.code] = published ? String(published.ftAnnualFee) : "";
        }
      }
      setFeeByCode(feeMap);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadTermSection() {
    if (programmeCodes.length === 0) return;
    setLoadingTerm(true);

    try {
      const [breakdowns, incomeRows] = await Promise.all([
        loadAllProgrammeStudentBreakdownsForTerm({
          programmeCodes,
          academicYear,
          moduleTerm,
        }),
        listTuitionIncome(academicYear).catch(() => []),
      ]);

      const map: Record<string, ProgrammeStudentBreakdown> = {};
      for (const [code, row] of breakdowns) {
        map[code] = row;
      }
      setTermBreakdownByCode(map);

      const incomeMap: Record<string, string> = {};
      for (const code of programmeCodes) {
        const row = incomeRows.find(
          (item) =>
            item.programme_code === code && item.module_term === moduleTerm
        );
        incomeMap[code] = row ? String(row.amount) : "";
      }
      setIncomeByCode(incomeMap);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load term failed");
    } finally {
      setLoadingTerm(false);
    }
  }

  useEffect(() => {
    void loadFeesAndProgrammes();
  }, [academicYear]);

  useEffect(() => {
    if (programmeCodes.length > 0) {
      void loadTermSection();
    }
  }, [programmeCodes.join("|"), academicYear, moduleTerm]);

  async function saveFee(programmeCode: string) {
    setSavingCode(programmeCode);
    setMessage("");
    try {
      const published = getPublishedTuitionFee(programmeCode);
      await upsertProgrammeTuitionFee({
        academicYear,
        programmeCode,
        tuitionFeePerStudent: feeByCode[programmeCode] || "0",
        notes: published
          ? `HKIT published FT fee ref: ${published.sourceUrl}`
          : null,
        updatedBy: user?.id ?? null,
      });
      setMessage(t.tuitionFeeSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSavingCode(null);
    }
  }

  async function saveIncome(programmeCode: string) {
    setSavingIncomeCode(programmeCode);
    setMessage("");
    try {
      await upsertTuitionIncome({
        academicYear,
        programmeCode,
        moduleTerm,
        amount: incomeByCode[programmeCode] || "0",
        updatedBy: user?.id ?? null,
      });
      setMessage(t.tuitionIncomeSaved);
      await loadTermSection();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSavingIncomeCode(null);
    }
  }

  async function exportStudents(programmeCode: string) {
    setExportingCode(programmeCode);
    setMessage("");
    try {
      const meta = programmeMeta.find((row) => row.code === programmeCode);
      const count = await downloadProgrammeTermStudentListCsv({
        programmeCode,
        academicYear,
        moduleTerm,
        programmeName: meta?.name ?? programmeCode,
      });
      setMessage(
        t.studentListExported.replace("{count}", String(count)).replace(
          "{programme}",
          programmeCode
        )
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExportingCode(null);
    }
  }

  const termRows = useMemo(() => {
    return programmeMeta.map((meta) => ({
      programmeCode: meta.code,
      programmeName: meta.name,
      breakdown: termBreakdownByCode[meta.code],
      incomeInput: incomeByCode[meta.code] ?? "",
    }));
  }, [programmeMeta, termBreakdownByCode, incomeByCode]);

  const termFt = termRows.reduce(
    (sum, row) => sum + (row.breakdown?.ftTotal ?? 0),
    0
  );
  const termPt = termRows.reduce(
    (sum, row) => sum + (row.breakdown?.ptTotal ?? 0),
    0
  );

  return (
    <div className="page-container">
      <PageHeader
        title={t.tuitionSummaryTitle}
        description={t.tuitionSummaryDescription}
      />

      <div className="mb-4 card">
        <div className="card-body">
          <AccountHrAcademicYearSelect
            label={t.academicYear}
            value={academicYear}
            onChange={setAcademicYear}
          />
          <p className="mt-2 text-xs text-slate-500">
            {t.tuitionFeeSourceHint}{" "}
            <a
              className="text-blue-700 underline"
              href={HKIT_TUITION_SOURCE_HD}
              target="_blank"
              rel="noreferrer"
            >
              HD
            </a>
            {" · "}
            <a
              className="text-blue-700 underline"
              href={HKIT_TUITION_SOURCE_DEGREE}
              target="_blank"
              rel="noreferrer"
            >
              Degree
            </a>
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
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900">
              {t.tuitionFeeByAcademicYearSection}
            </h2>
            <p className="text-sm text-slate-600">{t.tuitionFeeByAcademicYearHint}</p>
            <div className="overflow-x-auto card">
              <div className="card-body">
                <table className="data-table min-w-[720px]">
                  <thead>
                    <tr>
                      <th>{t.programmeCode}</th>
                      <th>{t.programmeTuitionFeePerStudent}</th>
                      <th>{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {programmeMeta.map((row) => (
                      <tr key={row.code}>
                        <td className="font-medium">{row.code}</td>
                        <td>
                          <input
                            className="form-input min-w-28"
                            type="number"
                            min="0"
                            step="0.01"
                            value={feeByCode[row.code] ?? ""}
                            onChange={(event) =>
                              setFeeByCode((prev) => ({
                                ...prev,
                                [row.code]: event.target.value,
                              }))
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={savingCode === row.code}
                            onClick={() => void saveFee(row.code)}
                          >
                            {savingCode === row.code ? t.loading : t.save}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900">
              {t.tuitionTermSummarySection}
            </h2>
            <p className="text-sm text-slate-600">{t.tuitionTermSummaryHint}</p>

            <div className="card">
              <div className="card-body max-w-xs">
                <label className="form-label">{t.term}</label>
                <select
                  className="form-select"
                  value={moduleTerm}
                  onChange={(event) =>
                    setModuleTerm(event.target.value as ModuleTerm)
                  }
                >
                  {TERM_OPTIONS.map((term) => (
                    <option key={term} value={term}>
                      {term}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  {t.studyTerm}: {studyTerm}
                </p>
              </div>
            </div>

            {loadingTerm ? (
              <LoadingState />
            ) : (
              <div className="overflow-x-auto card">
                <div className="card-body">
                  <table className="data-table min-w-[1024px]">
                    <thead>
                      <tr>
                        <th>{t.programmeCode}</th>
                        <th>{t.studentCountByYearMode}</th>
                        <th>FT</th>
                        <th>PT</th>
                        <th>{t.total}</th>
                        <th>{t.tuitionIncomeAmount}</th>
                        <th>{t.actions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {termRows.map((row) => (
                        <tr key={row.programmeCode}>
                          <td className="font-medium">{row.programmeCode}</td>
                          <td className="text-xs text-slate-600">
                            {(row.breakdown?.byYear ?? []).length === 0
                              ? "-"
                              : (row.breakdown?.byYear ?? [])
                                  .map(
                                    (y) =>
                                      `${y.programmeYear}: FT ${y.ft} / PT ${y.pt}`
                                  )
                                  .join(" · ")}
                          </td>
                          <td>{row.breakdown?.ftTotal ?? 0}</td>
                          <td>{row.breakdown?.ptTotal ?? 0}</td>
                          <td>{row.breakdown?.total ?? 0}</td>
                          <td>
                            <input
                              className="form-input min-w-28"
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.incomeInput}
                              onChange={(event) =>
                                setIncomeByCode((prev) => ({
                                  ...prev,
                                  [row.programmeCode]: event.target.value,
                                }))
                              }
                              placeholder={t.accountingFillPlaceholder}
                            />
                          </td>
                          <td>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="btn btn-secondary"
                                disabled={
                                  savingIncomeCode === row.programmeCode
                                }
                                onClick={() =>
                                  void saveIncome(row.programmeCode)
                                }
                              >
                                {savingIncomeCode === row.programmeCode
                                  ? t.loading
                                  : t.save}
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                disabled={exportingCode === row.programmeCode}
                                onClick={() =>
                                  void exportStudents(row.programmeCode)
                                }
                              >
                                {exportingCode === row.programmeCode
                                  ? t.loading
                                  : t.exportStudentListCsv}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 font-semibold">
                        <td colSpan={2}>{t.total}</td>
                        <td>{termFt}</td>
                        <td>{termPt}</td>
                        <td>{termFt + termPt}</td>
                        <td
                          colSpan={2}
                          className="text-xs font-normal text-slate-500"
                        >
                          {t.tuitionIncomeManualHint}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
