import { useEffect, useMemo, useState } from "react";

import { DataTable } from "../../components/tables/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { isDegreeProgrammeType } from "../programme-leader/make-study-plan/helpers";
import { listProgrammes } from "../../services/programmeService";
import { getProgrammeTuitionFee } from "../../services/tuitionSummaryService";
import { loadProgrammeStudentBreakdown } from "../../services/tuitionSummaryService";
import {
  calculateFluSharingTotal,
  calculatePartnerIndividualTotal,
  countEnrolledFtStudentsForProgrammeTerm,
  deletePartnerSharingRecord,
  deletePartnerSharingSpecialRecord,
  getPartnerSharingFee,
  isFluSharingProgramme,
  isPartnerIndividualProgramme,
  listPartnerSharingFees,
  listPartnerSharingRecords,
  listPartnerSharingSpecialRecords,
  PARTNER_U_FEE_GROUPS,
  resolvePartnerUFeeGroup,
  upsertPartnerSharingFee,
  upsertPartnerSharingRecord,
  upsertPartnerSharingSpecialRecord,
  type PartnerSharingRecordRow,
  type PartnerSharingSpecialRow,
  type PartnerUFeeGroupKey,
} from "../../services/tuitionPartnerSharingService";
import type { ModuleTerm, ProgrammeRow } from "../../types";
import { ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR } from "./accountHrAcademicYear";
import { AccountHrAcademicYearSelect } from "./AccountHrAcademicYearSelect";

const TERM_OPTIONS: ModuleTerm[] = ["Sep", "Feb", "Jun"];

type TabKey = "partner_u" | "partner_individual" | "flu";

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

