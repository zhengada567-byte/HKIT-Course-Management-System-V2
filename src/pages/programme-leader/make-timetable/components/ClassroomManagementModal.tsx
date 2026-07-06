import { useLanguage } from "../../../../contexts/LanguageContext";
import { ClassroomManagementEditor } from "./ClassroomManagementEditor";

export function ClassroomManagementModal({
  academicYear,
  open,
  onClose,
  onChanged,
}: {
  academicYear: string;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t } = useLanguage();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="classroom-management-title"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <h2 id="classroom-management-title" className="text-lg font-semibold">
            {t.classroomManagement}
          </h2>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="p-4">
          <ClassroomManagementEditor
            key={academicYear}
            academicYear={academicYear}
            onChanged={onChanged}
          />
        </div>
      </div>
    </div>
  );
}
