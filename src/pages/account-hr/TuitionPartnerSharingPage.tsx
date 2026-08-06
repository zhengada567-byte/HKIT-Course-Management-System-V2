import { useEffect, useMemo, useState } from "react";

import { DataTable } from "../../components/tables/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { isDegreeProgrammeType } from "../programme-leader/make-study-plan/helpers";
import { listProgrammes } from "../../services/programmeService";
import {
  countEnrolledFtStudentsForProgrammeTerm,
  deletePartnerSharingRecord,
  deleteTuitionIncome,
  getPartnerSharingFee,
  listPartnerSharingRecords,
  listTuitionIncome,
  upsertPartnerSharingRecord,
  upsertTuitionIncome,
  type PartnerSharingRecordRow,
  type TuitionIncomeRow,
} from "../../services/tuitionPartnerSharingService";
import type { ModuleTerm, ProgrammeRow } from "../../types";
import { ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR } from "./accountHrAcademicYear";
import { AccountHrAcademicYearSelect } from "./AccountHrAcademicYearSelect";

const TERM_OPTIONS: ModuleTerm[] = ["Sep", "Feb", "Jun"];

type TabKey = "tuition" | "partner";

function money(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function uniqueProgrammes(programmes: ProgrammeRow[]) {
  const byCode = new Map<string, ProgrammeRow>();
  for (const row of programmes) {
    const code = String(row.programme_code ?? "").trim().toUpperCase();
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, row);
  }
  return Array.from(byCode.values()).sort((a, b) =>
    String(a.programme_code).localeCompare(String(b.programme_code))
  );
}

