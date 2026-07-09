import { getStudyPlanExportColumnKey, studyPlanExportModuleCodesMatch } from "./studyPlanModuleCode";
import type { StudyPlanModule } from "../pages/programme-leader/make-study-plan/types";

export function buildDegreeCatalogColumnKeys(
  catalogModules: StudyPlanModule[]
): Set<string> {
  const keys = new Set<string>();

  for (const module of catalogModules) {
    const key = getStudyPlanExportColumnKey(module.moduleCode);

    if (key) {
      keys.add(key);
    }
  }

  return keys;
}

export function isModuleCodeInDegreeCatalog(
  moduleCode: string,
  catalogModules: StudyPlanModule[]
): boolean {
  return catalogModules.some((entry) =>
    studyPlanExportModuleCodesMatch(entry.moduleCode, moduleCode)
  );
}
