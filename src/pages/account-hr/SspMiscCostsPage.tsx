import { useEffect, useMemo, useState } from "react";

import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { listProgrammes } from "../../services/programmeService";
import {
  listProgrammeSspMiscCosts,
  SSP_MISC_CATEGORY_KEYS,
  SSP_MISC_CATEGORY_LABELS,
  upsertProgrammeSspMiscCostsBatch,
  type SspMiscCategoryKey,
} from "../../services/sspMiscCostService";
import type { ModuleTerm, ProgrammeRow } from "../../types";
import { ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR } from "./accountHrAcademicYear";
import { AccountHrAcademicYearSelect } from "./AccountHrAcademicYearSelect";

const TERM_OPTIONS: ModuleTerm[] = ["Sep", "Feb", "Jun"];

function uniqueProgrammeCodes(programmes: ProgrammeRow[]) {
  return Array.from(
    new Set(
      programmes
        .map((row) => String(row.programme_code ?? "").trim().toUpperCase())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

function emptyDrafts(): Record<SspMiscCategoryKey, string> {
  return Object.fromEntries(
    SSP_MISC_CATEGORY_KEYS.map((key) => [key, ""])
  ) as Record<SspMiscCategoryKey, string>;
}

function money(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

export function SspMiscCostsPage() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [academicYear, setAcademicYear] = useState(
    ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR
  );
  const [moduleTerm, setModuleTerm] = useState<ModuleTerm>("Sep");
  const [programmeCode, setProgrammeCode] = useState("");
  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [drafts, setDrafts] = useState(emptyDrafts);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const programmeCodes = useMemo(
    () => uniqueProgrammeCodes(programmes),
    [programmes]
  );

  const total = useMemo(
    () =>
      SSP_MISC_CATEGORY_KEYS.reduce(
        (sum, key) => sum + (Number(drafts[key]) || 0),
        0
      ),
    [drafts]
  );

  async function loadProgrammes() {
    try {
      const rows = await listProgrammes();
      setProgrammes(rows);
      if (!programmeCode && rows.length > 0) {
        setProgrammeCode(uniqueProgrammeCodes(rows)[0] ?? "");
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to load programmes."
      );
    }
  }

  async function loadAmounts() {
    if (!programmeCode) {
      setDrafts(emptyDrafts());
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const rows = await listProgrammeSspMiscCosts({
        academicYear,
        moduleTerm,
        programmeCode,
      });
      const next = emptyDrafts();
      for (const row of rows) {
        next[row.category_key] = String(row.amount);
      }
      setDrafts(next);
    } catch (error) {
      setDrafts(emptyDrafts());
      const detail =
        error instanceof Error ? error.message : "Failed to load SSP misc.";
      setMessage(
        /could not find the table|does not exist|schema cache/i.test(detail)
          ? `${detail} — please apply migration 063 on Supabase.`
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
    void loadAmounts();
  }, [academicYear, moduleTerm, programmeCode]);

  async function saveAll() {
    if (!programmeCode) {
      setMessage(t.selectProgrammeRequiredShort);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await upsertProgrammeSspMiscCostsBatch({
        academicYear,
        programmeCode,
        moduleTerm,
        amounts: drafts,
        updatedBy: user?.id ?? null,
      });
      setMessage(t.sspMiscCostsSaved);
      await loadAmounts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.sspMiscCostsTitle}
        description={t.sspMiscCostsDescription}
      />

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
          <p className="text-sm text-slate-600">{t.sspMiscCostsHint}</p>
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
              <table className="data-table min-w-[640px]">
                <thead>
                  <tr>
                    <th>{t.sspMiscCategory}</th>
                    <th>{t.amount}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {SSP_MISC_CATEGORY_KEYS.map((key) => (
                    <tr key={key}>
                      <td className="font-medium">
                        {SSP_MISC_CATEGORY_LABELS[key]}
                      </td>
                      <td>
                        <input
                          className="form-input min-w-28"
                          type="number"
                          min="0"
                          step="0.01"
                          value={drafts[key]}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [key]: event.target.value,
                            }))
                          }
                          placeholder={t.accountingFillPlaceholder}
                          disabled={!programmeCode}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-semibold">
                    <td>{t.total}</td>
                    <td>{money(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || !programmeCode}
            onClick={() => void saveAll()}
          >
            {saving ? t.loading : t.save}
          </button>
        </div>
      )}
    </div>
  );
}
