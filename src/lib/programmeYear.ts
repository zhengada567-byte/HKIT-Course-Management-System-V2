/** Canonical programme / intake year labels (Y1, Y2, Y3, …). */
export const PROGRAMME_YEAR_OPTIONS = ["Y1", "Y2", "Y3", "Y4"] as const;

/** Intake level choices shown on study plan student profiles. */
export const INTAKE_LEVEL_OPTIONS = ["Y1", "Y2", "Y3"] as const;

export type ProgrammeYearLabel = (typeof PROGRAMME_YEAR_OPTIONS)[number];

/**
 * Normalize free-text year values to Y1 / Y2 / Y3 style.
 *
 * Accepts: "Year 1", "year 2", "Y3", "3", "1"
 */
export function normalizeProgrammeYear(
  value: string | null | undefined
): string | null {
  const text = String(value ?? "").trim();

  if (!text) {
    return null;
  }

  const upper = text.toUpperCase();

  if (/^Y\d+$/.test(upper)) {
    return upper;
  }

  const matched = text.match(/(?:year\s*)?(\d+)/i) ?? text.match(/^(\d+)$/);

  if (matched?.[1]) {
    return `Y${matched[1]}`;
  }

  return text;
}

export function normalizeIntakeLevel(
  value: string | null | undefined
): string | null {
  return normalizeProgrammeYear(value);
}

export function formatProgrammeYearDisplay(
  value: string | null | undefined
): string {
  return normalizeProgrammeYear(value) ?? (String(value ?? "").trim() || "-");
}
