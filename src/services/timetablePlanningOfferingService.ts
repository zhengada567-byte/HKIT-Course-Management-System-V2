import { supabase } from "../lib/supabase";
import { isActivePlanningModule } from "../lib/timetablePlanningOffering";
import type { TimetablePlanningModuleRow } from "../types";

export type PlanningModuleExclusionBlocker =
  | "already_excluded"
  | "manual_combine"
  | "natural_combine"
  | "split_started"
  | "assignment_started"
  | "combine_group_link"
  | "timetable_module"
  | "timetable_instance";

const BLOCKER_MESSAGES: Record<PlanningModuleExclusionBlocker, string> = {
  already_excluded: "This module is already excluded from the offering list.",
  manual_combine:
    "Undo manual combine for this module before excluding it from the offering list.",
  natural_combine:
    "Undo natural combine for this module before excluding it from the offering list.",
  split_started:
    "Undo split decisions for this module before excluding it from the offering list.",
  assignment_started:
    "Undo teaching assignments for this module before excluding it from the offering list.",
  combine_group_link:
    "Remove this module from its combine group before excluding it from the offering list.",
  timetable_module:
    "Remove generated timetable module rows (undo split/combine) before excluding this module.",
  timetable_instance:
    "Remove module instances / schedule rows before excluding this module from the offering list.",
};

export function formatPlanningExclusionBlockers(
  blockers: PlanningModuleExclusionBlocker[]
) {
  return [...new Set(blockers)].map((key) => BLOCKER_MESSAGES[key]).join(" ");
}

async function loadPlanningModule(planningModuleId: string) {
  const { data, error } = await supabase
    .from("timetable_planning_modules")
    .select("*")
    .eq("id", planningModuleId)
    .maybeSingle();

  if (error) throw error;

  return (data ?? null) as TimetablePlanningModuleRow | null;
}

export async function getPlanningModuleExclusionBlockers(
  planningModuleId: string
): Promise<PlanningModuleExclusionBlocker[]> {
  const module = await loadPlanningModule(planningModuleId);

  if (!module) {
    return ["timetable_module"];
  }

  if (!isActivePlanningModule(module)) {
    return ["already_excluded"];
  }

  const blockers: PlanningModuleExclusionBlocker[] = [];

  if (module.manual_combine_group_id) {
    blockers.push("manual_combine");
  }

  if (module.natural_combine_code) {
    blockers.push("natural_combine");
  }

  if (module.split_status !== "not_started") {
    blockers.push("split_started");
  }

  if (module.assignment_status !== "not_started") {
    blockers.push("assignment_started");
  }

  const [
    combineLinkResult,
    timetableModuleResult,
    instanceResult,
  ] = await Promise.all([
    supabase
      .from("combine_group_modules")
      .select("id")
      .eq("planning_module_id", planningModuleId)
      .limit(1),
    supabase
      .from("timetable_modules")
      .select("id")
      .eq("planning_module_id", planningModuleId)
      .limit(1),
    supabase
      .from("timetable_module_instances")
      .select("id")
      .eq("source_planning_module_id", planningModuleId)
      .limit(1),
  ]);

  if (combineLinkResult.error) throw combineLinkResult.error;
  if (timetableModuleResult.error) throw timetableModuleResult.error;
  if (instanceResult.error) throw instanceResult.error;

  if ((combineLinkResult.data ?? []).length > 0) {
    blockers.push("combine_group_link");
  }

  if ((timetableModuleResult.data ?? []).length > 0) {
    blockers.push("timetable_module");
  }

  if ((instanceResult.data ?? []).length > 0) {
    blockers.push("timetable_instance");
  }

  return blockers;
}

export async function assertPlanningModulesCanExclude(
  planningModuleIds: string[]
) {
  const uniqueIds = [...new Set(planningModuleIds.filter(Boolean))];

  if (uniqueIds.length === 0) {
    throw new Error("No planning module selected.");
  }

  const blockerSets = await Promise.all(
    uniqueIds.map((id) => getPlanningModuleExclusionBlockers(id))
  );

  const actionableBlockers = blockerSets
    .flat()
    .filter((blocker) => blocker !== "already_excluded");

  if (actionableBlockers.length > 0) {
    throw new Error(formatPlanningExclusionBlockers(actionableBlockers));
  }
}

export async function excludePlanningModules(params: {
  planningModuleIds: string[];
  excludedBy: string;
}) {
  const uniqueIds = [...new Set(params.planningModuleIds.filter(Boolean))];

  await assertPlanningModulesCanExclude(uniqueIds);

  const { error } = await supabase
    .from("timetable_planning_modules")
    .update({
      offering_status: "excluded",
      excluded_at: new Date().toISOString(),
      excluded_by: params.excludedBy,
    })
    .in("id", uniqueIds)
    .eq("offering_status", "active");

  if (error) throw error;
}

export async function restorePlanningModules(planningModuleIds: string[]) {
  const uniqueIds = [...new Set(planningModuleIds.filter(Boolean))];

  if (uniqueIds.length === 0) {
    return;
  }

  const { error } = await supabase
    .from("timetable_planning_modules")
    .update({
      offering_status: "active",
      excluded_at: null,
      excluded_by: null,
    })
    .in("id", uniqueIds)
    .eq("offering_status", "excluded");

  if (error) throw error;
}
