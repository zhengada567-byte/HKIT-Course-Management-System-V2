import { normalizeIntakeLevel } from "../../../lib/programmeYear";
import type { StudyPlanStudent } from "./types";
import {
  isDegreeProgramme,
  isHDProgramme,
} from "./helpers";

export type AutoGenerateEligibilityStatus =
  | "ready"
  | "has_programme_plan"
  | "ineligible"
  | "incomplete_profile";

export function isEligibleForAutoGenerateProfile(
  student: StudyPlanStudent,
  programmeType?: string | null
): boolean {
  if (student.studyMode !== "FT") {
    return false;
  }

  const intakeLevel = normalizeIntakeLevel(student.intakeLevel);
  const type = programmeType ?? student.programmeType;

  if (isHDProgramme(student.programmeCode, type)) {
    return intakeLevel === "Y1";
  }

  if (isDegreeProgramme(student.programmeCode, type)) {
    return intakeLevel === "Y3";
  }

  return false;
}

export function getAutoGenerateEligibility(params: {
  student: StudyPlanStudent;
  programmeType?: string | null;
  hasProgrammeModules: boolean;
}): AutoGenerateEligibilityStatus {
  if (params.hasProgrammeModules) {
    return "has_programme_plan";
  }

  const programmeCode = String(params.student.programmeCode ?? "").trim();
  const programmeStream = String(params.student.programmeStream ?? "").trim();
  const intakeTerm = String(params.student.intakeTerm ?? "").trim();

  if (!programmeCode || !programmeStream || !intakeTerm) {
    return "incomplete_profile";
  }

  if (
    !isEligibleForAutoGenerateProfile(params.student, params.programmeType)
  ) {
    return "ineligible";
  }

  return "ready";
}
