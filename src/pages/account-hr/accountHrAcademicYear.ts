import {
  formatAcademicYear,
  normalizeAcademicYear,
} from "../../lib/utils";

/** Default planning year for AccountHR finance pages (display: 2026/27). */
export const ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR =
  normalizeAcademicYear("2026/27");

/** Selectable years for AccountHR cost / rate pages. */
export function accountHrAcademicYearOptions() {
  const startYears = [2024, 2025, 2026, 2027, 2028];
  return startYears.map((year) => formatAcademicYear(year));
}
