export type StudyMode = "FT" | "PT";

export type StudyPlanModuleStatus =
  | "planned"
  | "exempted"
  | "failed";

export type StudentStatus =
  | "potential"
  | "in_progress"
  | "graduated";

export type PlanStage =
  | "programme"
  | "bridging";

export type StudyTermCode = string;

export interface StudyPlanStudent {
  id?: string;
  studentId: string;
  studentName: string;
  intakeYear?: string;
  intakeLevel?: string;
  studyMode: StudyMode;
  programmeCode: string;
  programmeStream?: string;
  studentStatus?: StudentStatus;
  intakeTerm?: string;
  graduateTerm?: string;
}

export interface StudyPlanModule {
  id?: string;

  /**
   * Original module row id from modules table.
   * This is useful when the same module_code appears in different terms,
   * e.g. Project Feb / Project Sep.
   */
  sourceModuleId?: string;

  studentId?: string;
  studentProfileId?: string;

  /**
   * Module identity rule:
   * moduleCode + programmeCode + programmeStream + moduleTerm
   */
  programmeCode: string;
  programmeStream?: string;

  moduleCode: string;
  moduleName: string;
  moduleYear?: string;

  /**
   * The real offered term used to distinguish module instances.
   * Example:
   * - Sep
   * - Feb
   *
   * This should be used as part of module identity.
   */
  moduleTerm?: string;

  /**
   * Kept for backward compatibility with old UI/service code.
   * In current study plan logic, this usually mirrors moduleTerm.
   */
  moduleTermPattern?: string;

  deliveryMode?: string;
  moduleSequence?: number;

  planStage: PlanStage;

  status: StudyPlanModuleStatus;
  studyTerm?: StudyTermCode;

  isExempted: boolean;
  isFailed: boolean;
  isLocked: boolean;

  remark?: string;
}

export interface StudyPlanSettings {
  currentAcademicYear: string;
  currentStudyTerm: StudyTermCode;
}

export interface StudyPlanSummary {
  totalModules: number;
  exemptedModules: number;
  plannedModules: number;
  failedModules: number;
  modulesPerTerm: Record<StudyTermCode, number>;
  warnings: string[];
}

export interface StudyPlanReportRow {
  programmeCode: string;
  programmeStream?: string;
  intakeYear?: string;
  intakeLevel?: string;
  studyMode?: string;
  studentStatus?: string;
  intakeTerm?: StudyTermCode;
  graduateTerm?: StudyTermCode;
  studentCount: number;
}
