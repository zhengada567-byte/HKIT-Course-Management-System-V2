import type { UserRole } from "../types/auth";

/**
 * Programme codes treated as one family for timetable governance (same PL).
 * HDCI is being phased out; HDCCI remains — until then both share one family.
 */
const PROGRAMME_EQUIVALENCE_GROUPS: string[][] = [["HDCCI", "HDCI"]];

function normalizeCodePart(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toUpperCase();
}

const programmeFamilyKeyByCode = (() => {
  const map = new Map<string, string>();

  for (const group of PROGRAMME_EQUIVALENCE_GROUPS) {
    const codes = [...new Set(group.map(normalizeCodePart).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b)
    );

    if (codes.length === 0) {
      continue;
    }

    const familyKey = codes.join("_");

    for (const code of codes) {
      map.set(code, familyKey);
    }
  }

  return map;
})();

export function getProgrammeFamilyKey(
  programmeCode: string | null | undefined
) {
  const code = normalizeCodePart(programmeCode);
  if (!code) {
    return "";
  }

  return programmeFamilyKeyByCode.get(code) ?? code;
}

export function getDistinctProgrammeCodes(
  modules: Array<{ programme_code: string | null | undefined }>
) {
  return [
    ...new Set(
      modules.map((module) => normalizeCodePart(module.programme_code)).filter(Boolean)
    ),
  ].sort((a, b) => a.localeCompare(b));
}

export function getDistinctProgrammeFamilies(
  modules: Array<{ programme_code: string | null | undefined }>
) {
  return [
    ...new Set(
      modules
        .map((module) => getProgrammeFamilyKey(module.programme_code))
        .filter(Boolean)
    ),
  ].sort((a, b) => a.localeCompare(b));
}

/**
 * Institute-wide cross-programme manual combine: spans two or more programme
 * families after equivalence (e.g. HDCCI+HDCI = one family; HDCCI+HDEE = cross).
 */
export function isCrossProgrammeManualGroup(
  modules: Array<{ programme_code: string | null | undefined }>
) {
  return getDistinctProgrammeFamilies(modules).length >= 2;
}

export function formatCrossProgrammeDownstreamLabel(
  state: "none" | "split_only" | "scheduled"
) {
  if (state === "scheduled") return "Scheduled";
  if (state === "split_only") return "Split (not scheduled)";
  return "Combine only";
}

export function assertAdminCanMutateCrossProgrammeGroup(params: {
  actorRole: UserRole;
  isCrossProgramme: boolean;
  action: string;
}) {
  if (!params.isCrossProgramme) {
    return;
  }

  if (params.actorRole === "admin") {
    return;
  }

  throw new Error(
    `Cross-programme combine groups are managed by Admin only. Cannot ${params.action}.`
  );
}
