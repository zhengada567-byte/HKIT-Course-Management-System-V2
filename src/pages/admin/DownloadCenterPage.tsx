import { useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { downloadAdminModuleOfferingsExcel } from "../../services/adminDownloadCenterService";
import { downloadAllCourseModulesExcel } from "../../services/courseSearchService";
import { listProgrammes } from "../../services/programmeService";
import type { ProgrammeRow } from "../../types";

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

export function DownloadCenterPage() {
  const { role } = useAuth();
  const { academicYear } = useAcademicYear();
  const { t } = useLanguage();

  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [programmeCode, setProgrammeCode] = useState("");
  const [message, setMessage] = useState("");
  const [exportingCatalogue, setExportingCatalogue] = useState(false);
  const [exportingOfferings, setExportingOfferings] = useState(false);

  useEffect(() => {
    void listProgrammes()
      .then(setProgrammes)
      .catch(() => setProgrammes([]));
  }, []);

  const programmeCodes = useMemo(
    () =>
      Array.from(
        new Set(
          programmes
            .map((row) => normalizeText(row.programme_code))
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [programmes]
  );

  const busy = exportingCatalogue || exportingOfferings;

  async function handleDownloadCatalogue() {
    if (role !== "admin") return;
    setExportingCatalogue(true);
    setMessage("");
    try {
      const result = await downloadAllCourseModulesExcel({ role });
      setMessage(
        t.adminDownloadCatalogueDone
          .replace("{programmes}", String(result.programmeCount))
          .replace("{streams}", String(result.streamGroupCount))
          .replace("{modules}", String(result.moduleCount))
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : t.adminDownloadCatalogueFailed
      );
    } finally {
      setExportingCatalogue(false);
    }
  }

  async function handleDownloadOfferings() {
    if (role !== "admin") return;
    setExportingOfferings(true);
    setMessage("");
    try {
      const result = await downloadAdminModuleOfferingsExcel({
        academicYear,
        programmeCode: programmeCode || undefined,
        role,
      });
      setMessage(
        t.adminDownloadOfferingsDone
          .replace("{programmes}", String(result.programmeCount))
          .replace("{classes}", String(result.classCount))
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : t.adminDownloadOfferingsFailed
      );
    } finally {
      setExportingOfferings(false);
    }
  }

  if (role !== "admin") {
    return (
      <div className="page-container">
        <PageHeader
          title={t.adminDownloadCenterTitle}
          description={t.adminDownloadCenterDescription}
        />
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t.adminDownloadCenterAdminOnly}
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.adminDownloadCenterTitle}
        description={t.adminDownloadCenterDescription}
      />

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <div className="card-body space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {t.adminDownloadCatalogueTitle}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {t.adminDownloadCatalogueHint}
              </p>
            </div>

            <button
              type="button"
              className="btn btn-primary inline-flex items-center gap-2"
              disabled={busy}
              onClick={() => void handleDownloadCatalogue()}
            >
              {exportingCatalogue ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {exportingCatalogue ? t.loading : t.adminDownloadCatalogueButton}
            </button>
          </div>
        </section>

        <section className="card">
          <div className="card-body space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {t.adminDownloadOfferingsTitle}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {t.adminDownloadOfferingsHint}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="form-label">{t.academicYear}</label>
                <input
                  className="form-input bg-slate-50"
                  value={academicYear}
                  readOnly
                />
              </div>
              <div>
                <label className="form-label">{t.programmeCode}</label>
                <select
                  className="form-select"
                  value={programmeCode}
                  disabled={busy}
                  onChange={(event) => setProgrammeCode(event.target.value)}
                >
                  <option value="">{t.allProgrammes}</option>
                  {programmeCodes.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary inline-flex items-center gap-2"
              disabled={busy}
              onClick={() => void handleDownloadOfferings()}
            >
              {exportingOfferings ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {exportingOfferings ? t.loading : t.adminDownloadOfferingsButton}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
