import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ModuleTerm } from "../types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatAcademicYear(startYear: number) {
  return `${startYear}/${startYear + 1}`;
}

export function academicYearToStartYear(academicYear: string) {
  const [start] = academicYear.split("/");
  return Number(start);
}

/**
 * Canonical label for DB writes and UI: `2026/2027`.
 * Accepts short (`2026/27`) or long (`2026/2027`) input.
 */
export function normalizeAcademicYear(academicYear: string): string {
  const trimmed = String(academicYear ?? "").trim();

  if (!trimmed) {
    return trimmed;
  }

  const [startPart, endPart] = trimmed.split("/");
  const startYear = Number(startPart);

  if (!Number.isFinite(startYear) || startYear < 1900) {
    return trimmed;
  }

  if (!endPart) {
    return formatAcademicYear(startYear);
  }

  const endYear =
    endPart.length <= 2
      ? Math.floor(startYear / 100) * 100 + Number(endPart)
      : Number(endPart);

  if (!Number.isFinite(endYear)) {
    return formatAcademicYear(startYear);
  }

  if (endYear === startYear + 1) {
    return formatAcademicYear(startYear);
  }

  return formatAcademicYear(startYear);
}

export function getPreviousAcademicYear(academicYear: string) {
  const startYear = academicYearToStartYear(academicYear);
  return formatAcademicYear(startYear - 1);
}

export function getNextAcademicYear(academicYear: string) {
  const startYear = academicYearToStartYear(academicYear);

  if (!Number.isFinite(startYear)) {
    return academicYear;
  }

  return formatAcademicYear(startYear + 1);
}

/** Quota for academic year Y/(Y+1) locks at 00:00 on 1 July of calendar year Y. */
export function getQuotaLockStartDate(academicYear: string): Date {
  const startYear = academicYearToStartYear(academicYear);
  return new Date(startYear, 6, 1, 0, 0, 0, 0);
}

export function getQuotaEditDeadlineLabel(academicYear: string): string {
  const startYear = academicYearToStartYear(academicYear);

  if (!Number.isFinite(startYear)) {
    return "";
  }

  return `${startYear}年6月30日`;
}

export function isQuotaEditableByProgrammeLeader(
  academicYear: string,
  adminUnlockedUntil?: string | null
): boolean {
  if (adminUnlockedUntil) {
    const unlockEnd = new Date(adminUnlockedUntil);

    if (!Number.isNaN(unlockEnd.getTime()) && unlockEnd.getTime() > Date.now()) {
      return true;
    }
  }

  return Date.now() < getQuotaLockStartDate(academicYear).getTime();
}

/** Default quota planning year matches the app current academic year. */
export function getDefaultQuotaPlanningAcademicYear(
  currentAcademicYear: string
): string {
  return normalizeAcademicYear(currentAcademicYear);
}

/** Alternate academic-year labels used across study plan vs timetable. */
export function getAcademicYearVariants(academicYear: string): string[] {
  const startYear = academicYearToStartYear(academicYear);

  if (!Number.isFinite(startYear)) {
    return [academicYear];
  }

  const shortEnd = String(startYear + 1).slice(-2);
  const shortStart = String(startYear).slice(-2);

  return Array.from(
    new Set(
      [
        academicYear,
        `${startYear}/${startYear + 1}`,
        `${startYear}/${shortEnd}`,
        `${startYear - 1}/${shortStart}`,
        `${startYear - 1}/${shortEnd}`,
      ].filter(Boolean)
    )
  );
}

export function academicYearsMatch(
  left: string | null | undefined,
  right: string | null | undefined
) {
  const a = String(left ?? "").trim();
  const b = String(right ?? "").trim();

  if (!a || !b) return false;
  if (a === b) return true;

  const variantsForA = new Set(getAcademicYearVariants(a));
  return variantsForA.has(b);
}

export function buildTeacherName(
  title?: string | null,
  familyName?: string | null,
  otherName?: string | null
) {
  return [title, familyName, otherName]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

export function normalizeStream(value?: string | null) {
  const trimmed = String(value ?? "").trim();
  return trimmed || "nil";
}

/** Whether Timetable Step 1 has a specific programme stream selected (not All Streams). */
export function hasSelectedTimetableStream(
  selectedStreamCode?: string | null
) {
  return Boolean(String(selectedStreamCode ?? "").trim());
}

/**
 * programme_stream written to / read from timetable_student_numbers during Sync.
 * - Specific stream selected → that stream (scheme B).
 * - All Streams → `nil` aggregate row.
 */
export function timetableProgrammeStreamFromSelection(
  selectedStreamCode?: string | null
) {
  if (hasSelectedTimetableStream(selectedStreamCode)) {
    return normalizeStream(selectedStreamCode);
  }

  return "nil";
}

/**
 * Map catalog offered term (Sep/Feb/Jun) to study term for an academic year.
 *
 * Example for 2026/2027:
 * - Sep -> T2026C
 * - Feb -> T2027A
 * - Jun -> T2027B
 *
 * If value is already T2025B format, return as-is.
 */
export function offeredTermToStudyTerm(
  academicYear: string,
  offeredTerm: string
): string {
  const text = String(offeredTerm ?? "").trim().toUpperCase();

  if (/^T\d{4}[ABC]$/.test(text)) {
    return text;
  }

  const startYear = academicYearToStartYear(normalizeAcademicYear(academicYear));

  if (!Number.isFinite(startYear)) {
    return text;
  }

  const letter = (() => {
    if (text === "FEB" || text === "FEBRUARY" || text === "A") return "A";
    if (text === "JUN" || text === "JUNE" || text === "B") return "B";
    if (
      text === "SEP" ||
      text === "SEPT" ||
      text === "SEPTEMBER" ||
      text === "C"
    ) {
      return "C";
    }

    return "A";
  })();

  const termYear = letter === "C" ? startYear : startYear + 1;

  return `T${termYear}${letter}`;
}

export function normalizeOptionalText(value?: string | null) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

export function generateNaturalCombineCode(moduleCode: string) {
  return `AUTO_${moduleCode}`;
}

export function generateManualCombinedCode(moduleCodes: string[]) {
  return [...new Set(moduleCodes.map((code) => code.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .join("_");
}

export function isTBC(teacherName: string) {
  return teacherName.trim().toUpperCase() === "TBC";
}

export function sanitizeAcademicYearForFilename(academicYear: string) {
  return academicYear.replace("/", "-");
}

export function parseNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const num = Number(value);

  if (Number.isNaN(num)) {
    return null;
  }

  return num;
}

export function parseIntegerOrZero(value: unknown) {
  const num = Number(value);

  if (Number.isNaN(num)) {
    return 0;
  }

  return Math.trunc(num);
}

export function getModuleTermOrder(term: ModuleTerm | string | null | undefined) {
  const order: Record<string, number> = {
    Sep: 1,
    Feb: 2,
    Jun: 3,
  };

  return order[String(term)] ?? 99;
}

export function getModuleYearOrder(year: string | null | undefined) {
  const text = String(year ?? "").toLowerCase();

  if (text.includes("1")) return 1;
  if (text.includes("2")) return 2;
  if (text.includes("3")) return 3;
  if (text.includes("4")) return 4;

  return 99;
}

export function formatDateTime(value?: string | null) {
  if (!value) return "-";

  return new Date(value).toLocaleString("zh-HK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function sumNumbers(values: Array<number | null | undefined>) {
  return values.reduce<number>(
    (sum, value) => sum + Number(value ?? 0),
    0
  );
}
