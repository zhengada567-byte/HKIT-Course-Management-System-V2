import type { ModuleTerm } from "../types/common";

/**
 * Catalogue study-plan codes that use a term suffix in timetable/planning
 * (e.g. BUS692 in study plan -> BUS692SEP / BUS692FEB in timetable).
 */
const TERM_SUFFIX_CATALOG_MODULE_CODES = new Set(["BUS692"]);

const OFFERED_TERM_SUFFIXES: ModuleTerm[] = ["Sep", "Feb", "Jun"];

/** Embedded term suffix on codes — always SEP / FEB / JUN (not Sep/Feb/Jun). */
export type OfferedTermCodeSuffix = "SEP" | "FEB" | "JUN";

export function normalizeModuleCode(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase();
}

/** Map module_term (Sep) -> code suffix (SEP). */
export function offeredTermCodeSuffix(
  term: ModuleTerm
): OfferedTermCodeSuffix {
  return term.toUpperCase() as OfferedTermCodeSuffix;
}

/**
 * If a code ends with Sep/Feb/Jun (any case), normalize that suffix to SEP/FEB/JUN.
 * Does not change module_term fields — only codes that embed a term suffix
 * (e.g. UWLCFI1Sep -> UWLCFI1SEP, BUS692Feb -> BUS692FEB).
 */
export function canonicalizeEmbeddedTermSuffix(
  value: string | null | undefined
): string {
  const text = String(value ?? "").trim();
  if (!text) return text;

  const match = text.match(/^(.*)(sep|feb|jun)$/i);
  if (!match) return text;

  return `${match[1]}${match[2].toUpperCase()}`;
}

/** Uppercase + canonicalize embedded term suffix for stored module codes. */
export function canonicalizeModuleCode(value: string | null | undefined) {
  return canonicalizeEmbeddedTermSuffix(normalizeModuleCode(value));
}

export function isTermSuffixCatalogModuleCode(moduleCode: string) {
  return TERM_SUFFIX_CATALOG_MODULE_CODES.has(normalizeModuleCode(moduleCode));
}

/** Study-plan catalogue code -> timetable module_code for the offered term. */
export function catalogToTimetableModuleCode(
  catalogModuleCode: string,
  offeredTerm: ModuleTerm
) {
  const base = normalizeModuleCode(catalogModuleCode);
  if (!TERM_SUFFIX_CATALOG_MODULE_CODES.has(base)) {
    return base;
  }
  return `${base}${offeredTermCodeSuffix(offeredTerm)}`;
}

/**
 * Keys under which a timetable module_code should be indexed for study-plan lookup.
 * e.g. BUS692SEP -> [BUS692SEP, BUS692] when offeredTerm is Sep.
 */
export function timetableModuleLookupKeys(
  timetableModuleCode: string,
  offeredTerm: ModuleTerm
) {
  const code = canonicalizeModuleCode(timetableModuleCode);
  const keys = new Set<string>([code].filter(Boolean));

  for (const term of OFFERED_TERM_SUFFIXES) {
    const suffix = offeredTermCodeSuffix(term);
    if (!code.endsWith(suffix)) continue;

    const base = code.slice(0, -suffix.length);
    if (!TERM_SUFFIX_CATALOG_MODULE_CODES.has(base)) break;

    if (term === offeredTerm) {
      keys.add(base);
    }
    break;
  }

  return [...keys];
}

/**
 * Timetable module_code candidates when resolving a study-plan catalogue code.
 * e.g. BUS692 + Sep -> [BUS692, BUS692SEP].
 */
export function catalogModuleLookupKeys(
  catalogModuleCode: string,
  offeredTerm: ModuleTerm
) {
  const base = normalizeModuleCode(catalogModuleCode);
  const keys = new Set<string>([base].filter(Boolean));

  if (TERM_SUFFIX_CATALOG_MODULE_CODES.has(base)) {
    keys.add(catalogToTimetableModuleCode(base, offeredTerm));
  }

  return [...keys];
}

/**
 * Module codes whose timetable classes may be offered when enrolling a study-plan row.
 * Plan module stays as the catalogue code (e.g. HD405); PL may enrol into related
 * short bridging classes (HD405B) without changing other plan fields.
 *
 * - HD405 -> HD405, HD405B
 * - HD405B -> HD405B, HD405
 * - BUS692 (+ term) -> existing catalogue lookup keys only
 */
export function relatedEnrollmentModuleCodes(
  catalogModuleCode: string,
  offeredTerm?: ModuleTerm
) {
  const base = normalizeModuleCode(catalogModuleCode);
  const keys = new Set<string>();

  if (!base) return [];

  if (offeredTerm) {
    for (const key of catalogModuleLookupKeys(base, offeredTerm)) {
      keys.add(key);
    }
  } else {
    keys.add(base);
  }

  // Parent short-code style (2 letters + 3 digits): include bridging B offering.
  if (/^[A-Z]{2}\d{3}$/.test(base)) {
    keys.add(`${base}B`);
  }

  // Bridging short code: also allow parent full-class instances.
  if (/^[A-Z]{2}\d{3}B$/.test(base)) {
    keys.add(base.slice(0, -1));
  }

  return [...keys];
}
