import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { listProgrammes } from "../../services/programmeService";
import {
  listProgrammeReviewFees,
  PROGRAMME_FEE_TYPES,
  upsertProgrammeReviewFee,
  type ProgrammeFeeType,
} from "../../services/reviewFeeService";
import type { ProgrammeRow } from "../../types";
import { ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR } from "./accountHrAcademicYear";
import { AccountHrAcademicYearSelect } from "./AccountHrAcademicYearSelect";

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

function feeTypeLabel(
  feeType: ProgrammeFeeType,
  t: ReturnType<typeof useLanguage>["t"]
) {
  if (feeType === "registration") return t.registrationFeeTab;
  if (feeType === "annual_audit") return t.annualAuditFeeTab;
  if (feeType === "periodic") return t.periodicFeeTab;
  return t.reviewFeeTab;
}

function feeAmountLabel(
  feeType: ProgrammeFeeType,
  t: ReturnType<typeof useLanguage>["t"]
) {
  if (feeType === "registration") return t.registrationFeeAmount;
  if (feeType === "annual_audit") return t.annualAuditFeeAmount;
  if (feeType === "periodic") return t.periodicFeeAmount;
  return t.reviewFeeAmount;
}

export function ReviewFeesPage() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [academicYear, setAcademicYear] = useState(
    ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR
  );
  const [feeType, setFeeType] = useState<ProgrammeFeeType>("review");
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

  async function loadFees() {
    setLoading(true);
    setMessage("");
    try {
      const fees = await listProgrammeReviewFees({ academicYear, feeType });
      const map: Record<string, string> = {};
      for (const row of fees) {
        map[row.programme_code] = String(row.amount);
      }
      setAmountByCode(map);
    } catch (error) {
      setAmountByCode({});
      const detail =
        error instanceof Error ? error.message : "Failed to load fees.";
      setMessage(
        /could not find the table|does not exist|schema cache|fee_type/i.test(
          detail
        )
          ? `${detail} — please apply migrations 057/060/061 on Supabase.`
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
    void loadFees();
  }, [academicYear, feeType]);

  async function saveAmount(programmeCode: string) {
    setSavingCode(programmeCode);
    setMessage("");
    try {
      await upsertProgrammeReviewFee({
        academicYear,
        programmeCode,
        feeType,
        amount: amountByCode[programmeCode] || "0",
        updatedBy: user?.id ?? null,
      });
      setMessage(t.programmeFeeSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSavingCode(null);
    }
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.reviewFeesTitle}
        description={t.reviewFeesDescription}
      />

      <div className="mb-4 card">
        <div className="card-body">
          <AccountHrAcademicYearSelect
            label={t.academicYear}
            value={academicYear}
            onChange={setAcademicYear}
          />
          <p className="mt-2 text-sm text-slate-600">{t.reviewFeesHint}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {PROGRAMME_FEE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
              feeType === type
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
            onClick={() => {
              setFeeType(type);
              setMessage("");
            }}
          >
            {feeTypeLabel(type, t)}
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
                  <th>{feeAmountLabel(feeType, t)}</th>
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
