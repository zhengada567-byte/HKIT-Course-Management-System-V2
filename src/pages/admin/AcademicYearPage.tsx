import { useState } from "react";

import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { formatAcademicYear } from "../../lib/utils";
import { setCurrentAcademicYearByStartYear } from "../../services/academicYearService";

export function AcademicYearPage() {
  const { user } = useAuth();
  const { academicYear, previousAcademicYear, refreshAcademicYear } =
    useAcademicYear();
  const { t } = useLanguage();

  const [startYear, setStartYear] = useState(
    String(Number(academicYear.split("/")[0]) || 2026)
  );
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const preview = formatAcademicYear(Number(startYear) || 2026);

  async function handleSave() {
    if (!user) return;

    const year = Number(startYear);

    if (!Number.isInteger(year) || year < 2000) {
      setMessage("Invalid start year");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      await setCurrentAcademicYearByStartYear(year, user.id);
      await refreshAcademicYear();
      setMessage("Saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.academicYear}
        description="Admin can set academic start year. Example: 2026 → 2026/2027."
      />

      <div className="card max-w-xl">
        <div className="card-body space-y-4">
          <div>
            <label className="form-label">{t.currentAcademicYear}</label>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">
              {academicYear}
            </div>
          </div>

          <div>
            <label className="form-label">{t.previousAcademicYear}</label>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">
              {previousAcademicYear}
            </div>
          </div>

          <div>
            <label className="form-label">{t.startYear}</label>
            <input
              className="form-input"
              value={startYear}
              onChange={(event) => setStartYear(event.target.value)}
              placeholder="2026"
            />
          </div>

          <div>
            <label className="form-label">Display Preview</label>
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">
              {preview}
            </div>
          </div>

          {message && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {message}
            </div>
          )}

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
    </div>
  );
}
