/** Trim and collapse internal whitespace for stable comparisons. */
function normalizePart(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Combined modules store names as "A / B / A". Deduplicate while preserving order.
 */
export function dedupeJoinedModuleName(value: string | null | undefined) {
  const text = normalizePart(value);
  if (!text) return "";

  const parts = text
    .split(/\s*\/\s*/)
    .map((p) => normalizePart(p))
    .filter(Boolean);

  if (parts.length <= 1) return parts[0] ?? text;

  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(part);
  }

  return deduped.join(" / ");
}

/** Join planning module names for a combined group (unique only). */
export function joinUniqueModuleNames(
  names: Array<string | null | undefined>
): string {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const raw of names) {
    const part = normalizePart(raw);
    if (!part) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(part);
  }

  return deduped.join(" / ");
}

/** Join unique module codes for combined-group timetable display. */
export function joinUniqueModuleCodes(
  codes: Array<string | null | undefined>
): string {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const raw of codes) {
    const part = String(raw ?? "")
      .trim()
      .toUpperCase();
    if (!part) continue;
    if (seen.has(part)) continue;
    seen.add(part);
    deduped.push(part);
  }

  return deduped.sort((a, b) => a.localeCompare(b)).join(" / ");
}
