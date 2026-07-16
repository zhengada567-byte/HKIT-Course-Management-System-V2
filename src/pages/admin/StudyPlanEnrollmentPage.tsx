import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { HdCoreEnrollmentRulesPanel } from "./components/HdCoreEnrollmentRulesPanel";
import { listProgrammes } from "../../services/programmeService";
import {
  downloadEnrollmentProfile,
  type EnrollmentProfileExportScope,
} from "../../services/studyPlanEnrollmentExportService";
import type { ModuleTerm } from "../../types/common";
import type { ProgrammeRow } from "../../types";

const OFFERED_TERMS: ModuleTerm[] = ["Feb", "Jun", "Sep"];

export function StudyPlanEnrollmentPage() {
  const { academicYear, currentOfferedTerm } = useAcademicYear();
  const { t } = useLanguage();

  const [selectedYear, setSelectedYear] = useState(academicYear);
  const [offeredTerm, setOfferedTerm] = useState<ModuleTerm>(currentOfferedTerm);
  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [exportScope, setExportScope] =
    useState<EnrollmentProfileExportScope>("programme");
  const [exportProgrammeCode, setExportProgrammeCode] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");

  useEffect(() => {
    setSelectedYear(academicYear);
  }, [academicYear]);

  useEffect(() => {
    setOfferedTerm(currentOfferedTerm);
  }, [currentOfferedTerm]);

  useEffect(() => {
    void listProgrammes().then(setProgrammes);
  }, []);

  const programmeCodes = programmes
    .map((row) => String(row.programme_code ?? "").trim())
    .filter(Boolean)
    .sort();

  useEffect(() => {
    if (exportProgrammeCode) return;
    if (programmeCodes.length === 0) return;
    setExportProgrammeCode(programmeCodes[0]!);
  }, [exportProgrammeCode, programmeCodes]);

  async function handleExportEnrollmentProfile() {
    if (exportScope === "programme" && !exportProgrammeCode) {
      setExportMessage(t.enrollmentProfileSelectProgramme);
      return;
    }

    setExporting(true);
    setExportMessage("");

    try {
      const result = await downloadEnrollmentProfile({
        scope: exportScope,
        academicYear: selectedYear,
        offeredTerm,
        programmeCode: exportProgrammeCode || undefined,
        notEnrolledLabel: t.enrollmentProfileNotEnrolled,
      });

      setExportMessage(
        t.enrollmentProfileExported
          .replace("{count}", String(result.rowCount))
          .replace("{file}", result.fileName)
      );
    } catch (error) {
      setExportMessage(
        error instanceof Error ? error.message : t.enrollmentProfileExportFailed
      );
    } finally {
      setExporting(false);
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

      <section className="rounded-md border bg-card p-4 space-y-4">
        <div>
          <h2 className="text-base font-semibold">{t.enrollmentProfileExportTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t.enrollmentProfileExportDescription}
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="form-label">{t.enrollmentProfileExportScope}</label>
            <select
              className="form-select"
              value={exportScope}
              title={t.enrollmentProfileExportScope}
              disabled={exporting}
              onChange={(event) =>
                setExportScope(event.target.value as EnrollmentProfileExportScope)
              }
            >
              <option value="programme">{t.enrollmentProfileScopeProgramme}</option>
              <option value="all">{t.enrollmentProfileScopeAll}</option>
            </select>
          </div>

          {exportScope === "programme" && (
            <div>
              <label className="form-label">{t.programmeCode}</label>
              <select
                className="form-select"
                value={exportProgrammeCode}
                title={t.programmeCode}
                disabled={exporting || programmeCodes.length === 0}
                onChange={(event) => setExportProgrammeCode(event.target.value)}
              >
                <option value="">—</option>
                {programmeCodes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-end">
            <button
              type="button"
              className="btn btn-primary inline-flex items-center gap-2"
              disabled={exporting}
              onClick={() => void handleExportEnrollmentProfile()}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {exporting ? t.loading : t.enrollmentProfileExportButton}
            </button>
          </div>
        </div>

        {exportMessage && (
          <p className="text-sm text-slate-700">{exportMessage}</p>
        )}
      </section>

      <HdCoreEnrollmentRulesPanel
        academicYear={selectedYear}
        offeredTerm={offeredTerm}
      />
    </div>
  );
}
