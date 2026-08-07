import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { isHDProgrammeType } from "../programme-leader/make-study-plan/helpers";
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

const MONTH_OPTIONS = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
] as const;

const REVIEW_SOURCE_HD_CODE = "HDBA";
const EXCLUDED_PROGRAMME_CODES = new Set(["HDCCI"]);

type ValidityDraft = {
  fromMonth: string;
  fromYear: string;
  toMonth: string;
  toYear: string;
};

function emptyValidity(): ValidityDraft {
  return { fromMonth: "", fromYear: "", toMonth: "", toYear: "" };
}

function uniqueProgrammeMeta(programmes: ProgrammeRow[]) {
  const byCode = new Map<string, { code: string; isHd: boolean }>();
  for (const row of programmes) {
    const code = String(row.programme_code ?? "").trim().toUpperCase();
    if (!code || EXCLUDED_PROGRAMME_CODES.has(code) || byCode.has(code)) {
      continue;
    }
    byCode.set(code, {
      code,
      isHd: isHDProgrammeType(row.programme_type),
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

function MonthSelect(props: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <select
      className="form-input h-8 w-[4.25rem] px-1 py-0 text-sm"
      value={props.value}
      aria-label={props.ariaLabel}
      onChange={(event) => props.onChange(event.target.value)}
    >
      <option value="">—</option>
      {MONTH_OPTIONS.map((month) => (
        <option key={month.value} value={String(month.value)}>
          {month.label}
        </option>
      ))}
    </select>
  );
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
    Array<{ code: string; isHd: boolean }>
  >([]);
  const [amountByCode, setAmountByCode] = useState<Record<string, string>>({});
  const [validityByCode, setValidityByCode] = useState<
    Record<string, ValidityDraft>
  >({});

  const showValidity = feeType === "review";
  const programmeCodes = useMemo(
    () => programmeMeta.map((row) => row.code),
    [programmeMeta]
  );
  const otherHdCodes = useMemo(
    () =>
      programmeMeta
        .filter((row) => row.isHd && row.code !== REVIEW_SOURCE_HD_CODE)
        .map((row) => row.code),
    [programmeMeta]
  );

  const tableMinWidth = useMemo(
    () => (showValidity ? "min-w-[720px]" : "min-w-[480px]"),
    [showValidity]
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
      const amounts: Record<string, string> = {};
      const validity: Record<string, ValidityDraft> = {};
      for (const row of fees) {
        amounts[row.programme_code] = String(row.amount);
        if (feeType === "review") {
          validity[row.programme_code] = {
            fromMonth:
              row.validity_from_month != null
                ? String(row.validity_from_month)
                : "",
            fromYear:
              row.validity_from_year != null
                ? String(row.validity_from_year)
                : "",
            toMonth:
              row.validity_to_month != null
                ? String(row.validity_to_month)
                : "",
            toYear:
              row.validity_to_year != null ? String(row.validity_to_year) : "",
          };
        }
      }
      setAmountByCode(amounts);
      setValidityByCode(validity);
    } catch (error) {
      setAmountByCode({});
      setValidityByCode({});
      const detail =
        error instanceof Error ? error.message : "Failed to load fees.";
      setMessage(
        /could not find the table|does not exist|schema cache|fee_type|validity_/i.test(
          detail
        )
          ? `${detail} — please apply migrations 057/060/061/065 on Supabase.`
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

  function updateValidity(
    programmeCode: string,
    patch: Partial<ValidityDraft>
  ) {
    setValidityByCode((prev) => ({
      ...prev,
      [programmeCode]: {
        ...(prev[programmeCode] ?? emptyValidity()),
        ...patch,
      },
    }));
  }

  async function saveAmount(programmeCode: string) {
    setSavingCode(programmeCode);
    setMessage("");
    try {
      const draft = validityByCode[programmeCode] ?? emptyValidity();
      const amount = amountByCode[programmeCode] || "0";
      const validity =
        feeType === "review"
          ? {
              fromMonth: draft.fromMonth ? Number(draft.fromMonth) : null,
              fromYear: draft.fromYear ? Number(draft.fromYear) : null,
              toMonth: draft.toMonth ? Number(draft.toMonth) : null,
              toYear: draft.toYear ? Number(draft.toYear) : null,
            }
          : null;

      await upsertProgrammeReviewFee({
        academicYear,
        programmeCode,
        feeType,
        amount,
        validity,
        updatedBy: user?.id ?? null,
      });

      // Saving HDBA review fee copies amount + validity to other HD programmes.
      // Each target can still be edited and saved separately afterwards.
      if (
        feeType === "review" &&
        programmeCode === REVIEW_SOURCE_HD_CODE &&
        otherHdCodes.length > 0
      ) {
        await Promise.all(
          otherHdCodes.map((code) =>
            upsertProgrammeReviewFee({
              academicYear,
              programmeCode: code,
              feeType,
              amount,
              validity,
              updatedBy: user?.id ?? null,
            })
          )
        );

        setAmountByCode((prev) => {
          const next = { ...prev };
          for (const code of otherHdCodes) next[code] = amount;
          return next;
        });
        setValidityByCode((prev) => {
          const next = { ...prev };
          for (const code of otherHdCodes) next[code] = { ...draft };
          return next;
        });
        setMessage(t.reviewFeeCopiedToHd);
      } else {
        setMessage(t.programmeFeeSaved);
      }
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
            <table className={`data-table ${tableMinWidth}`}>
              <thead>
                <tr>
                  <th>{t.programmeCode}</th>
                  {showValidity && (
                    <th>{t.reviewValidityPeriod}</th>
                  )}
                  <th>{feeAmountLabel(feeType, t)}</th>
                  <th>{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {programmeCodes.map((code) => {
                  const validity = validityByCode[code] ?? emptyValidity();
                  return (
                    <tr key={code}>
                      <td className="font-medium">{code}</td>
                      {showValidity && (
                        <td className="whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <MonthSelect
                              value={validity.fromMonth}
                              ariaLabel={t.reviewValidityFromMonth}
                              onChange={(value) =>
                                updateValidity(code, { fromMonth: value })
                              }
                            />
                            <input
                              className="form-input h-8 w-14 px-1 py-0 text-sm"
                              type="number"
                              min={1990}
                              max={2100}
                              step={1}
                              placeholder="YYYY"
                              aria-label={t.reviewValidityFromYear}
                              value={validity.fromYear}
                              onChange={(event) =>
                                updateValidity(code, {
                                  fromYear: event.target.value,
                                })
                              }
                            />
                            <span className="px-0.5 text-xs text-slate-400">
                              –
                            </span>
                            <MonthSelect
                              value={validity.toMonth}
                              ariaLabel={t.reviewValidityToMonth}
                              onChange={(value) =>
                                updateValidity(code, { toMonth: value })
                              }
                            />
                            <input
                              className="form-input h-8 w-14 px-1 py-0 text-sm"
                              type="number"
                              min={1990}
                              max={2100}
                              step={1}
                              placeholder="YYYY"
                              aria-label={t.reviewValidityToYear}
                              value={validity.toYear}
                              onChange={(event) =>
                                updateValidity(code, {
                                  toYear: event.target.value,
                                })
                              }
                            />
                          </div>
                        </td>
                      )}
                      <td>
                        <input
                          className="form-input h-8 w-28"
                          type="number"
                          min="0"
                          step="0.01"
                          value={amountByCode[code] ?? ""}
                          onChange={(event) =>
                            setAmountByCode((prev) => ({
                              ...prev,
                              [code]: event.target.value,
                            }))
                          }
                          placeholder={t.accountingFillPlaceholder}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={savingCode === code}
                          onClick={() => void saveAmount(code)}
                        >
                          {savingCode === code ? t.loading : t.save}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
