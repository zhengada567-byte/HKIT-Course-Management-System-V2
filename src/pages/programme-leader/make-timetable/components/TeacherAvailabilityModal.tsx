import { useEffect, useMemo, useState } from "react";

import { useLanguage } from "../../../../contexts/LanguageContext";
import { teacherDisplayNameFromRow } from "../../../../lib/utils";
import { listTeachers } from "../../../../services/teacherService";
import { TeacherAvailabilityEditor } from "./TeacherAvailabilityEditor";

export function TeacherAvailabilityModal({
  academicYear,
  open,
  onClose,
  teacherNames: teacherNamesProp,
  readOnly = false,
}: {
  academicYear: string;
  open: boolean;
  onClose: () => void;
  /** When set, only these teachers are shown (e.g. module teacher page scope). */
  teacherNames?: string[];
  readOnly?: boolean;
}) {
  const { t } = useLanguage();
  const [catalogTeacherNames, setCatalogTeacherNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const useScopedTeachers = teacherNamesProp !== undefined;

  useEffect(() => {
    if (!open || useScopedTeachers) {
      setCatalogTeacherNames([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const rows = await listTeachers(academicYear);
        if (cancelled) return;
        setCatalogTeacherNames(
          rows
            .map((row) => teacherDisplayNameFromRow(row))
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b))
        );
      } catch (loadError) {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load teachers."
        );
        setCatalogTeacherNames([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [academicYear, open, useScopedTeachers]);

  const teacherNames = useMemo(() => {
    if (useScopedTeachers) {
      return [...new Set(teacherNamesProp.map((name) => name.trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b)
      );
    }
    return catalogTeacherNames;
  }, [catalogTeacherNames, teacherNamesProp, useScopedTeachers]);

  const editorKey = useMemo(
    () => `${academicYear}-${readOnly}-${teacherNames.join("\u0000")}`,
    [academicYear, readOnly, teacherNames]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="teacher-availability-title"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <h2 id="teacher-availability-title" className="text-lg font-semibold">
            {t.teacherAvailability}
          </h2>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="p-4">
          {loading ? (
            <p className="text-sm text-slate-600">Loading teachers…</p>
          ) : error ? (
            <p className="text-sm text-red-700">{error}</p>
          ) : teacherNames.length === 0 ? (
            <p className="text-sm text-slate-600">{t.teacherAvailabilityNoTeachers}</p>
          ) : (
            <TeacherAvailabilityEditor
              key={editorKey}
              academicYear={academicYear}
              teacherNames={teacherNames}
              readOnly={readOnly}
            />
          )}
        </div>
      </div>
    </div>
  );
}
