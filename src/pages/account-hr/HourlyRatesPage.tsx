import { useEffect, useMemo, useState } from "react";

import { DataTable } from "../../components/tables/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { PROGRAMME_YEAR_OPTIONS } from "../../lib/programmeYear";
import { teacherDisplayNameFromRow } from "../../lib/utils";
import {
  deleteProgrammeHourlyRate,
  deleteSpecialHourlyRate,
  deleteTeacherHourlyRate,
  listProgrammeHourlyRates,
  listSpecialHourlyRates,
  listTeacherHourlyRates,
  upsertProgrammeHourlyRate,
  upsertSpecialHourlyRate,
  upsertTeacherHourlyRate,
  type ProgrammeHourlyRateRow,
  type SpecialHourlyRateRow,
  type TeacherHourlyRateRow,
} from "../../services/hourlyRateService";
import { calculatePtTeachingCosts, type PtTeachingCostLine } from "../../services/ptTeachingCostService";
import {
  calculatePtSupervisorTotal,
  deletePtSupervisorFee,
  listPtSupervisorFees,
  PT_SUPERVISOR_AMOUNT_PER_STUDENT,
  upsertPtSupervisorFee,
  type PtSupervisorFeeRow,
} from "../../services/ptSupervisorFeeService";
import { listProgrammes } from "../../services/programmeService";
import { listTeachers } from "../../services/teacherService";
import type { EmploymentType, ModuleTerm, ProgrammeRow, TeacherRow } from "../../types";
import { ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR } from "./accountHrAcademicYear";
import { AccountHrAcademicYearSelect } from "./AccountHrAcademicYearSelect";

type PageTabKey = "rates" | "teaching" | "supervisor";
type RatesTabKey = "programme" | "special" | "teacher";

const TERM_OPTIONS: ModuleTerm[] = ["Sep", "Feb", "Jun"];