export function TuitionPartnerSharingPage() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [academicYear, setAcademicYear] = useState(
    ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR
  );
  const [tab, setTab] = useState<TabKey>("tuition");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [tuitionRows, setTuitionRows] = useState<TuitionIncomeRow[]>([]);
  const [partnerRows, setPartnerRows] = useState<PartnerSharingRecordRow[]>(
    []
  );

  const [tuitionForm, setTuitionForm] = useState({
    id: "",
    programmeCode: "",
    moduleTerm: "Sep" as ModuleTerm,
    amount: "",
    notes: "",
  });

  const [partnerForm, setPartnerForm] = useState({
    id: "",
    programmeCode: "",
    moduleTerm: "Sep" as ModuleTerm,
    ftStudentCount: "",
    studyTerm: "",
    feePerStudent: "",
    notes: "",
  });
  const [loadingCount, setLoadingCount] = useState(false);

  const programmeOptions = useMemo(
    () => uniqueProgrammes(programmes),
    [programmes]
  );

  const selectedProgramme = useMemo(
    () =>
      programmeOptions.find(
        (row) =>
          String(row.programme_code).trim().toUpperCase() ===
          partnerForm.programmeCode
      ) ?? null,
    [programmeOptions, partnerForm.programmeCode]
  );

  const isDegree = isDegreeProgrammeType(selectedProgramme?.programme_type);
  const totalSharing = useMemo(() => {
    const count = Number(partnerForm.ftStudentCount || 0);
    const fee = Number(partnerForm.feePerStudent || 0);
    if (!Number.isFinite(count) || !Number.isFinite(fee)) return 0;
    return Math.round(count * fee * 100) / 100;
  }, [partnerForm.ftStudentCount, partnerForm.feePerStudent]);

  async function loadAll() {
    setLoading(true);
    setMessage("");
    const errors: string[] = [];

    try {
      const programmeRows = await listProgrammes();
      setProgrammes(programmeRows);
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "Failed to load programmes."
      );
    }

    try {
      const [tuition, partner] = await Promise.all([
        listTuitionIncome(academicYear),
        listPartnerSharingRecords(academicYear),
      ]);
      setTuitionRows(tuition);
      setPartnerRows(partner);
    } catch (error) {
      setTuitionRows([]);
      setPartnerRows([]);
      const detail =
        error instanceof Error ? error.message : "Failed to load records.";
      errors.push(
        /could not find the table|does not exist|schema cache/i.test(detail)
          ? `${detail} — please apply migration 054 on Supabase.`
          : detail
      );
    }

    if (errors.length > 0) setMessage(errors.join(" "));
    setLoading(false);
  }

  useEffect(() => {
    void loadAll();
    setTuitionForm({
      id: "",
      programmeCode: "",
      moduleTerm: "Sep",
      amount: "",
      notes: "",
    });
    setPartnerForm({
      id: "",
      programmeCode: "",
      moduleTerm: "Sep",
      ftStudentCount: "",
      studyTerm: "",
      feePerStudent: "",
      notes: "",
    });
  }, [academicYear]);

  async function loadFtCountAndFee(params: {
    programmeCode: string;
    moduleTerm: ModuleTerm;
  }) {
    if (!params.programmeCode) return;

    const programme = programmeOptions.find(
      (row) =>
        String(row.programme_code).trim().toUpperCase() === params.programmeCode
    );
    const degree = isDegreeProgrammeType(programme?.programme_type);

    setLoadingCount(true);
    setMessage("");

    try {
      const feeRow = await getPartnerSharingFee({
        academicYear,
        programmeCode: params.programmeCode,
      });

      let ftStudentCount = partnerForm.ftStudentCount;
      let studyTerm = partnerForm.studyTerm;

      if (degree) {
        const result = await countEnrolledFtStudentsForProgrammeTerm({
          programmeCode: params.programmeCode,
          academicYear,
          moduleTerm: params.moduleTerm,
        });
        ftStudentCount = String(result.count);
        studyTerm = result.studyTerm;
      }

      setPartnerForm((prev) => ({
        ...prev,
        programmeCode: params.programmeCode,
        moduleTerm: params.moduleTerm,
        ftStudentCount: degree ? ftStudentCount : prev.ftStudentCount,
        studyTerm: degree ? studyTerm : "",
        feePerStudent:
          feeRow != null ? String(feeRow.fee_per_student) : prev.feePerStudent,
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    } finally {
      setLoadingCount(false);
    }
  }

  async function saveTuition(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      await upsertTuitionIncome({
        id: tuitionForm.id || undefined,
        academicYear,
        programmeCode: tuitionForm.programmeCode,
        moduleTerm: tuitionForm.moduleTerm,
        amount: tuitionForm.amount,
        notes: tuitionForm.notes,
        updatedBy: user?.id ?? null,
      });
      setTuitionForm({
        id: "",
        programmeCode: "",
        moduleTerm: "Sep",
        amount: "",
        notes: "",
      });
      await loadAll();
      setMessage(t.tuitionIncomeSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function savePartner(event: React.FormEvent) {
    event.preventDefault();
    if (!partnerForm.programmeCode) {
      setMessage(t.selectProgrammeRequiredShort);
      return;
    }
    if (isDegree && !partnerForm.moduleTerm) {
      setMessage(t.selectTermRequired);
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      await upsertPartnerSharingRecord({
        id: partnerForm.id || undefined,
        academicYear,
        programmeCode: partnerForm.programmeCode,
        moduleTerm: isDegree ? partnerForm.moduleTerm : partnerForm.moduleTerm,
        studyTerm: partnerForm.studyTerm || null,
        ftStudentCount: partnerForm.ftStudentCount || "0",
        feePerStudent: partnerForm.feePerStudent || "0",
        notes: partnerForm.notes,
        updatedBy: user?.id ?? null,
      });
      setPartnerForm({
        id: "",
        programmeCode: "",
        moduleTerm: "Sep",
        ftStudentCount: "",
        studyTerm: "",
        feePerStudent: "",
        notes: "",
      });
      await loadAll();
      setMessage(t.partnerSharingSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "tuition", label: t.tuitionIncomeTitle },
    { key: "partner", label: t.partnerSharingTitle },
  ];

  return (
    <div className="page-container">
      <PageHeader
        title={t.tuitionPartnerSharingTitle}
        description={t.tuitionPartnerSharingDescription}
      />

      <div className="mb-4 card">
        <div className="card-body">
          <AccountHrAcademicYearSelect
            label={t.academicYear}
            value={academicYear}
            onChange={setAcademicYear}
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
              tab === item.key
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
            onClick={() => {
              setTab(item.key);
              setMessage("");
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : tab === "tuition" ? (
        <div className="space-y-4">
          <form className="card" onSubmit={saveTuition}>
            <div className="card-body grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div>
                <label className="form-label">{t.programmeCode}</label>
                <select
                  className="form-select"
                  value={tuitionForm.programmeCode}
                  onChange={(event) =>
                    setTuitionForm((prev) => ({
                      ...prev,
                      programmeCode: event.target.value,
                    }))
                  }
                  required
                >
                  <option value="">{t.selectProgramme}</option>
                  {programmeOptions.map((row) => (
                    <option
                      key={row.programme_code}
                      value={String(row.programme_code).trim().toUpperCase()}
                    >
                      {String(row.programme_code).trim().toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">{t.term}</label>
                <select
                  className="form-select"
                  value={tuitionForm.moduleTerm}
                  onChange={(event) =>
                    setTuitionForm((prev) => ({
                      ...prev,
                      moduleTerm: event.target.value as ModuleTerm,
                    }))
                  }
                >
                  {TERM_OPTIONS.map((term) => (
                    <option key={term} value={term}>
                      {term}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">{t.tuitionIncomeAmount}</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={tuitionForm.amount}
                  onChange={(event) =>
                    setTuitionForm((prev) => ({
                      ...prev,
                      amount: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div>
                <label className="form-label">{t.notes}</label>
                <input
                  className="form-input"
                  value={tuitionForm.notes}
                  onChange={(event) =>
                    setTuitionForm((prev) => ({
                      ...prev,
                      notes: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? t.loading : t.save}
                </button>
                {tuitionForm.id && (
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() =>
                      setTuitionForm({
                        id: "",
                        programmeCode: "",
                        moduleTerm: "Sep",
                        amount: "",
                        notes: "",
                      })
                    }
                  >
                    {t.cancel}
                  </button>
                )}
              </div>
            </div>
          </form>

          {tuitionRows.length === 0 ? (
            <EmptyState message={t.noTuitionIncomeYet} />
          ) : (
            <DataTable
              rowKey={(row) => row.id}
              rows={tuitionRows}
              columns={[
                {
                  key: "programme",
                  header: t.programmeCode,
                  render: (row) => row.programme_code,
                },
                {
                  key: "term",
                  header: t.term,
                  render: (row) => row.module_term,
                },
                {
                  key: "amount",
                  header: t.tuitionIncomeAmount,
                  render: (row) => money(row.amount),
                },
                {
                  key: "notes",
                  header: t.notes,
                  render: (row) => row.notes ?? "-",
                },
                {
                  key: "actions",
                  header: t.actions,
                  render: (row) => (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() =>
                          setTuitionForm({
                            id: row.id,
                            programmeCode: row.programme_code,
                            moduleTerm: row.module_term,
                            amount: String(row.amount),
                            notes: row.notes ?? "",
                          })
                        }
                      >
                        {t.edit}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={async () => {
                          if (!window.confirm(t.confirmDeleteTuitionIncome)) {
                            return;
                          }
                          try {
                            await deleteTuitionIncome(row.id);
                            await loadAll();
                          } catch (error) {
                            setMessage(
                              error instanceof Error
                                ? error.message
                                : "Delete failed"
                            );
                          }
                        }}
                      >
                        {t.delete}
                      </button>
                    </div>
                  ),
                },
              ]}
            />
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t.partnerSharingHint}</p>
          <form className="card" onSubmit={savePartner}>
            <div className="card-body grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="form-label">{t.programmeCode}</label>
                <select
                  className="form-select"
                  value={partnerForm.programmeCode}
                  onChange={(event) => {
                    const programmeCode = event.target.value;
                    setPartnerForm((prev) => ({
                      ...prev,
                      programmeCode,
                      ftStudentCount: "",
                      studyTerm: "",
                    }));
                    if (programmeCode) {
                      void loadFtCountAndFee({
                        programmeCode,
                        moduleTerm: partnerForm.moduleTerm,
                      });
                    }
                  }}
                  required
                >
                  <option value="">{t.selectProgramme}</option>
                  {programmeOptions.map((row) => (
                    <option
                      key={row.programme_code}
                      value={String(row.programme_code)
                        .trim()
                        .toUpperCase()}
                    >
                      {String(row.programme_code).trim().toUpperCase()}
                      {row.programme_type
                        ? ` (${row.programme_type})`
                        : ""}
                    </option>
                  ))}
                </select>
              </div>

              {isDegree ? (
                <div>
                  <label className="form-label">{t.term}</label>
                  <select
                    className="form-select"
                    value={partnerForm.moduleTerm}
                    onChange={(event) => {
                      const moduleTerm = event.target.value as ModuleTerm;
                      setPartnerForm((prev) => ({ ...prev, moduleTerm }));
                      if (partnerForm.programmeCode) {
                        void loadFtCountAndFee({
                          programmeCode: partnerForm.programmeCode,
                          moduleTerm,
                        });
                      }
                    }}
                  >
                    {TERM_OPTIONS.map((term) => (
                      <option key={term} value={term}>
                        {term}
                      </option>
                    ))}
                  </select>
                  {partnerForm.studyTerm ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {t.studyTerm}: {partnerForm.studyTerm}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 md:col-span-1">
                  {partnerForm.programmeCode
                    ? t.partnerSharingDegreeOnlyHint
                    : t.selectProgrammeRequiredShort}
                </div>
              )}

              <div>
                <label className="form-label">{t.ftEnrolledStudentCount}</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  step="1"
                  value={partnerForm.ftStudentCount}
                  onChange={(event) =>
                    setPartnerForm((prev) => ({
                      ...prev,
                      ftStudentCount: event.target.value,
                    }))
                  }
                  disabled={loadingCount || (isDegree && !partnerForm.programmeCode)}
                  required={isDegree}
                />
                {loadingCount ? (
                  <p className="mt-1 text-xs text-slate-500">{t.loading}</p>
                ) : null}
              </div>

              <div>
                <label className="form-label">{t.sharingFeePerStudent}</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={partnerForm.feePerStudent}
                  onChange={(event) =>
                    setPartnerForm((prev) => ({
                      ...prev,
                      feePerStudent: event.target.value,
                    }))
                  }
                  required
                />
                <p className="mt-1 text-xs text-slate-500">
                  {t.sharingFeePerStudentHint}
                </p>
              </div>

              <div>
                <label className="form-label">{t.totalSharingFee}</label>
                <div className="form-input bg-slate-50 font-semibold">
                  {money(totalSharing)}
                </div>
              </div>

              <div>
                <label className="form-label">{t.notes}</label>
                <input
                  className="form-input"
                  value={partnerForm.notes}
                  onChange={(event) =>
                    setPartnerForm((prev) => ({
                      ...prev,
                      notes: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="flex items-end gap-2">
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={saving || !partnerForm.programmeCode || !isDegree}
                >
                  {saving ? t.loading : t.save}
                </button>
                {partnerForm.id && (
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() =>
                      setPartnerForm({
                        id: "",
                        programmeCode: "",
                        moduleTerm: "Sep",
                        ftStudentCount: "",
                        studyTerm: "",
                        feePerStudent: "",
                        notes: "",
                      })
                    }
                  >
                    {t.cancel}
                  </button>
                )}
              </div>
            </div>
          </form>

          {partnerRows.length === 0 ? (
            <EmptyState message={t.noPartnerSharingYet} />
          ) : (
            <DataTable
              rowKey={(row) => row.id}
              rows={partnerRows}
              columns={[
                {
                  key: "programme",
                  header: t.programmeCode,
                  render: (row) => row.programme_code,
                },
                {
                  key: "term",
                  header: t.term,
                  render: (row) => row.module_term,
                },
                {
                  key: "studyTerm",
                  header: t.studyTerm,
                  render: (row) => row.study_term ?? "-",
                },
                {
                  key: "count",
                  header: t.ftEnrolledStudentCount,
                  render: (row) => row.ft_student_count,
                },
                {
                  key: "fee",
                  header: t.sharingFeePerStudent,
                  render: (row) => money(row.fee_per_student),
                },
                {
                  key: "total",
                  header: t.totalSharingFee,
                  render: (row) => money(row.total_sharing_fee),
                },
                {
                  key: "actions",
                  header: t.actions,
                  render: (row) => (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() =>
                          setPartnerForm({
                            id: row.id,
                            programmeCode: row.programme_code,
                            moduleTerm: row.module_term,
                            ftStudentCount: String(row.ft_student_count),
                            studyTerm: row.study_term ?? "",
                            feePerStudent: String(row.fee_per_student),
                            notes: row.notes ?? "",
                          })
                        }
                      >
                        {t.edit}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={async () => {
                          if (!window.confirm(t.confirmDeletePartnerSharing)) {
                            return;
                          }
                          try {
                            await deletePartnerSharingRecord(row.id);
                            await loadAll();
                          } catch (error) {
                            setMessage(
                              error instanceof Error
                                ? error.message
                                : "Delete failed"
                            );
                          }
                        }}
                      >
                        {t.delete}
                      </button>
                    </div>
                  ),
                },
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
}
