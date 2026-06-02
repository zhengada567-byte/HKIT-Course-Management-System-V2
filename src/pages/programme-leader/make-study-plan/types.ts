export type StudyMode = "FT" | "PT";

export type StudyPlanModuleStatus =
  | "planned"
  | "exempted"
  | "failed";

export type StudentStatus =
  | "potential"
  | "bridging"
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

  /**
   * From programmes.programme_type (e.g. Degree, HD).
   * Used to distinguish Degree vs HD behaviour in study plan rules.
   */
  programmeType?: string;

  studentStatus?: StudentStatus;
  intakeTerm?: string;
  graduateTerm?: string;

  /**
   * HD only: include this profile in Degree new intake report (articulated HD source).
   * Default true. PL can set false to exclude from report counts only.
   */
  okToArticulate?: boolean;
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
   * Module identity (modules table):
   * moduleCode + programmeCode + programmeStream
   */
  programmeCode: string;
  programmeStream?: string;

  moduleCode: string;
  moduleName: string;
  moduleYear?: string;

  /**
   * Catalog offered term from modules table (Sep / Feb / Jun).
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
