import { supabase } from "../lib/supabase";
import { getAcademicYearVariants } from "../lib/utils";
import type { ModuleRow, ModuleTerm } from "../types";
import {
  assertPlanningModulesCanExclude,
  excludePlanningModules,
  restorePlanningModules,
} from "./timetablePlanningOfferingService";
import { ensureTimetablePlanningModules } from "./timetableService";

export type PlanningOfferingByModuleId = Map<
  string,
  {
    planningModuleId: string;
    offeringActive: boolean;
  }
>;

export async function loadPlanningOfferingByModuleId(params: {
  academicYear: string;
  programmeCode: string;
  moduleTerm?: ModuleTerm;
}): Promise<PlanningOfferingByModuleId> {
  let query = supabase
    .from("timetable_planning_modules")
    .select("id, module_id, offering_status")
    .in("academic_year", getAcademicYearVariants(params.academicYear))
    .eq("programme_code", params.programmeCode);

  if (params.moduleTerm) {
    query = query.eq("module_term", params.moduleTerm);
  }

  const { data, error } = await query;

  if (error) throw error;

  const map: PlanningOfferingByModuleId = new Map();

  for (const row of data ?? []) {
    const moduleId = String(row.module_id ?? "").trim();
    if (!moduleId) continue;

    map.set(moduleId, {
      planningModuleId: String(row.id),
      offeringActive: row.offering_status !== "excluded",
    });
  }

  return map;
}

export function isModuleOfferingActive(
  offeringMap: PlanningOfferingByModuleId,
  moduleId: string
) {
  const entry = offeringMap.get(moduleId);
  if (!entry) return true;
  return entry.offeringActive;
}

export async function syncModuleOfferingsFromTeacherAssignment(params: {
  academicYear: string;
  programmeCode: string;
  moduleTerm: ModuleTerm;
  createdBy: string;
  modules: ModuleRow[];
  offerings: Array<{ moduleId: string; offering: boolean }>;
}) {
  if (params.modules.length === 0) {
    return;
  }

  await ensureTimetablePlanningModules({
    academicYear: params.academicYear,
    programmeCode: params.programmeCode,
    moduleTerm: params.moduleTerm,
    createdBy: params.createdBy,
  });

  const offeringMap = await loadPlanningOfferingByModuleId({
    academicYear: params.academicYear,
    programmeCode: params.programmeCode,
    moduleTerm: params.moduleTerm,
  });

  const toRestore: string[] = [];
  const toExclude: string[] = [];

  for (const item of params.offerings) {
    const planning = offeringMap.get(item.moduleId);
    if (!planning) continue;

    if (item.offering && !planning.offeringActive) {
      toRestore.push(planning.planningModuleId);
    } else if (!item.offering && planning.offeringActive) {
      toExclude.push(planning.planningModuleId);
    }
  }

  if (toRestore.length > 0) {
    await restorePlanningModules(toRestore);
  }

  if (toExclude.length > 0) {
    await assertPlanningModulesCanExclude(toExclude);
    await excludePlanningModules({
      planningModuleIds: toExclude,
      excludedBy: params.createdBy,
    });
  }
}
