import { useEffect, useMemo, useState } from "react";

import { DataTable } from "../../components/tables/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  deleteExternalReviewEngagement,
  engagementModulesTotal,
  EXTERNAL_REVIEW_ROLE_TYPES,
  listExternalReviewDefaultRates,
  listExternalReviewEngagements,
  upsertExternalReviewDefaultRate,
  upsertExternalReviewEngagement,
  type ExternalReviewEngagementRow,
  type ExternalReviewRoleType,
} from "../../services/externalReviewService";
import { listProgrammes } from "../../services/programmeService";
import type { ModuleTerm, ProgrammeRow } from "../../types";
import { ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR } from "./accountHrAcademicYear";
import { AccountHrAcademicYearSelect } from "./AccountHrAcademicYearSelect";

const TERM_OPTIONS: ModuleTerm[] = ["Sep", "Feb", "Jun"];

type ModuleDraft = {
  key: string;
  moduleName: string;
  amount: string;
};

type FormState = {
  id: string;
  personName: string;
  modules: ModuleDraft[];
  notes: string;
};

function uniqueProgrammeCodes(programmes: ProgrammeRow[]) {
  return Array.from(
    new Set(
      programmes
        .map((row) => String(row.programme_code ?? "").trim().toUpperCase())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

function money(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function newModuleDraft(defaultAmount = ""): ModuleDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    moduleName: "",
    amount: defaultAmount,
  };
}

function emptyForm(defaultAmount = ""): FormState {
  return {
    id: "",
    personName: "",
    modules: [newModuleDraft(defaultAmount)],
    notes: "",
  };
}

function roleLabel(
  role: ExternalReviewRoleType,
  t: ReturnType<typeof useLanguage>["t"]
) {
  if (role === "external_examiner") return t.externalExaminer;
  if (role === "external_advisor") return t.externalAdvisor;
  return t.classVisitObserver;
}

function personLabel(
  role: ExternalReviewRoleType,
  t: ReturnType<typeof useLanguage>["t"]
) {
  if (role === "external_examiner") return t.externalExaminerName;
  if (role === "external_advisor") return t.externalAdvisorName;
  return t.classVisitObserverName;
}

export function ExternalReviewPage() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [pageTab, setPageTab] = useState<"rates" | "records">("records");
  const [academicYear, setAcademicYear] = useState(
    ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR
  );
  const [moduleTerm, setModuleTerm] = useState<ModuleTerm>("Sep");
  const [programmeCode, setProgrammeCode] = useState("");
  const [roleType, setRoleType] =
    useState<ExternalReviewRoleType>("external_examiner");
  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [defaultByRole, setDefaultByRole] = useState<
    Record<ExternalReviewRoleType, string>
  >({
    external_examiner: "",
    external_advisor: "",
    class_visit: "",
  });
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [rows, setRows] = useState<ExternalReviewEngagementRow[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const programmeCodes = useMemo(
    () => uniqueProgrammeCodes(programmes),
    [programmes]
  );

  const defaultAmount = defaultByRole[roleType] || "0";

  const formTotal = useMemo(
    () => engagementModulesTotal(form.modules),
    [form.modules]
  );

  const filteredRows = useMemo(
    () => rows.filter((row) => row.role_type === roleType),
    [rows, roleType]
  );

  async function loadProgrammesAndRates() {
    try {
      const [programmeRows, rateRows] = await Promise.all([
        listProgrammes(),
        listExternalReviewDefaultRates().catch(() => []),
      ]);
      setProgrammes(programmeRows);
      if (!programmeCode && programmeRows.length > 0) {
        setProgrammeCode(uniqueProgrammeCodes(programmeRows)[0] ?? "");
      }
      const next: Record<ExternalReviewRoleType, string> = {
        external_examiner: "",
        external_advisor: "",
        class_visit: "",
      };
      for (const role of EXTERNAL_REVIEW_ROLE_TYPES) {
        const row = rateRows.find((item) => item.role_type === role);
        next[role] = row ? String(row.amount_per_module) : "";
      }
      setDefaultByRole(next);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to load programmes."
      );
    }
  }

  async function loadEngagements() {
    if (!programmeCode) {
      setRows([]);
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const data = await listExternalReviewEngagements({
        academicYear,
        moduleTerm,
        programmeCode,
      });
      setRows(data);
    } catch (error) {
      setRows([]);
      const detail =
        error instanceof Error ? error.message : "Failed to load records.";
      setMessage(
        /could not find the table|does not exist|schema cache/i.test(detail)
          ? `${detail} — please apply migration 059 on Supabase.`
          : detail
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProgrammesAndRates();
  }, []);

  useEffect(() => {
    void loadEngagements();
    setForm(emptyForm(defaultByRole[roleType] || "0"));
  }, [academicYear, moduleTerm, programmeCode]);

  useEffect(() => {
    setForm(emptyForm(defaultByRole[roleType] || "0"));
  }, [roleType]);

  async function saveDefaultRate(role: ExternalReviewRoleType) {
    setSavingRole(role);
    setMessage("");
    try {
      await upsertExternalReviewDefaultRate({
        roleType: role,
        amountPerModule: defaultByRole[role] || "0",
        updatedBy: user?.id ?? null,
      });
      setMessage(t.externalReviewRateSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSavingRole(null);
    }
  }

  async function saveForm(event: React.FormEvent) {
    event.preventDefault();
    if (!programmeCode) {
      setMessage(t.selectProgrammeRequiredShort);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await upsertExternalReviewEngagement({
        id: form.id || undefined,
        academicYear,
        moduleTerm,
        programmeCode,
        roleType,
        personName: form.personName,
        modules: form.modules.map((row) => ({
          moduleName: row.moduleName,
          amount: row.amount || "0",
        })),
        notes: form.notes,
        updatedBy: user?.id ?? null,
      });
      setForm(emptyForm(defaultAmount));
      await loadEngagements();
      setMessage(t.externalReviewEngagementSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row: ExternalReviewEngagementRow) {
    setRoleType(row.role_type);
    setForm({
      id: row.id,
      personName: row.person_name,
      notes: row.notes ?? "",
      modules:
        (row.modules ?? []).length > 0
          ? (row.modules ?? []).map((item) => ({
              key: item.id,
              moduleName: item.module_name,
              amount: String(item.amount),
            }))
          : [newModuleDraft(defaultByRole[row.role_type] || "0")],
    });
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.externalReviewEngagementsTitle}
        description={t.externalReviewPageDescription}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            { key: "records" as const, label: t.externalReviewRecordsTab },
            { key: "rates" as const, label: t.externalReviewRatesTab },
          ] as const
        ).map((item) => (
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

      {pageTab === "rates" ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{t.externalReviewRatesHint}</p>
          <div className="overflow-x-auto card">
            <div className="card-body">
              <table className="data-table min-w-[640px]">
                <thead>
                  <tr>
                    <th>{t.externalReviewRoleType}</th>
                    <th>{t.externalReviewDefaultAmountPerModule}</th>
                    <th>{t.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {EXTERNAL_REVIEW_ROLE_TYPES.map((role) => (
                    <tr key={role}>
                      <td className="font-medium">{roleLabel(role, t)}</td>
                      <td>
                        <input
                          className="form-input min-w-28"
                          type="number"
                          min="0"
                          step="0.01"
                          value={defaultByRole[role]}
                          onChange={(event) =>
                            setDefaultByRole((prev) => ({
                              ...prev,
                              [role]: event.target.value,
                            }))
                          }
                          placeholder="0.00"
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={savingRole === role}
                          onClick={() => void saveDefaultRate(role)}
                        >
                          {savingRole === role ? t.loading : t.save}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <>
      <div className="mb-4 card">
        <div className="card-body grid gap-3 md:grid-cols-3">
          <AccountHrAcademicYearSelect
            label={t.academicYear}
            value={academicYear}
            onChange={setAcademicYear}
          />
          <div>
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
          </div>
          <div>
            <label className="form-label">{t.programmeCode}</label>
            <select
              className="form-select"
              value={programmeCode}
              onChange={(event) => setProgrammeCode(event.target.value)}
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
          <p className="text-sm text-slate-600">
            {t.externalReviewEngagementsHint}{" "}
            <span className="font-medium text-slate-800">
              {t.externalReviewDefaultAmountPerModule}: {money(defaultAmount)}
            </span>
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {EXTERNAL_REVIEW_ROLE_TYPES.map((role) => (
          <button
            key={role}
            type="button"
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
              roleType === role
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
            onClick={() => {
              setRoleType(role);
              setMessage("");
            }}
          >
            {roleLabel(role, t)}
          </button>
        ))}
      </div>

      <form className="mb-6 card" onSubmit={saveForm}>
        <div className="card-body space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="form-label">{personLabel(roleType, t)}</label>
              <input
                className="form-input"
                value={form.personName}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    personName: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div>
              <label className="form-label">{t.total}</label>
              <div className="form-input bg-slate-50 font-semibold">
                {money(formTotal)}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800">
                {t.externalReviewModules}
              </h3>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    modules: [...prev.modules, newModuleDraft(defaultAmount)],
                  }))
                }
              >
                {t.addModule}
              </button>
            </div>
            <div className="space-y-2">
              {form.modules.map((module, index) => (
                <div
                  key={module.key}
                  className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-[1fr_8rem_auto]"
                >
                  <div>
                    <label className="form-label">{t.moduleName}</label>
                    <input
                      className="form-input"
                      value={module.moduleName}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          modules: prev.modules.map((item, i) =>
                            i === index
                              ? { ...item, moduleName: event.target.value }
                              : item
                          ),
                        }))
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.amount}</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={module.amount}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          modules: prev.modules.map((item, i) =>
                            i === index
                              ? { ...item, amount: event.target.value }
                              : item
                          ),
                        }))
                      }
                      required
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={form.modules.length <= 1}
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          modules: prev.modules.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      {t.delete}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? t.loading : t.save}
            </button>
            {form.id ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setForm(emptyForm(defaultAmount))}
              >
                {t.cancel}
              </button>
            ) : null}
          </div>
        </div>
      </form>

      {loading ? (
        <LoadingState />
      ) : filteredRows.length === 0 ? (
        <EmptyState message={t.noExternalReviewEngagementsYet} />
      ) : (
        <DataTable
          rowKey={(row) => row.id}
          rows={filteredRows}
          columns={[
            {
              key: "person",
              header: personLabel(roleType, t),
              render: (row) => row.person_name,
            },
            {
              key: "modules",
              header: t.externalReviewModules,
              render: (row) =>
                (row.modules ?? [])
                  .map((item) => `${item.module_name} (${money(item.amount)})`)
                  .join("; ") || "—",
            },
            {
              key: "total",
              header: t.total,
              render: (row) => money(engagementModulesTotal(row.modules ?? [])),
            },
            {
              key: "actions",
              header: t.actions,
              render: (row) => (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => startEdit(row)}
                  >
                    {t.edit}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={async () => {
                      if (!window.confirm(t.confirmDeleteExternalReview)) {
                        return;
                      }
                      await deleteExternalReviewEngagement(row.id);
                      await loadEngagements();
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
        </>
      )}
    </div>
  );
}

/** @deprecated use ExternalReviewPage */
export const ExternalReviewEngagementsPage = ExternalReviewPage;
