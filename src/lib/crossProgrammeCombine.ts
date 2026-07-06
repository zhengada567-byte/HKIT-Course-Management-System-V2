import type { UserRole } from "../types/auth";

function normalizeCodePart(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toUpperCase();
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

export function isCrossProgrammeManualGroup(
  modules: Array<{ programme_code: string | null | undefined }>
) {
  return getDistinctProgrammeCodes(modules).length >= 2;
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
