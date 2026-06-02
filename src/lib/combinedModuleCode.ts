/**
 * HDC modules that do not require a computer room (timetable auto-schedule).
 */
export const HDC_MODULES_WITHOUT_COMPUTER_ROOM = new Set([
  "GS407",
  "CS401",
  "CS416",
  "CS407",
  "CS424",
  "HD401",
  "HD402",
  "HD403",
  "HD404",
  "HD405",
  "HD408",
]);

export function resolveBaseModuleCodeForProgramme(params: {
  members: Array<{ module_code: string; programme_code: string }>;
  programmeCode?: string;
}): string {
  const members = params.members
    .map((m) => ({
      module_code: String(m.module_code ?? "").trim(),
      programme_code: String(m.programme_code ?? "").trim(),
    }))
    .filter((m) => m.module_code);

  if (members.length === 0) return "";

  const pageProgramme = String(params.programmeCode ?? "").trim().toUpperCase();
  if (pageProgramme && pageProgramme !== "MIXED") {
    const match = members.find(
      (m) => m.programme_code.toUpperCase() === pageProgramme
    );
    if (match) return match.module_code;
  }

  const programmes = new Set(
    members.map((m) => m.programme_code.toUpperCase()).filter(Boolean)
  );
  if (programmes.size === 1) {
    return members[0]!.module_code;
  }

  const sorted = [...members].sort((a, b) => {
    const pc = a.programme_code.localeCompare(b.programme_code);
    if (pc !== 0) return pc;
    return a.module_code.localeCompare(b.module_code);
  });
  return sorted[0]!.module_code;
}

function legacyHdcModuleRequiresComputerRoom(params: {
  programmeCode?: string;
  moduleInstanceCode: string;
  effectiveModuleCode: string;
}): boolean {
  const programmeCode = String(params.programmeCode ?? "").trim().toUpperCase();
  const instance = String(params.moduleInstanceCode ?? "").trim().toUpperCase();
  const isHdc = programmeCode === "HDC" || instance.includes("_HDC_");
  if (!isHdc) return false;

  const base = String(params.effectiveModuleCode ?? "").trim().toUpperCase();
  if (!base) return true;

  return !HDC_MODULES_WITHOUT_COMPUTER_ROOM.has(base);
}

/** Uses modules.uses_computer when provided; otherwise legacy HDC whitelist. */
export function moduleRequiresComputerRoom(params: {
  programmeCode?: string;
  moduleInstanceCode: string;
  effectiveModuleCode: string;
  usesComputerFlag?: string | null;
}): boolean {
  if (params.usesComputerFlag !== undefined && params.usesComputerFlag !== null) {
    return String(params.usesComputerFlag).trim().toUpperCase() === "Y";
  }

  return legacyHdcModuleRequiresComputerRoom(params);
}
