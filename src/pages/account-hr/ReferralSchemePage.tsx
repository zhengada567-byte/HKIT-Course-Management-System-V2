import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { listProgrammes } from "../../services/programmeService";
import {
  listProgrammeReferralScheme,
  upsertProgrammeReferralScheme,
} from "../../services/referralSchemeService";
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
      name: String(row.programme_name ?? "").trim() || code,
    });
  }
  return Array.from(byCode.values()).sort((a, b) =>
    a.code.localeCompare(b.code)
  );
}

export function ReferralSchemePage() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [academicYear, setAcademicYear] = useState(
    ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR
  );
  const [moduleTerm, setModuleTerm] = useState<ModuleTerm>("Sep");
  const [loading, setLoading] = useState(false);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [programmeMeta, setProgrammeMeta] = useState<
    Array<{ code: string; name: string }>
  >([]);
  const [amountByCode, setAmountByCode] = useState<Record<string, string>>({});

  const programmeCodes = useMemo(
    () => programmeMeta.map((row) => row.code),
    [programmeMeta]
  );

  async function loadProgrammes() {
    try {
      const programmes = await listProgrammes();
      setProgrammeMeta(uniqueProgrammeMeta(programmes));
    } catch (error) {
      setProgrammeMeta([]);
      setMessage(
        error instanceof Error ? error.message : "Failed to load programmes."
      );
    }
  }

  async function loadAmounts() {
    setLoading(true);
    setMessage("");
    try {
      const rows = await listProgrammeReferralScheme({
        academicYear,
        moduleTerm,
      });
      const map: Record<string, string> = {};
      for (const row of rows) {
        map[row.programme_code] = String(row.amount);
      }
      setAmountByCode(map);
    } catch (error) {
      setAmountByCode({});
      const detail =
        error instanceof Error
          ? error.message
          : "Failed to load referral scheme.";
      setMessage(
        /could not find the table|does not exist|schema cache/i.test(detail)
          ? `${detail} — please apply migration 062 on Supabase.`
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
  }, [academicYear, moduleTerm]);

  async function saveAmount(programmeCode: string) {
    setSavingCode(programmeCode);
    setMessage("");
    try {
      await upsertProgrammeReferralScheme({
        academicYear,
        programmeCode,
        moduleTerm,
        amount: amountByCode[programmeCode] || "0",
        updatedBy: user?.id ?? null,
      });
      setMessage(t.referralSchemeSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSavingCode(null);
    }
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.referralSchemeTitle}
        description={t.referralSchemeDescription}
      />

      <div className="mb-4 card">
        <div className="card-body grid gap-3 md:grid-cols-2">
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
        </div>
        <div className="card-body border-t border-slate-100 pt-0">
          <p className="text-sm text-slate-600">{t.referralSchemeHint}</p>
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
        <div className="overflow-x-auto card">
          <div className="card-body">
            <table className="data-table min-w-[720px]">
              <thead>
                <tr>
                  <th>{t.programmeCode}</th>
                  <th>{t.programmeName}</th>
                  <th>{t.referralSchemeAmount}</th>
                  <th>{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {programmeMeta.map((row) => (
                  <tr key={row.code}>
                    <td className="font-medium">{row.code}</td>
                    <td className="text-slate-600">{row.name}</td>
                    <td>
                      <input
                        className="form-input min-w-28"
                        type="number"
                        min="0"
                        step="0.01"
                        value={amountByCode[row.code] ?? ""}
                        onChange={(event) =>
                          setAmountByCode((prev) => ({
                            ...prev,
                            [row.code]: event.target.value,
                          }))
                        }
                        placeholder={t.accountingFillPlaceholder}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={savingCode === row.code}
                        onClick={() => void saveAmount(row.code)}
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
      )}
    </div>
  );
}
