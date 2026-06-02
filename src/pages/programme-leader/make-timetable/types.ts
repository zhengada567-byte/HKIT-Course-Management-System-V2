import type {
  TeachingMode,
  TeachingStatus,
} from "../../../types";

export type Step =
  | "student_numbers"
  | "combine"
  | "split"
  | "assignment"
  | "schedule";

export const modeOptions: TeachingMode[] = ["Day", "Night", "Saturday"];

export const teachingStatusOptions: TeachingStatus[] = ["FT", "PT"];
