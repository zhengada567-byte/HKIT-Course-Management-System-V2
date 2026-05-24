import type {
  TeachingMode,
  TeachingStatus,
} from "../../../types";

export type Step =
  | "planning"
  | "student_numbers"
  | "combine"
  | "split"
  | "assignment";

export const modeOptions: TeachingMode[] = ["Day", "Night", "Saturday"];

export const teachingStatusOptions: TeachingStatus[] = ["FT", "PT"];