export function PartnerSharingPage() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [academicYear, setAcademicYear] = useState(
    ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR
  );
  const [tab, setTab] = useState<TabKey>("partner_u");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [partnerURows, setPartnerURows] = useState<PartnerSharingRecordRow[]>(
    []
  );
  const [specialRows, setSpecialRows] = useState<PartnerSharingSpecialRow[]>(
    []
  );
  const [feeByGroup, setFeeByGroup] = useState<
    Record<PartnerUFeeGroupKey, string>
  >({ UWL: "", WU: "" });
  const [savingFeeCode, setSavingFeeCode] = useState<string | null>(null);

  const [partnerUForm, setPartnerUForm] = useState({
    id: "",
    programmeCode: "",
    moduleTerm: "Sep" as ModuleTerm,
    ftStudentCount: "",
    studyTerm: "",
    feePerStudent: "",
    notes: "",
  });
  const [loadingCount, setLoadingCount] = useState(false);

  const [specialForm, setSpecialForm] = useState({
    id: "",
    programmeCode: "",
    studentCount: "",
    tuitionFee: "",
    partnerUFee: "",
    teacherCost: "",
    labCost: "",
    otherCost: "",
    notes: "",
  });

  const programmeOptions = useMemo(
    () => uniqueProgrammes(programmes),
    [programmes]
  );

  const degreeProgrammes = useMemo(
    () =>
      programmeOptions.filter((row) =>
        isDegreeProgrammeType(row.programme_type)
      ),
    [programmeOptions]
  );

  const uwlcfiOptions = useMemo(
    () =>
      programmeOptions.filter((row) =>
        isPartnerIndividualProgramme(String(row.programme_code))
      ),
    [programmeOptions]
  );

  const fluOptions = useMemo(
    () =>
      programmeOptions.filter((row) =>
        isFluSharingProgramme(String(row.programme_code))
      ),
    [programmeOptions]
  );

  const partnerUTotal = useMemo(() => {
    const n = Number(partnerUForm.ftStudentCount || 0);
    const fee = Number(partnerUForm.feePerStudent || 0);
    return Number.isFinite(n) && Number.isFinite(fee)
      ? Math.round(n * fee * 100) / 100
      : 0;
  }, [partnerUForm.ftStudentCount, partnerUForm.feePerStudent]);

  const specialTotal = useMemo(() => {
    const studentCount = Number(specialForm.studentCount || 0);
    const tuitionFeePerStudent = Number(specialForm.tuitionFee || 0);
    const teacherCost = Number(specialForm.teacherCost || 0);
    const labTechnicianCost = Number(specialForm.labCost || 0);
    const otherCost = Number(specialForm.otherCost || 0);
    if (tab === "flu") {
      return calculateFluSharingTotal({
        studentCount,
        tuitionFeePerStudent,
        teacherCost,
        labTechnicianCost,
        otherCost,
      });
    }
    return calculatePartnerIndividualTotal({
      studentCount,
      tuitionFeePerStudent,
      partnerUFeePerStudent: Number(specialForm.partnerUFee || 0),
      teacherCost,
    });
  }, [specialForm, tab]);

  async function loadAll() {
    setLoading(true);
    setMessage("");
    const errors: string[] = [];

    try {
      setProgrammes(await listProgrammes());
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "Failed to load programmes."
      );
    }

    try {
      const [partnerU, special, fees] = await Promise.all([
        listPartnerSharingRecords(academicYear),
        listPartnerSharingSpecialRecords(academicYear),
        listPartnerSharingFees(academicYear),
      ]);
      setPartnerURows(partnerU);
      setSpecialRows(special);
      const nextFees: Record<PartnerUFeeGroupKey, string> = {
        UWL: "",
        WU: "",
      };
      for (const row of fees) {
        const code = String(row.programme_code ?? "")
          .trim()
          .toUpperCase();
        if (code === "UWL" || code === "WU") {
          nextFees[code] = String(row.fee_per_student);
        }
      }
      setFeeByGroup(nextFees);
    } catch (error) {
      setPartnerURows([]);
      setSpecialRows([]);
      setFeeByGroup({ UWL: "", WU: "" });
      const detail =
        error instanceof Error ? error.message : "Failed to load records.";
      errors.push(
        /could not find the table|does not exist|schema cache/i.test(detail)
          ? `${detail} — please apply migrations 054/056 on Supabase.`
          : detail
      );
    }

    if (errors.length > 0) setMessage(errors.join(" "));
    setLoading(false);
  }

  useEffect(() => {
    void loadAll();
    setPartnerUForm({
      id: "",
      programmeCode: "",
      moduleTerm: "Sep",
      ftStudentCount: "",
      studyTerm: "",
      feePerStudent: "",
      notes: "",
    });
    setSpecialForm({
      id: "",
      programmeCode: "",
      studentCount: "",
      tuitionFee: "",
      partnerUFee: "",
      teacherCost: "",
      labCost: "",
      otherCost: "",
      notes: "",
    });
  }, [academicYear]);

  async function loadPartnerUCounts(params: {
    programmeCode: string;
    moduleTerm: ModuleTerm;
  }) {
    if (!params.programmeCode) return;
    setLoadingCount(true);
    setMessage("");
    try {
      const [feeRow, enrolled] = await Promise.all([
        getPartnerSharingFee({
          academicYear,
          programmeCode: params.programmeCode,
        }),
        countEnrolledFtStudentsForProgrammeTerm({
          programmeCode: params.programmeCode,
          academicYear,
          moduleTerm: params.moduleTerm,
        }),
      ]);
      const loadedFee =
        feeRow != null
          ? String(feeRow.fee_per_student)
          : (() => {
              const group = resolvePartnerUFeeGroup(params.programmeCode);
              return group ? feeByGroup[group] : "";
            })();
      setPartnerUForm((prev) => ({
        ...prev,
        programmeCode: params.programmeCode,
        moduleTerm: params.moduleTerm,
        ftStudentCount: String(enrolled.count),
        studyTerm: enrolled.studyTerm,
        feePerStudent: loadedFee,
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    } finally {
      setLoadingCount(false);
    }
  }

  async function savePartnerUFee(groupKey: PartnerUFeeGroupKey) {
    const fee = feeByGroup[groupKey] ?? "";
    if (!fee.trim()) {
      setMessage(t.partnerSharingFeeRequired);
      return;
    }
    setSavingFeeCode(groupKey);
    setMessage("");
    try {
      await upsertPartnerSharingFee({
        academicYear,
        programmeCode: groupKey,
        feePerStudent: fee,
        updatedBy: user?.id ?? null,
      });
      setMessage(t.partnerSharingFeeSaved);
      const selectedGroup = resolvePartnerUFeeGroup(
        partnerUForm.programmeCode
      );
      if (selectedGroup === groupKey) {
        setPartnerUForm((prev) => ({ ...prev, feePerStudent: fee }));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSavingFeeCode(null);
    }
  }

  async function loadSpecialInputs(programmeCode: string) {
    if (!programmeCode) return;
    setLoadingCount(true);
    setMessage("");
    try {
      const [breakdown, tuition, partnerU] = await Promise.all([
        loadProgrammeStudentBreakdown(programmeCode),
        getProgrammeTuitionFee({ academicYear, programmeCode }),
        tab === "flu"
          ? Promise.resolve(null)
          : getPartnerSharingFee({ academicYear, programmeCode }),
      ]);
      setSpecialForm((prev) => ({
        ...prev,
        programmeCode,
        studentCount: String(breakdown.total),
        tuitionFee:
          tuition != null
            ? String(tuition.tuition_fee_per_student)
            : prev.tuitionFee,
        partnerUFee:
          tab === "flu"
            ? "0"
            : partnerU != null
              ? String(partnerU.fee_per_student)
              : prev.partnerUFee,
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    } finally {
      setLoadingCount(false);
    }
  }

  async function savePartnerU(event: React.FormEvent) {
    event.preventDefault();
    if (!partnerUForm.programmeCode) {
      setMessage(t.selectProgrammeRequiredShort);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await upsertPartnerSharingRecord({
        id: partnerUForm.id || undefined,
        academicYear,
        programmeCode: partnerUForm.programmeCode,
        moduleTerm: partnerUForm.moduleTerm,
        studyTerm: partnerUForm.studyTerm || null,
        ftStudentCount: partnerUForm.ftStudentCount || "0",
        feePerStudent: partnerUForm.feePerStudent || "0",
        notes: partnerUForm.notes,
        updatedBy: user?.id ?? null,
      });
      setPartnerUForm({
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

  async function saveSpecial(event: React.FormEvent) {
    event.preventDefault();
    if (!specialForm.programmeCode) {
      setMessage(t.selectProgrammeRequiredShort);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await upsertPartnerSharingSpecialRecord({
        id: specialForm.id || undefined,
        academicYear,
        programmeCode: specialForm.programmeCode,
        sharingType: tab === "flu" ? "flu" : "partner_individual",
        studentCount: specialForm.studentCount || "0",
        tuitionFeePerStudent: specialForm.tuitionFee || "0",
        partnerUFeePerStudent:
          tab === "flu" ? "0" : specialForm.partnerUFee || "0",
        teacherCost: specialForm.teacherCost || "0",
        labTechnicianCost: specialForm.labCost || "0",
        otherCost: specialForm.otherCost || "0",
        notes: specialForm.notes,
        updatedBy: user?.id ?? null,
      });
      setSpecialForm({
        id: "",
        programmeCode: "",
        studentCount: "",
        tuitionFee: "",
        partnerUFee: "",
        teacherCost: "",
        labCost: "",
        otherCost: "",
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
    { key: "partner_u", label: t.sharingToPartnerU },
    { key: "partner_individual", label: t.sharingToPartnerIndividual },
    { key: "flu", label: t.sharingToFlu },
  ];

  const filteredSpecial = specialRows.filter((row) =>
    tab === "flu"
      ? row.sharing_type === "flu"
      : row.sharing_type === "partner_individual"
  );

  return (
    <div className="page-container">
      <PageHeader
        title={t.partnerSharingPageTitle}
        description={t.partnerSharingPageDescription}
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
              setSpecialForm({
                id: "",
                programmeCode: "",
                studentCount: "",
                tuitionFee: "",
                partnerUFee: "",
                teacherCost: "",
                labCost: "",
                otherCost: "",
                notes: "",
              });
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
      ) : tab === "partner_u" ? (
        <div className="space-y-6">
          <p className="text-sm text-slate-600">{t.partnerSharingHint}</p>

          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-slate-800">
                {t.partnerSharingFeeSection}
              </h2>
              <p className="text-sm text-slate-600">
                {t.partnerSharingFeeSectionHint}
              </p>
            </div>
            {degreeProgrammes.length === 0 ? (
              <EmptyState message={t.partnerSharingDegreeOnlyHint} />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-medium">
                        {t.partnerSharingFeeGroup}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t.sharingFeePerStudent}
                      </th>
                      <th className="px-3 py-2 font-medium">{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PARTNER_U_FEE_GROUPS.map((group) => (
                      <tr
                        key={group.key}
                        className="border-t border-slate-100"
                      >
                        <td className="px-3 py-2 text-slate-800">
                          <div className="font-medium">
                            {group.key === "UWL"
                              ? t.partnerSharingFeeGroupUwl
                              : t.partnerSharingFeeGroupWu}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {group.key}*
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="form-input max-w-[12rem]"
                            type="number"
                            min="0"
                            step="0.01"
                            value={feeByGroup[group.key]}
                            onChange={(event) =>
                              setFeeByGroup((prev) => ({
                                ...prev,
                                [group.key]: event.target.value,
                              }))
                            }
                            placeholder="0.00"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={savingFeeCode === group.key}
                            onClick={() => void savePartnerUFee(group.key)}
                          >
                            {savingFeeCode === group.key
                              ? t.loading
                              : t.save}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-slate-800">
                {t.partnerSharingCalcSection}
              </h2>
              <p className="text-sm text-slate-600">
                {t.partnerSharingCalcSectionHint}
              </p>
            </div>
            <form className="card" onSubmit={savePartnerU}>
              <div className="card-body grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div>
                  <label className="form-label">{t.programmeCode}</label>
                  <select
                    className="form-select"
                    value={partnerUForm.programmeCode}
                    onChange={(event) => {
                      const programmeCode = event.target.value;
                      setPartnerUForm((prev) => ({
                        ...prev,
                        programmeCode,
                        ftStudentCount: "",
                        studyTerm: "",
                        feePerStudent: "",
                      }));
                      if (programmeCode) {
                        void loadPartnerUCounts({
                          programmeCode,
                          moduleTerm: partnerUForm.moduleTerm,
                        });
                      }
                    }}
                    required
                  >
                    <option value="">{t.selectProgramme}</option>
                    {degreeProgrammes.map((row) => (
                      <option
                        key={row.programme_code}
                        value={String(row.programme_code)
                          .trim()
                          .toUpperCase()}
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
                    value={partnerUForm.moduleTerm}
                    onChange={(event) => {
                      const moduleTerm = event.target.value as ModuleTerm;
                      setPartnerUForm((prev) => ({ ...prev, moduleTerm }));
                      if (partnerUForm.programmeCode) {
                        void loadPartnerUCounts({
                          programmeCode: partnerUForm.programmeCode,
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
                  {partnerUForm.studyTerm ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {t.studyTerm}: {partnerUForm.studyTerm}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="form-label">{t.ftEnrolledStudentCount}</label>
                  <input
                    className="form-input"
                    type="number"
                    min="0"
                    value={partnerUForm.ftStudentCount}
                    onChange={(event) =>
                      setPartnerUForm((prev) => ({
                        ...prev,
                        ftStudentCount: event.target.value,
                      }))
                    }
                    required
                  />
                  {loadingCount ? (
                    <p className="mt-1 text-xs text-slate-500">{t.loading}</p>
                  ) : null}
                </div>
                <div>
                  <label className="form-label">{t.sharingFeePerStudent}</label>
                  <div className="flex gap-2">
                    <input
                      className="form-input bg-slate-50"
                      type="number"
                      min="0"
                      step="0.01"
                      value={partnerUForm.feePerStudent}
                      readOnly
                      required
                    />
                    <button
                      type="button"
                      className="btn btn-secondary whitespace-nowrap"
                      disabled={!partnerUForm.programmeCode || loadingCount}
                      onClick={() => {
                        if (!partnerUForm.programmeCode) return;
                        void loadPartnerUCounts({
                          programmeCode: partnerUForm.programmeCode,
                          moduleTerm: partnerUForm.moduleTerm,
                        });
                      }}
                    >
                      {t.loadSavedSharingFee}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {t.sharingFeePerStudentHint}
                  </p>
                </div>
                <div>
                  <label className="form-label">{t.totalSharingFee}</label>
                  <div className="form-input bg-slate-50 font-semibold">
                    {money(partnerUTotal)}
                  </div>
                </div>
                <div className="flex items-end">
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={saving || !partnerUForm.feePerStudent}
                  >
                    {saving ? t.loading : t.save}
                  </button>
                </div>
              </div>
            </form>

            {partnerURows.length === 0 ? (
              <EmptyState message={t.noPartnerSharingYet} />
            ) : (
              <DataTable
                rowKey={(row) => row.id}
                rows={partnerURows}
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
                            setPartnerUForm({
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
                            if (
                              !window.confirm(t.confirmDeletePartnerSharing)
                            ) {
                              return;
                            }
                            await deletePartnerSharingRecord(row.id);
                            await loadAll();
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
          </section>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {tab === "flu" ? t.fluSharingFormulaHint : t.individualSharingFormulaHint}
          </p>
          <form className="card" onSubmit={saveSpecial}>
            <div className="card-body grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="form-label">{t.programmeCode}</label>
                <select
                  className="form-select"
                  value={specialForm.programmeCode}
                  onChange={(event) => {
                    const programmeCode = event.target.value;
                    setSpecialForm((prev) => ({
                      ...prev,
                      programmeCode,
                    }));
                    if (programmeCode) void loadSpecialInputs(programmeCode);
                  }}
                  required
                >
                  <option value="">{t.selectProgramme}</option>
                  {(tab === "flu" ? fluOptions : uwlcfiOptions).map((row) => (
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
                <label className="form-label">{t.studentHeadcount}</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  value={specialForm.studentCount}
                  onChange={(event) =>
                    setSpecialForm((prev) => ({
                      ...prev,
                      studentCount: event.target.value,
                    }))
                  }
                  required
                />
                {loadingCount ? (
                  <p className="mt-1 text-xs text-slate-500">{t.loading}</p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    {t.studentHeadcountHint}
                  </p>
                )}
              </div>
              <div>
                <label className="form-label">{t.programmeTuitionFeePerStudent}</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={specialForm.tuitionFee}
                  onChange={(event) =>
                    setSpecialForm((prev) => ({
                      ...prev,
                      tuitionFee: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              {tab !== "flu" ? (
                <div>
                  <label className="form-label">{t.partnerUFeePerStudent}</label>
                  <input
                    className="form-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={specialForm.partnerUFee}
                    onChange={(event) =>
                      setSpecialForm((prev) => ({
                        ...prev,
                        partnerUFee: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
              ) : null}
              <div>
                <label className="form-label">{t.teacherCost}</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={specialForm.teacherCost}
                  onChange={(event) =>
                    setSpecialForm((prev) => ({
                      ...prev,
                      teacherCost: event.target.value,
                    }))
                  }
                />
              </div>
              {tab === "flu" ? (
                <>
                  <div>
                    <label className="form-label">{t.labTechnicianCost}</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={specialForm.labCost}
                      onChange={(event) =>
                        setSpecialForm((prev) => ({
                          ...prev,
                          labCost: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.otherCost}</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={specialForm.otherCost}
                      onChange={(event) =>
                        setSpecialForm((prev) => ({
                          ...prev,
                          otherCost: event.target.value,
                        }))
                      }
                    />
                  </div>
                </>
              ) : null}
              <div>
                <label className="form-label">{t.totalSharingFee}</label>
                <div className="form-input bg-slate-50 font-semibold">
                  {money(specialTotal)}
                </div>
              </div>
              <div className="flex items-end">
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? t.loading : t.save}
                </button>
              </div>
            </div>
          </form>

          {filteredSpecial.length === 0 ? (
            <EmptyState message={t.noPartnerSharingYet} />
          ) : (
            <DataTable
              rowKey={(row) => row.id}
              rows={filteredSpecial}
              columns={[
                {
                  key: "programme",
                  header: t.programmeCode,
                  render: (row) => row.programme_code,
                },
                {
                  key: "count",
                  header: t.studentHeadcount,
                  render: (row) => row.student_count,
                },
                {
                  key: "tuition",
                  header: t.programmeTuitionFeePerStudent,
                  render: (row) => money(row.tuition_fee_per_student),
                },
                ...(tab !== "flu"
                  ? [
                      {
                        key: "partnerU",
                        header: t.partnerUFeePerStudent,
                        render: (row: PartnerSharingSpecialRow) =>
                          money(row.partner_u_fee_per_student),
                      },
                    ]
                  : []),
                {
                  key: "teacher",
                  header: t.teacherCost,
                  render: (row) => money(row.teacher_cost),
                },
                ...(tab === "flu"
                  ? [
                      {
                        key: "lab",
                        header: t.labTechnicianCost,
                        render: (row: PartnerSharingSpecialRow) =>
                          money(row.lab_technician_cost),
                      },
                      {
                        key: "other",
                        header: t.otherCost,
                        render: (row: PartnerSharingSpecialRow) =>
                          money(row.other_cost),
                      },
                    ]
                  : []),
                {
                  key: "total",
                  header: t.totalSharingFee,
                  render: (row) => money(row.calculated_total),
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
                          setSpecialForm({
                            id: row.id,
                            programmeCode: row.programme_code,
                            studentCount: String(row.student_count),
                            tuitionFee: String(row.tuition_fee_per_student),
                            partnerUFee: String(row.partner_u_fee_per_student),
                            teacherCost: String(row.teacher_cost),
                            labCost: String(row.lab_technician_cost),
                            otherCost: String(row.other_cost),
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
                          await deletePartnerSharingSpecialRecord(row.id);
                          await loadAll();
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
