import { useLanguage } from "../../../../contexts/LanguageContext";
import type { ModuleTerm } from "../../../../types";
import { ModuleBasicSettingsEditor } from "./ModuleBasicSettingsEditor";

export function ModuleBasicSettingsModal({
  academicYear,
  programmeCode,
  moduleTerm,
  open,
  onClose,
}: {
  academicYear: string;
  programmeCode: string;
  moduleTerm: ModuleTerm;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLanguage();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-lg bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="module-basic-settings-title"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <h2 id="module-basic-settings-title" className="text-lg font-semibold">
            {t.moduleBasicSettings}
          </h2>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="p-4">
          <ModuleBasicSettingsEditor
            key={`${academicYear}|${programmeCode}|${moduleTerm}`}
            initialAcademicYear={academicYear}
            initialProgrammeCode={programmeCode}
            initialModuleTerm={moduleTerm}
            lockAcademicYear
            hideTeacherAvailabilityButton
            autoLoadOnOpen={Boolean(programmeCode)}
          />
        </div>
      </div>
    </div>
  );
}
