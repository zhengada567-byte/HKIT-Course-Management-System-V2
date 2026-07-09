/**
 * Classify uploaded module codes for Degree study plans.
 *
 * When a module is not found in the system catalog:
 * - HD-style codes: 2 letters + 3 digits (e.g. HD401, CS422)
 * - Degree-style codes: total length typically > 5 (e.g. BSBFM1001)
 */

export function getBaseModuleCode(value: unknown): string {
  let code = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s*\([^)]*\)/g, "");

  const explicitAliases: Record<string, string> = {
    HD406: "HD401",
    HD407: "HD402",
  };

  if (explicitAliases[code]) {
    return explicitAliases[code];
  }

  const underscoreIndex = code.indexOf("_");

  if (underscoreIndex > 0) {
    const base = code.slice(0, underscoreIndex);

    if (explicitAliases[base]) {
      return explicitAliases[base];
    }

    if (/^[A-Z]{2,4}\d{3}[A-Z]?$/.test(base)) {
      return base;
    }
  }

  return code;
}

/** HD / bridging module pattern: exactly 2 letters + 3 digits. */
export function isHdStyleModuleCode(value: unknown): boolean {
  const base = getBaseModuleCode(value);

  if (!base) return false;

  return /^[A-Z]{2}\d{3}$/.test(base);
}

/** Degree programme module pattern: code length typically greater than 5. */
export function isDegreeStyleModuleCode(value: unknown): boolean {
  const base = getBaseModuleCode(value);

  if (!base) return false;

  return base.length > 5;
}

export function inferPlanStageFromModuleCode(
  value: unknown
): "bridging" | "programme" | null {
  if (isHdStyleModuleCode(value)) {
    return "bridging";
  }

  if (isDegreeStyleModuleCode(value)) {
    return "programme";
  }

  return null;
}

const EXPORT_TERM_SUFFIX_PATTERN = /^([A-Z]{2,4}\d{3})(FEB|SEP|JUN)$/;

/**
 * Column identity for aligned study-plan export.
 * e.g. BUS692Feb and BUS692 both map to BUS692.
 */
export function getStudyPlanExportColumnKey(value: unknown): string {
  const base = getBaseModuleCode(value);
  const match = base.match(EXPORT_TERM_SUFFIX_PATTERN);

  if (match) {
    return match[1];
  }

  return base;
}

export function studyPlanExportModuleCodesMatch(
  left: unknown,
  right: unknown
): boolean {
  return (
    getStudyPlanExportColumnKey(left) === getStudyPlanExportColumnKey(right)
  );
}
