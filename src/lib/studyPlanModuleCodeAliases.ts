import type { ModuleTerm } from "../types/common";

/**
 * Catalogue study-plan codes that use a term suffix in timetable/planning
 * (e.g. BUS692 in study plan -> BUS692Sep / BUS692Feb in timetable).
 */
const TERM_SUFFIX_CATALOG_MODULE_CODES = new Set(["BUS692"]);

const OFFERED_TERM_SUFFIXES: ModuleTerm[] = ["Sep", "Feb", "Jun"];

function normalizeModuleCode(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase();
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
  return `${base}${offeredTerm}`;
}

/**
 * Keys under which a timetable module_code should be indexed for study-plan lookup.
 * e.g. BUS692Sep -> [BUS692SEP, BUS692] when offeredTerm is Sep.
 */
export function timetableModuleLookupKeys(
  timetableModuleCode: string,
  offeredTerm: ModuleTerm
) {
  const code = normalizeModuleCode(timetableModuleCode);
  const keys = new Set<string>([code]);

  for (const term of OFFERED_TERM_SUFFIXES) {
    if (!code.endsWith(term.toUpperCase())) continue;

    const base = code.slice(0, -term.length);
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
  const keys = new Set<string>([base]);

  if (TERM_SUFFIX_CATALOG_MODULE_CODES.has(base)) {
    keys.add(catalogToTimetableModuleCode(base, offeredTerm));
  }

  return [...keys];
}