function money(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function uniqueProgrammeCodes(programmes: ProgrammeRow[]) {
  return Array.from(
    new Set(
      programmes
        .map((row) => String(row.programme_code ?? "").trim().toUpperCase())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

export function HourlyRatesPage() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [academicYear, setAcademicYear] = useState(
    ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR
  );
  const [pageTab, setPageTab] = useState<PageTabKey>("rates");
  const [ratesTab, setRatesTab] = useState<RatesTabKey>("programme");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [programmeRates, setProgrammeRates] = useState<ProgrammeHourlyRateRow[]>(
    []
  );
  const [specialRates, setSpecialRates] = useState<SpecialHourlyRateRow[]>([]);
  const [teacherRates, setTeacherRates] = useState<TeacherHourlyRateRow[]>([]);

  const [teachingTerm, setTeachingTerm] = useState<"All" | ModuleTerm>("All");
  const [teachingProgramme, setTeachingProgramme] = useState("");
  const [teachingLoading, setTeachingLoading] = useState(false);
  const [teachingLines, setTeachingLines] = useState<PtTeachingCostLine[]>([]);
  const [teachingTotal, setTeachingTotal] = useState(0);
  const [teachingMissingRates, setTeachingMissingRates] = useState(0);

  const [supervisorTerm, setSupervisorTerm] = useState<ModuleTerm>("Sep");
  const [supervisorProgramme, setSupervisorProgramme] = useState("");
  const [supervisorRows, setSupervisorRows] = useState<PtSupervisorFeeRow[]>(
    []
  );
  const [supervisorForm, setSupervisorForm] = useState({
    id: "",
    supervisorName: "",
    studentCount: "",
    notes: "",
  });

  const [programmeForm, setProgrammeForm] = useState({
    id: "" as string,
    programmeCode: "",
    programmeYear: "Y1",
    hourlyRate: "",
    notes: "",
  });
  const [specialForm, setSpecialForm] = useState({
    id: "" as string,
    rateName: "",
    programmeCode: "",
    hourlyRate: "",
    notes: "",
  });
  const [teacherForm, setTeacherForm] = useState({
    id: "" as string,
    teacherName: "",
    employmentType: "" as EmploymentType | "",
    employmentFilter: "ALL" as "ALL" | EmploymentType,
    hourlyRate: "",
    notes: "",
  });

  const programmeCodes = useMemo(
    () => uniqueProgrammeCodes(programmes),
    [programmes]
  );

  const filteredTeachers = useMemo(() => {
    return teachers
      .filter((row) => {
        if (teacherForm.employmentFilter === "ALL") return true;
        return (
          String(row.employment_type ?? "").toUpperCase() ===
          teacherForm.employmentFilter
        );
      })
      .slice()
      .sort((a, b) =>
        teacherDisplayNameFromRow(a).localeCompare(
          teacherDisplayNameFromRow(b)
        )
      );
  }, [teachers, teacherForm.employmentFilter]);

  const ptTeachers = useMemo(() => {
    return teachers
      .filter(
        (row) => String(row.employment_type ?? "").toUpperCase() === "PT"
      )
      .slice()
      .sort((a, b) =>
        teacherDisplayNameFromRow(a).localeCompare(
          teacherDisplayNameFromRow(b)
        )
      );
  }, [teachers]);

  const supervisorTotal = useMemo(
    () =>
      supervisorRows.reduce(
        (sum, row) => sum + (Number(row.total_amount) || 0),
        0
      ),
    [supervisorRows]
  );

  const supervisorFormTotal = useMemo(
    () =>
      calculatePtSupervisorTotal({
        studentCount: Number(supervisorForm.studentCount || 0),
      }),
    [supervisorForm.studentCount]
  );

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
      const teacherRows = await listTeachers(academicYear);
      setTeachers(teacherRows);
    } catch (error) {
      setTeachers([]);
      errors.push(
        error instanceof Error ? error.message : "Failed to load teachers."
      );
    }

    try {
      const [programmeRateRows, specialRateRows, teacherRateRows] =
        await Promise.all([
          listProgrammeHourlyRates(academicYear),
          listSpecialHourlyRates(academicYear),
          listTeacherHourlyRates(academicYear),
        ]);
      setProgrammeRates(programmeRateRows);
      setSpecialRates(specialRateRows);
      setTeacherRates(teacherRateRows);
    } catch (error) {
      setProgrammeRates([]);
      setSpecialRates([]);
      setTeacherRates([]);
      const detail =
        error instanceof Error ? error.message : "Failed to load hourly rates.";
      errors.push(
        /could not find the table|does not exist|schema cache/i.test(detail)
          ? `${detail} — please apply migration 050 on Supabase.`
          : detail
      );
    }

    if (errors.length > 0) {
      setMessage(errors.join(" "));
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadAll();
    setProgrammeForm({
      id: "",
      programmeCode: "",
      programmeYear: "Y1",
      hourlyRate: "",
      notes: "",
    });
    setSpecialForm({
      id: "",
      rateName: "",
      programmeCode: "",
      hourlyRate: "",
      notes: "",
    });
    setTeacherForm({
      id: "",
      teacherName: "",
      employmentType: "",
      employmentFilter: "ALL",
      hourlyRate: "",
      notes: "",
    });
    setTeachingLines([]);
    setTeachingTotal(0);
    setTeachingMissingRates(0);
    setSupervisorForm({
      id: "",
      supervisorName: "",
      studentCount: "",
      notes: "",
    });
  }, [academicYear]);

  async function loadTeachingCosts() {
    setTeachingLoading(true);
    setMessage("");
    try {
      const result = await calculatePtTeachingCosts({
        academicYear,
        term: teachingTerm,
        programmeCode: teachingProgramme || undefined,
      });
      setTeachingLines(result.lines);
      setTeachingTotal(result.totalCost);
      setTeachingMissingRates(result.missingRateCount);
    } catch (error) {
      setTeachingLines([]);
      setTeachingTotal(0);
      setTeachingMissingRates(0);
      setMessage(
        error instanceof Error ? error.message : "Failed to calculate PT costs."
      );
    } finally {
      setTeachingLoading(false);
    }
  }

  async function loadSupervisorFees() {
    if (!supervisorProgramme) {
      setSupervisorRows([]);
      return;
    }
    setMessage("");
    try {
      const rows = await listPtSupervisorFees({
        academicYear,
        moduleTerm: supervisorTerm,
        programmeCode: supervisorProgramme,
      });
      setSupervisorRows(rows);
    } catch (error) {
      setSupervisorRows([]);
      const detail =
        error instanceof Error
          ? error.message
          : "Failed to load supervisor fees.";
      setMessage(
        /could not find the table|does not exist|schema cache/i.test(detail)
          ? `${detail} — please apply migration 064 on Supabase.`
          : detail
      );
    }
  }

  useEffect(() => {
    if (pageTab === "supervisor") {
      void loadSupervisorFees();
    }
  }, [pageTab, academicYear, supervisorTerm, supervisorProgramme]);

  useEffect(() => {
    if (pageTab === "teaching") {
      void loadTeachingCosts();
    }
  }, [pageTab, academicYear, teachingTerm, teachingProgramme]);

  async function saveSupervisorFee(event: React.FormEvent) {
    event.preventDefault();
    if (!supervisorProgramme) {
      setMessage(t.selectProgrammeRequiredShort);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await upsertPtSupervisorFee({
        id: supervisorForm.id || undefined,
        academicYear,
        programmeCode: supervisorProgramme,
        moduleTerm: supervisorTerm,
        supervisorName: supervisorForm.supervisorName,
        studentCount: supervisorForm.studentCount || "0",
        amountPerStudent: PT_SUPERVISOR_AMOUNT_PER_STUDENT,
        notes: supervisorForm.notes,
        updatedBy: user?.id ?? null,
      });
      setSupervisorForm({
        id: "",
        supervisorName: "",
        studentCount: "",
        notes: "",
      });
      await loadSupervisorFees();
      setMessage(t.ptSupervisorFeeSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveProgrammeRate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      await upsertProgrammeHourlyRate({
        id: programmeForm.id || undefined,
        academicYear,
        programmeCode: programmeForm.programmeCode,
        programmeYear: programmeForm.programmeYear,
        hourlyRate: programmeForm.hourlyRate,
        notes: programmeForm.notes,
        updatedBy: user?.id ?? null,
      });
      setProgrammeForm({
        id: "",
        programmeCode: "",
        programmeYear: "Y1",
        hourlyRate: "",
        notes: "",
      });
      await loadAll();
      setMessage(t.hourlyRateSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveSpecialRate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      await upsertSpecialHourlyRate({
        id: specialForm.id || undefined,
        academicYear,
        rateName: specialForm.rateName,
        programmeCode: specialForm.programmeCode,
        hourlyRate: specialForm.hourlyRate,
        notes: specialForm.notes,
        updatedBy: user?.id ?? null,
      });
      setSpecialForm({
        id: "",
        rateName: "",
        programmeCode: "",
        hourlyRate: "",
        notes: "",
      });
      await loadAll();
      setMessage(t.hourlyRateSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveTeacherRate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      await upsertTeacherHourlyRate({
        id: teacherForm.id || undefined,
        academicYear,
        teacherName: teacherForm.teacherName,
        employmentType: teacherForm.employmentType || null,
        hourlyRate: teacherForm.hourlyRate,
        notes: teacherForm.notes,
        updatedBy: user?.id ?? null,
      });
      setTeacherForm((prev) => ({
        ...prev,
        id: "",
        teacherName: "",
        employmentType: "",
        hourlyRate: "",
        notes: "",
      }));
      await loadAll();
      setMessage(t.hourlyRateSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function onTeacherPick(name: string) {
    const teacher = teachers.find(
      (row) =>
        teacherDisplayNameFromRow(row) === name || row.teacher_name === name
    );
    const employment = String(teacher?.employment_type ?? "")
      .trim()
      .toUpperCase();

    setTeacherForm((prev) => ({
      ...prev,
      teacherName: name,
      employmentType:
        employment === "FT" || employment === "PT"
          ? (employment as EmploymentType)
          : "",
    }));
  }

  const pageTabs: { key: PageTabKey; label: string }[] = [
    { key: "rates", label: t.ptTeacherCostsRatesTab },
    { key: "teaching", label: t.ptTeacherCostsTeachingTab },
    { key: "supervisor", label: t.ptTeacherCostsSupervisorTab },
  ];

  const ratesTabs: { key: RatesTabKey; label: string }[] = [
    { key: "programme", label: t.programmeHourlyRates },
    { key: "special", label: t.specialHourlyRates },
    { key: "teacher", label: t.teacherHourlyRates },
  ];

  return (
    <div className="page-container">
      <PageHeader
        title={t.ptTeacherCostsTitle}
        description={t.ptTeacherCostsDescription}
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
        {pageTabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
              pageTab === item.key
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
            onClick={() => {
              setPageTab(item.key);
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

      {pageTab === "teaching" ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t.ptTeachingCostHint}</p>
          <div className="card">
            <div className="card-body grid gap-3 md:grid-cols-3">
              <div>
                <label className="form-label">{t.term}</label>
                <select
                  className="form-select"
                  value={teachingTerm}
                  onChange={(event) =>
                    setTeachingTerm(
                      event.target.value as "All" | ModuleTerm
                    )
                  }
                >
                  <option value="All">All</option>
                  {TERM_OPTIONS.map((term) => (
                    <option key={term} value={term}>
                      {term}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">{t.programmeCode}</label>
                <select
                  className="form-select"
                  value={teachingProgramme}
                  onChange={(event) =>
                    setTeachingProgramme(event.target.value)
                  }
                >
                  <option value="">{t.allProgrammes}</option>
                  {programmeCodes.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={teachingLoading}
                  onClick={() => void loadTeachingCosts()}
                >
                  {teachingLoading ? t.loading : t.search}
                </button>
              </div>
            </div>
          </div>
          {teachingMissingRates > 0 ? (
            <p className="text-sm text-amber-700">
              {t.ptTeachingMissingRatesHint.replace(
                "{count}",
                String(teachingMissingRates)
              )}
            </p>
          ) : null}
          {teachingLoading ? (
            <LoadingState />
          ) : teachingLines.length === 0 ? (
            <EmptyState message={t.noPtTeachingCostsYet} />
          ) : (
            <>
              <DataTable
                rowKey={(row) =>
                  `${row.teacher_name}-${row.module_instance_code}-${row.module_term}`
                }
                rows={teachingLines}
                columns={[
                  {
                    key: "teacher",
                    header: t.teacherName,
                    render: (row) => row.teacher_name,
                  },
                  {
                    key: "teachingStatus",
                    header: t.teachingStatusForThisModule,
                    render: () => "PT",
                  },
                  {
                    key: "employment",
                    header: t.catalogueEmploymentType,
                    render: (row) => row.teacher_employment_type || "—",
                  },
                  {
                    key: "programme",
                    header: t.programmeCode,
                    render: (row) => row.programme_code || "—",
                  },
                  {
                    key: "module",
                    header: t.moduleCode,
                    render: (row) => row.module_instance_code || row.module_code,
                  },
                  {
                    key: "year",
                    header: t.programmeYear,
                    render: (row) => row.module_year || "—",
                  },
                  {
                    key: "term",
                    header: t.term,
                    render: (row) => row.module_term,
                  },
                  {
                    key: "hours",
                    header: t.contactHoursLabel,
                    render: (row) => money(row.contact_hours),
                  },
                  {
                    key: "rate",
                    header: t.hourlyRate,
                    render: (row) =>
                      row.hourly_rate == null
                        ? "—"
                        : `${money(row.hourly_rate)}${
                            row.rate_source === "teacher"
                              ? ` (${t.teacherHourlyRates})`
                              : ""
                          }`,
                  },
                  {
                    key: "cost",
                    header: t.ptTeachingCost,
                    render: (row) =>
                      row.cost == null ? "—" : money(row.cost),
                  },
                ]}
              />
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800">
                {t.total}: {money(teachingTotal)}
              </div>
            </>
          )}
        </div>
      ) : pageTab === "supervisor" ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t.ptSupervisorFeeHint}</p>
          <div className="card">
            <div className="card-body grid gap-3 md:grid-cols-2">
              <div>
                <label className="form-label">{t.term}</label>
                <select
                  className="form-select"
                  value={supervisorTerm}
                  onChange={(event) =>
                    setSupervisorTerm(event.target.value as ModuleTerm)
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
                <label className="form-label">{t.programmeCode}</label>
                <select
                  className="form-select"
                  value={supervisorProgramme}
                  onChange={(event) =>
                    setSupervisorProgramme(event.target.value)
                  }
                >
                  <option value="">{t.selectProgramme}</option>
                  {programmeCodes.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="card-body border-t border-slate-100 pt-0">
              <p className="text-sm font-medium text-slate-800">
                {t.ptSupervisorAmountPerStudent}:{" "}
                {money(PT_SUPERVISOR_AMOUNT_PER_STUDENT)}
              </p>
            </div>
          </div>

          <form className="card" onSubmit={saveSupervisorFee}>
            <div className="card-body grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="form-label">{t.ptSupervisorName}</label>
                <select
                  className="form-select"
                  value={supervisorForm.supervisorName}
                  onChange={(event) =>
                    setSupervisorForm((prev) => ({
                      ...prev,
                      supervisorName: event.target.value,
                    }))
                  }
                  required
                  disabled={!supervisorProgramme}
                >
                  <option value="">{t.selectTeacher}</option>
                  {ptTeachers.map((row) => {
                    const name = teacherDisplayNameFromRow(row);
                    return (
                      <option key={row.id ?? name} value={name}>
                        {name}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="form-label">{t.ptSupervisorStudentCount}</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  step="1"
                  value={supervisorForm.studentCount}
                  onChange={(event) =>
                    setSupervisorForm((prev) => ({
                      ...prev,
                      studentCount: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div>
                <label className="form-label">{t.total}</label>
                <div className="form-input bg-slate-50 font-semibold">
                  {money(supervisorFormTotal)}
                </div>
              </div>
              <div className="flex items-end">
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={saving || !supervisorProgramme}
                >
                  {saving ? t.loading : t.save}
                </button>
              </div>
            </div>
          </form>

          {supervisorRows.length === 0 ? (
            <EmptyState message={t.noPtSupervisorFeesYet} />
          ) : (
            <>
              <DataTable
                rowKey={(row) => row.id}
                rows={supervisorRows}
                columns={[
                  {
                    key: "supervisor",
                    header: t.ptSupervisorName,
                    render: (row) => row.supervisor_name,
                  },
                  {
                    key: "count",
                    header: t.ptSupervisorStudentCount,
                    render: (row) => row.student_count,
                  },
                  {
                    key: "rate",
                    header: t.ptSupervisorAmountPerStudent,
                    render: (row) => money(row.amount_per_student),
                  },
                  {
                    key: "total",
                    header: t.total,
                    render: (row) => money(row.total_amount),
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
                            setSupervisorForm({
                              id: row.id,
                              supervisorName: row.supervisor_name,
                              studentCount: String(row.student_count),
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
                            if (!window.confirm(t.confirmDeletePtSupervisorFee)) {
                              return;
                            }
                            await deletePtSupervisorFee(row.id);
                            await loadSupervisorFees();
                          }}
                        >
                          {t.delete}
                        </button>
                      </div>
                    ),
                  },
                ]}
              />
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800">
                {t.total}: {money(supervisorTotal)}
              </div>
            </>
          )}
        </div>
      ) : loading ? (
        <LoadingState />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {ratesTabs.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  ratesTab === item.key
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
                onClick={() => {
                  setRatesTab(item.key);
                  setMessage("");
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          {ratesTab === "programme" && (
            <div className="space-y-4">
              <form className="card" onSubmit={saveProgrammeRate}>
                <div className="card-body grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <div>
                    <label className="form-label">{t.programmeCode}</label>
                    <select
                      className="form-select"
                      value={programmeForm.programmeCode}
                      onChange={(event) =>
                        setProgrammeForm((prev) => ({
                          ...prev,
                          programmeCode: event.target.value,
                        }))
                      }
                      required
                    >
                      <option value="">{t.selectProgramme}</option>
                      {programmeCodes.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">{t.programmeYear}</label>
                    <select
                      className="form-select"
                      value={programmeForm.programmeYear}
                      onChange={(event) =>
                        setProgrammeForm((prev) => ({
                          ...prev,
                          programmeYear: event.target.value,
                        }))
                      }
                    >
                      {PROGRAMME_YEAR_OPTIONS.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">{t.hourlyRate}</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={programmeForm.hourlyRate}
                      onChange={(event) =>
                        setProgrammeForm((prev) => ({
                          ...prev,
                          hourlyRate: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.notes}</label>
                    <input
                      className="form-input"
                      value={programmeForm.notes}
                      onChange={(event) =>
                        setProgrammeForm((prev) => ({
                          ...prev,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="e.g. HDC Y1 standard"
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
                    {programmeForm.id && (
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() =>
                          setProgrammeForm({
                            id: "",
                            programmeCode: "",
                            programmeYear: "Y1",
                            hourlyRate: "",
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

              {programmeRates.length === 0 ? (
                <EmptyState message={t.noHourlyRatesYet} />
              ) : (
                <DataTable
                  rowKey={(row) => row.id}
                  rows={programmeRates}
                  columns={[
                    {
                      key: "programme",
                      header: t.programmeCode,
                      render: (row) => row.programme_code,
                    },
                    {
                      key: "year",
                      header: t.programmeYear,
                      render: (row) => row.programme_year,
                    },
                    {
                      key: "rate",
                      header: t.hourlyRate,
                      render: (row) => Number(row.hourly_rate).toFixed(2),
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
                              setProgrammeForm({
                                id: row.id,
                                programmeCode: row.programme_code,
                                programmeYear: row.programme_year,
                                hourlyRate: String(row.hourly_rate),
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
                              if (!window.confirm(t.confirmDeleteHourlyRate)) {
                                return;
                              }
                              try {
                                await deleteProgrammeHourlyRate(row.id);
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

          {ratesTab === "special" && (
            <div className="space-y-4">
              <form className="card" onSubmit={saveSpecialRate}>
                <div className="card-body grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <div>
                    <label className="form-label">{t.specialRateName}</label>
                    <input
                      className="form-input"
                      value={specialForm.rateName}
                      onChange={(event) =>
                        setSpecialForm((prev) => ({
                          ...prev,
                          rateName: event.target.value,
                        }))
                      }
                      placeholder="e.g. Night class / Bridging"
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.programmeCode}</label>
                    <select
                      className="form-select"
                      value={specialForm.programmeCode}
                      onChange={(event) =>
                        setSpecialForm((prev) => ({
                          ...prev,
                          programmeCode: event.target.value,
                        }))
                      }
                    >
                      <option value="">{t.optional}</option>
                      {programmeCodes.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">{t.hourlyRate}</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={specialForm.hourlyRate}
                      onChange={(event) =>
                        setSpecialForm((prev) => ({
                          ...prev,
                          hourlyRate: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.notes}</label>
                    <input
                      className="form-input"
                      value={specialForm.notes}
                      onChange={(event) =>
                        setSpecialForm((prev) => ({
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
                    {specialForm.id && (
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() =>
                          setSpecialForm({
                            id: "",
                            rateName: "",
                            programmeCode: "",
                            hourlyRate: "",
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

              {specialRates.length === 0 ? (
                <EmptyState message={t.noHourlyRatesYet} />
              ) : (
                <DataTable
                  rowKey={(row) => row.id}
                  rows={specialRates}
                  columns={[
                    {
                      key: "name",
                      header: t.specialRateName,
                      render: (row) => row.rate_name,
                    },
                    {
                      key: "programme",
                      header: t.programmeCode,
                      render: (row) => row.programme_code ?? "-",
                    },
                    {
                      key: "rate",
                      header: t.hourlyRate,
                      render: (row) => Number(row.hourly_rate).toFixed(2),
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
                              setSpecialForm({
                                id: row.id,
                                rateName: row.rate_name,
                                programmeCode: row.programme_code ?? "",
                                hourlyRate: String(row.hourly_rate),
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
                              if (!window.confirm(t.confirmDeleteHourlyRate)) {
                                return;
                              }
                              try {
                                await deleteSpecialHourlyRate(row.id);
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

          {ratesTab === "teacher" && (
            <div className="space-y-4">
              <form className="card" onSubmit={saveTeacherRate}>
                <div className="card-body grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <div>
                    <label className="form-label">{t.teacherEmploymentFilter}</label>
                    <select
                      className="form-select"
                      value={teacherForm.employmentFilter}
                      onChange={(event) =>
                        setTeacherForm((prev) => ({
                          ...prev,
                          employmentFilter: event.target.value as
                            | "ALL"
                            | EmploymentType,
                        }))
                      }
                    >
                      <option value="ALL">{t.allTeachers}</option>
                      <option value="FT">FT</option>
                      <option value="PT">PT</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">{t.teacherName}</label>
                    <select
                      className="form-select"
                      value={teacherForm.teacherName}
                      onChange={(event) => onTeacherPick(event.target.value)}
                      required
                    >
                      <option value="">{t.selectTeacher}</option>
                      {filteredTeachers.map((row) => {
                        const name = teacherDisplayNameFromRow(row);
                        return (
                          <option key={row.id} value={name}>
                            {name}
                            {row.employment_type
                              ? ` (${row.employment_type})`
                              : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">{t.teacherEmploymentStatus}</label>
                    <select
                      className="form-select"
                      value={teacherForm.employmentType}
                      onChange={(event) =>
                        setTeacherForm((prev) => ({
                          ...prev,
                          employmentType: event.target.value as
                            | EmploymentType
                            | "",
                        }))
                      }
                    >
                      <option value="">-</option>
                      <option value="FT">FT</option>
                      <option value="PT">PT</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">{t.hourlyRate}</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={teacherForm.hourlyRate}
                      onChange={(event) =>
                        setTeacherForm((prev) => ({
                          ...prev,
                          hourlyRate: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.notes}</label>
                    <input
                      className="form-input"
                      value={teacherForm.notes}
                      onChange={(event) =>
                        setTeacherForm((prev) => ({
                          ...prev,
                          notes: event.target.value,
                        }))
                      }
                      placeholder={t.teacherRateOverrideHint}
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
                    {teacherForm.id && (
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() =>
                          setTeacherForm((prev) => ({
                            ...prev,
                            id: "",
                            teacherName: "",
                            employmentType: "",
                            hourlyRate: "",
                            notes: "",
                          }))
                        }
                      >
                        {t.cancel}
                      </button>
                    )}
                  </div>
                </div>
              </form>

              {teacherRates.length === 0 ? (
                <EmptyState message={t.noHourlyRatesYet} />
              ) : (
                <DataTable
                  rowKey={(row) => row.id}
                  rows={teacherRates}
                  columns={[
                    {
                      key: "teacher",
                      header: t.teacherName,
                      render: (row) => row.teacher_name,
                    },
                    {
                      key: "employment",
                      header: t.teacherEmploymentStatus,
                      render: (row) => row.employment_type ?? "-",
                    },
                    {
                      key: "rate",
                      header: t.hourlyRate,
                      render: (row) => Number(row.hourly_rate).toFixed(2),
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
                              setTeacherForm((prev) => ({
                                ...prev,
                                id: row.id,
                                teacherName: row.teacher_name,
                                employmentType:
                                  row.employment_type === "FT" ||
                                  row.employment_type === "PT"
                                    ? row.employment_type
                                    : "",
                                hourlyRate: String(row.hourly_rate),
                                notes: row.notes ?? "",
                              }))
                            }
                          >
                            {t.edit}
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={async () => {
                              if (!window.confirm(t.confirmDeleteHourlyRate)) {
                                return;
                              }
                              try {
                                await deleteTeacherHourlyRate(row.id);
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
        </>
      )}
    </div>
  );
}
