import { Lock } from "lucide-react";

import { useLanguage } from "../../contexts/LanguageContext";
import type { FeatureUpdateLockFeature } from "../../services/featureLockService";

export function FeatureUpdateLockBanner(props: {
  feature: FeatureUpdateLockFeature;
  locked: boolean;
}) {
  const { t } = useLanguage();

  if (!props.locked) {
    return null;
  }

  const messageByFeature: Record<FeatureUpdateLockFeature, string> = {
    courseSearch: t.featureUpdateLocksCourseSearchBanner,
    moduleTeacher: t.featureUpdateLocksModuleTeacherBanner,
    uploadExcel: t.featureUpdateLocksUploadExcelBanner,
  };

  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{messageByFeature[props.feature]}</span>
    </div>
  );
}
