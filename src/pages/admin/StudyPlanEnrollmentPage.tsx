import { useEffect, useState } from "react";

import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { HdCoreEnrollmentRulesPanel } from "./components/HdCoreEnrollmentRulesPanel";
import type { ModuleTerm } from "../../types/common";

const OFFERED_TERMS: ModuleTerm[] = ["Feb", "Jun", "Sep"];

export function StudyPlanEnrollmentPage() {
  const { academicYear, currentOfferedTerm } = useAcademicYear();
  const { t } = useLanguage();

  const [selectedYear, setSelectedYear] = useState(academicYear);
  const [offeredTerm, setOfferedTerm] = useState<ModuleTerm>(currentOfferedTerm);

  useEffect(() => {
    setSelectedYear(academicYear);
  }, [academicYear]);

  useEffect(() => {
    setOfferedTerm(currentOfferedTerm);
  }, [currentOfferedTerm]);

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
    </div>
  );
}
