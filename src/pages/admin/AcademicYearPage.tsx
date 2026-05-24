import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  buildStudyTermFromYear,
  inferCurrentAcademicYearFromDate,
  inferCurrentOfferedTermFromDate,
  inferCurrentStudyTermFromDate,
  offeredTermFromStudyTerm,
  parseStudyTerm,
} from "../programme-leader/make-study-plan/helpers";
import { academicYearToStartYear, formatAcademicYear } from "../../lib/utils";
import { saveAcademicYearAndTermSettings } from "../../services/academicYearService";
import { recalculateAllStudentStatuses } from "../../services/studyPlanService";
import type { ModuleTerm } from "../../types/common";

const OFFERED_TERMS: ModuleTerm[] = ["Feb", "Jun", "Sep"];

function formatTodayDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

export function AcademicYearPage() {
  const { user } = useAuth();
  const {
    academicYear,
    previousAcademicYear,
    currentStudyTerm,
    refreshAcademicYear,
  } = useAcademicYear();
  const { t } = useLanguage();

  const today = useMemo(() => new Date(), []);

  const dateBasedStudyTerm = useMemo(
    () => inferCurrentStudyTermFromDate(today),
    [today]
  );
  const dateBasedOfferedTerm = useMemo(
    () => inferCurrentOfferedTermFromDate(today),
    [today]
  );
  const dateBasedAcademicYear = useMemo(
    () => inferCurrentAcademicYearFromDate(today),
    [today]
  );
  const dateBasedStartYear = useMemo(
    () => String(academicYearToStartYear(dateBasedAcademicYear)),
    [dateBasedAcademicYear]
  );

  const [startYear, setStartYear] = useState(
    String(Number(academicYear.split("/")[0]) || 2026)
  );
  const [termYear, setTermYear] = useState(
    String(parseStudyTerm(currentStudyTerm)?.year ?? new Date().getFullYear())
  );
  const [offeredTerm, setOfferedTerm] = useState<ModuleTerm>(
    offeredTermFromStudyTerm(currentStudyTerm)
  );
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const previewAcademicYear = formatAcademicYear(Number(startYear) || 2026);

  const previewStudyTerm = useMemo(() => {
    const year = Number(termYear);

    if (!Number.isInteger(year) || year < 2000) {
      return "";
    }

    return buildStudyTermFromYear(year, offeredTerm);
  }, [termYear, offeredTerm]);

  useEffect(() => {
    setStartYear(String(Number(academicYear.split("/")[0]) || 2026));

    const parsed = parseStudyTerm(currentStudyTerm);

    if (parsed) {
      setTermYear(String(parsed.year));
      setOfferedTerm(offeredTermFromStudyTerm(currentStudyTerm));
    }
  }, [academicYear, currentStudyTerm]);

  function applyDateDefaultToForm() {
    const parsed = parseStudyTerm(dateBasedStudyTerm);

    setStartYear(dateBasedStartYear);

    if (parsed) {
      setTermYear(String(parsed.year));
      setOfferedTerm(dateBasedOfferedTerm);
    }

    setMessage(t.resetToDateDefaultApplied);
  }

  async function handleSave() {
    if (!user) return;

    const year = Number(startYear);
    const studyTermYear = Number(termYear);

    if (!Number.isInteger(year) || year < 2000) {
      setMessage("Invalid start year");
      return;
    }

    if (!Number.isInteger(studyTermYear) || studyTermYear < 2000) {
      setMessage("Invalid term year");
      return;
    }

    if (!previewStudyTerm) {
      setMessage("Invalid current term");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const termChanged = previewStudyTerm !== currentStudyTerm;
      const yearChanged = previewAcademicYear !== academicYear;

      await saveAcademicYearAndTermSettings({
        startYear: year,
        studyTerm: previewStudyTerm,
        updatedBy: user.id,
      });

      await refreshAcademicYear();

      if (termChanged || yearChanged) {
        await recalculateAllStudentStatuses(previewStudyTerm);
      }

      setMessage(
        termChanged || yearChanged
          ? t.academicYearTermSavedWithStatusRecalc
          : t.academicYearTermSaved
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-container max-w-2xl space-y-6">
      <PageHeader
        title={t.academicYearAndTermSettings}
        description={t.academicYearAndTermSettingsDescription}
      />

      <section className="card">
        <div className="card-body space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {t.dateBasedSettings}
            </h2>
            <p className="text-sm text-slate-500">
              {t.dateBasedSettingsDescription}
            </p>
          </div>

          <div>
            <p className="form-label">{t.todayDate}</p>
            <p className="text-sm font-medium text-slate-800">
              {formatTodayDate(today)}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 px-3 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {t.academicYear}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {dateBasedAcademicYear}
              </p>
            </div>

            <div className="rounded-lg bg-slate-50 px-3 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {t.currentTerm}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {dateBasedOfferedTerm}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {dateBasedStudyTerm}
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-500">{t.currentTermCalendarHint}</p>
        </div>
      </section>

      <section className="card">
        <div className="card-body space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {t.manualSettings}
            </h2>
            <p className="text-sm text-slate-500">
              {t.manualSettingsDescription}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t.savedSettings}
            </p>
            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              <p>
                <span className="text-slate-500">{t.academicYear}: </span>
                <span className="font-medium text-slate-900">
                  {academicYear}
                </span>
              </p>
              <p>
                <span className="text-slate-500">{t.previousAcademicYear}: </span>
                <span className="font-medium text-slate-900">
                  {previousAcademicYear}
                </span>
              </p>
              <p className="sm:col-span-2">
                <span className="text-slate-500">{t.currentTerm}: </span>
                <span className="font-medium text-slate-900">
                  {offeredTermFromStudyTerm(currentStudyTerm)} ({currentStudyTerm})
                </span>
              </p>
            </div>
          </div>

          <div className="space-y-4 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">
              {t.editSettings}
            </h3>

            <div>
              <label className="form-label" htmlFor="manual-start-year">
                {t.startYear}
              </label>
              <input
                id="manual-start-year"
                className="form-input"
                value={startYear}
                onChange={(event) => setStartYear(event.target.value)}
                placeholder="2026"
              />
              <p className="mt-1 text-xs text-slate-500">
                {t.academicYearPreview}: {previewAcademicYear}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="form-label" htmlFor="manual-offered-term">
                  {t.currentTerm}
                </label>
                <select
                  id="manual-offered-term"
                  className="form-select"
                  value={offeredTerm}
                  onChange={(event) =>
                    setOfferedTerm(event.target.value as ModuleTerm)
                  }
                >
                  {OFFERED_TERMS.map((term) => (
                    <option key={term} value={term}>
                      {term}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label" htmlFor="manual-term-year">
                  {t.termYear}
                </label>
                <input
                  id="manual-term-year"
                  className="form-input"
                  value={termYear}
                  onChange={(event) => setTermYear(event.target.value)}
                  placeholder="2026"
                />
              </div>
            </div>

            <p className="text-xs text-slate-500">
              {t.studyTermPreview}:{" "}
              <span className="font-medium text-slate-800">
                {previewStudyTerm || "-"}
              </span>
            </p>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={applyDateDefaultToForm}
              >
                {t.applyDateDefaultToForm}
              </button>

              <button
                className="btn btn-primary"
                type="button"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? t.loading : t.save}
              </button>
            </div>
          </div>

          {message && (
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
              {message}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
