import { useEffect, useMemo, useState } from "react";

import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  FT_STAFF_MONTH_KEYS,
  listFtStaffCosts,
  upsertFtStaffCost,
  type FtStaffCostRow,
  type FtStaffMonthKey,
} from "../../services/ftStaffCostService";
import { listProgrammes } from "../../services/programmeService";
import type { ProgrammeRow } from "../../types";
import { ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR } from "./accountHrAcademicYear";
import { AccountHrAcademicYearSelect } from "./AccountHrAcademicYearSelect";

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

function emptyDrafts(): Record<FtStaffMonthKey, string> {
  return Object.fromEntries(
    FT_STAFF_MONTH_KEYS.map((month) => [month, ""])
  ) as Record<FtStaffMonthKey, string>;
}

export function FtStaffCostsPage() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [academicYear, setAcademicYear] = useState(
    ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [programmeCode, setProgrammeCode] = useState("");
  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [rows, setRows] = useState<FtStaffCostRow[]>([]);
  const [drafts, setDrafts] = useState(emptyDrafts);

  const programmeCodes = useMemo(
    () => uniqueProgrammeCodes(programmes),
    [programmes]
  );

  async function loadAll() {
    setLoading(true);
    setMessage("");

    let programmeLoadError = "";
    let costLoadError = "";

    try {
      const programmeRows = await listProgrammes();
      setProgrammes(programmeRows);
      if (!programmeCode && programmeRows.length > 0) {
        setProgrammeCode(uniqueProgrammeCodes(programmeRows)[0] ?? "");
      }
    } catch (error) {
      programmeLoadError =
        error instanceof Error
          ? error.message
          : typeof error === "object" &&
              error &&
              "message" in error &&
              typeof (error as { message: unknown }).message === "string"
            ? (error as { message: string }).message
            : "Failed to load programmes.";
    }

    try {
      const costRows = await listFtStaffCosts({ academicYear });
      setRows(costRows);
    } catch (error) {
      setRows([]);
      const detail =
        error instanceof Error
          ? error.message
          : typeof error === "object" &&
              error &&
              "message" in error &&
              typeof (error as { message: unknown }).message === "string"
            ? (error as { message: string }).message
            : "Failed to load FT staff costs.";
      costLoadError =
        /could not find the table|does not exist|schema cache/i.test(detail)
          ? `${detail} — please apply migrations 052/053 on Supabase.`
          : detail;
    }

    if (programmeLoadError || costLoadError) {
      setMessage([programmeLoadError, costLoadError].filter(Boolean).join(" "));
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadAll();
  }, [academicYear]);

  useEffect(() => {
    const next = emptyDrafts();
    for (const month of FT_STAFF_MONTH_KEYS) {
      const row = rows.find(
        (item) =>
          item.programme_code === programmeCode && item.month_key === month
      );
      next[month] = row ? String(row.total_cost) : "";
    }
    setDrafts(next);
  }, [rows, programmeCode]);

  const yearTotal = useMemo(() => {
    return FT_STAFF_MONTH_KEYS.reduce((sum, month) => {
      const n = Number(drafts[month] || 0);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
  }, [drafts]);

  async function saveMonth(monthKey: FtStaffMonthKey) {
    if (!programmeCode) {
      setMessage(t.selectProgrammeRequiredShort);
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const existing = rows.find(
        (row) =>
          row.programme_code === programmeCode && row.month_key === monthKey
      );
      await upsertFtStaffCost({
        id: existing?.id,
        academicYear,
        programmeCode,
        monthKey,
        totalCost: drafts[monthKey] || "0",
        updatedBy: user?.id ?? null,
      });
      await loadAll();
      setMessage(t.ftStaffCostSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveAllMonths() {
    if (!programmeCode) {
      setMessage(t.selectProgrammeRequiredShort);
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      for (const monthKey of FT_STAFF_MONTH_KEYS) {
        const raw = drafts[monthKey];
        if (raw === "" || raw == null) continue;

        const existing = rows.find(
          (row) =>
            row.programme_code === programmeCode && row.month_key === monthKey
        );
        await upsertFtStaffCost({
          id: existing?.id,
          academicYear,
          programmeCode,
          monthKey,
          totalCost: raw,
          updatedBy: user?.id ?? null,
        });
      }
      await loadAll();
      setMessage(t.ftStaffCostSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.ftStaffCostsTitle}
        description={t.ftStaffCostsDescription}
      />

      <div className="mb-4 card">
        <div className="card-body grid gap-3 md:grid-cols-2">
          <AccountHrAcademicYearSelect
            label={t.academicYear}
            value={academicYear}
            onChange={setAcademicYear}
          />
          <div>
            <label className="form-label">{t.programmeCode}</label>
            <select
              className="form-select"
              value={programmeCode}
              onChange={(event) => {
                setProgrammeCode(event.target.value);
                setMessage("");
              }}
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
          <p className="text-sm text-slate-600">{t.ftStaffCostsHint}</p>
          <div className="card">
            <div className="card-body space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {FT_STAFF_MONTH_KEYS.map((month) => (
                  <div key={month} className="space-y-1">
                    <label className="form-label">{month}</label>
                    <div className="flex gap-2">
                      <input
                        className="form-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={drafts[month]}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [month]: event.target.value,
                          }))
                        }
                        placeholder="0.00"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={saving || !programmeCode}
                        onClick={() => void saveMonth(month)}
                      >
                        {t.save}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <div className="text-sm text-slate-700">
                  {t.total}: <strong>{money(yearTotal)}</strong>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving || !programmeCode}
                  onClick={() => void saveAllMonths()}
                >
                  {saving ? t.loading : t.saveAllMonths}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
