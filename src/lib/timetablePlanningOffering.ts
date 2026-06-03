import type {
  PlanningOfferingStatus,
  TimetablePlanningModuleRow,
} from "../types";

export function normalizeOfferingStatus(
  value: string | null | undefined
): PlanningOfferingStatus {
  return value === "excluded" ? "excluded" : "active";
}

export function isActivePlanningModule(
  row: Pick<TimetablePlanningModuleRow, "offering_status">
) {
  return normalizeOfferingStatus(row.offering_status) === "active";
}

export function filterActivePlanningModules<
  T extends Pick<TimetablePlanningModuleRow, "offering_status">,
>(rows: T[]) {
  return rows.filter(isActivePlanningModule);
}

export function filterExcludedPlanningModules<
  T extends Pick<TimetablePlanningModuleRow, "offering_status">,
>(rows: T[]) {
  return rows.filter((row) => !isActivePlanningModule(row));
}
