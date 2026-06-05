export type ModuleTerm = "Sep" | "Feb" | "Jun";

/** Catalog module requirement: core (required) or optional (elective). */
export type ModuleType = "core" | "optional";

export type TeachingStatus = "FT" | "PT";

export type EmploymentType = "FT" | "PT" | "";

export type CombineType = "natural_same_module_code" | "manual" | "none";

export type CombineGroupType = "natural_same_module_code" | "manual";

export type CombineStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "confirmed"
  | "auto_confirmed";

export type ActualStudentNumberStatus = "complete" | "incomplete";

export type SplitStatus = "not_started" | "no_split" | "split";

export type AssignmentStatus = "not_started" | "assigned" | "confirmed";

export type PlanningOfferingStatus = "active" | "excluded";

export type TeachingMode = "Day" | "Night" | "Saturday";

export type ProgrammeType = "HD" | "Degree" | string;

export interface SelectOption {
  label: string;
  value: string;
}
