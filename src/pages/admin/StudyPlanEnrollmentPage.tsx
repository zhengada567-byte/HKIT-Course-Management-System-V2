import { useEffect, useState } from "react";

import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { batchEnrollStudyPlanStudents } from "../../services/studyPlanEnrollmentService";
import { HdCoreEnrollmentRulesPanel } from "./components/HdCoreEnrollmentRulesPanel";
import type { ModuleTerm } from "../../types/common";

const OFFERED_TERMS: ModuleTerm[] = ["Feb", "Jun", "Sep"];

export function StudyPlanEnrollmentPage() {
  const { academicYear, currentOfferedTerm } = useAcademicYear();
  const { t } = useLanguage();

  const [selectedYear, setSelectedYear] = useState(academicYear);
  const [offeredTerm, setOfferedTerm] = useState<ModuleTerm>(currentOfferedTerm);
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    setSelectedYear(academicYear);
  }, [academicYear]);

  useEffect(() => {
    setOfferedTerm(currentOfferedTerm);
  }, [currentOfferedTerm]);

  async function handleBatchEnroll() {
    setRunning(true);
    setMessage("");
    setWarnings([]);

    try {
      const result = await batchEnrollStudyPlanStudents({
        academicYear: selectedYear,
        offeredTerm,
        onlyEmpty,
      });

      setMessage(
        [
          `Assigned: ${result.assignedCount}`,
          `Skipped (already enrolled): ${result.skippedCount}`,
          `Warnings: ${result.warningCount}`,
        ].join(" · ")
      );
      setWarnings(result.warnings.slice(0, 100));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Batch enrollment failed."
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.studyPlanEnrollmentTitle}
        description={t.studyPlanEnrollmentDescription}
      />

      <div className="rounded-md border bg-card p-4 space-y-4 max-w-2xl">
        <div>
          <label className="form-label">{t.academicYear}</label>
          <input
            className="form-input"
            value={selectedYear}
            onChange={(event) => setSelectedYear(event.target.value)}
            placeholder="2026/27"
          />
        </div>

        <div>
          <label className="form-label">{t.moduleTerm}</label>
          <select
            className="form-select"
            value={offeredTerm}
            title={t.moduleTerm}
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
      </div>

      <HdCoreEnrollmentRulesPanel
        academicYear={selectedYear}
        offeredTerm={offeredTerm}
      />

      <div className="rounded-md border bg-card p-4 space-y-4 max-w-2xl">
        <div>
          <h2 className="text-base font-semibold">{t.studyPlanEnrollmentBatchTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t.studyPlanEnrollmentHint}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyEmpty}
            onChange={(event) => setOnlyEmpty(event.target.checked)}
          />
          {t.studyPlanEnrollmentOnlyEmpty}
        </label>

        <button
          type="button"
          className="btn btn-primary"
          disabled={running || !selectedYear.trim() || !offeredTerm}
          onClick={() => {
            void handleBatchEnroll();
          }}
        >
          {running ? t.processing : t.studyPlanEnrollmentRun}
        </button>

        {message ? (
          <p className="text-sm font-medium whitespace-pre-wrap">{message}</p>
        ) : null}

        {warnings.length > 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-1 max-h-64 overflow-y-auto">
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
