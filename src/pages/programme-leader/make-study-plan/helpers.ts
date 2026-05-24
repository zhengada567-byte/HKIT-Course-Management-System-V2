import type {
  StudentStatus,
  StudyPlanModule,
} from "./types";

export function normalizeStream(stream?: string | null): string {
  return (stream ?? "").trim();
}

export function parseStudyTerm(term?: string | null): {
  year: number;
  letter: "A" | "B" | "C";
} | null {
  if (!term) return null;

  const match = /^T(\d{4})([ABC])$/i.exec(term.trim());

  if (!match) return null;

  return {
    year: Number(match[1]),
    letter: match[2].toUpperCase() as "A" | "B" | "C",
  };
}

export function getTermIndex(term: string): number {
  const parsed = parseStudyTerm(term);

  if (!parsed) return Number.NaN;

  const letterIndex = {
    A: 0,
    B: 1,
    C: 2,
  }[parsed.letter];

  return parsed.year * 3 + letterIndex;
}

export function compareStudyTerm(
  a?: string | null,
  b?: string | null
): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  return getTermIndex(a) - getTermIndex(b);
}

/**
 * Full study term sequence:
 *
 * A -> B -> C -> next A
 *
 * Example:
 * T2027A -> T2027B
 * T2027B -> T2027C
 * T2027C -> T2028A
 *
 * Also supports:
 * T2026C -> T2027A
 */
export function getNextTerm(term: string): string {
  const parsed = parseStudyTerm(term);

  if (!parsed) return term;

  if (parsed.letter === "A") return `T${parsed.year}B`;
  if (parsed.letter === "B") return `T${parsed.year}C`;

  return `T${parsed.year + 1}A`;
}

/**
 * Normal term sequence excluding B / Jun.
 *
 * Keep this only for reports or legacy warnings.
 * Do NOT use this for structure-driven study plan generation.
 */
export function getNextNormalTerm(term: string): string {
  const parsed = parseStudyTerm(term);

  if (!parsed) return term;

  if (parsed.letter === "A") return `T${parsed.year}C`;
  if (parsed.letter === "B") return `T${parsed.year}C`;

  return `T${parsed.year + 1}A`;
}

export function isSummerTerm(term: string): boolean {
  return parseStudyTerm(term)?.letter === "B";
}

export function isNormalTerm(term: string): boolean {
  const letter = parseStudyTerm(term)?.letter;
  return letter === "A" || letter === "C";
}

export function studyTermToAcademicYear(studyTerm: string): string {
  const parsed = parseStudyTerm(studyTerm);

  if (!parsed) return "";

  if (parsed.letter === "C") {
    return `${parsed.year}/${String(parsed.year + 1).slice(-2)}`;
  }

  return `${parsed.year - 1}/${String(parsed.year).slice(-2)}`;
}

/**
 * Convert intake term to intake year.
 *
 * Business rule:
 * - T2026C => 2026 intake year
 * - T2027A => 2026 intake year
 * - T2027B => 2026 intake year
 */
export function intakeTermToIntakeYear(
  term?: string | null
): string | undefined {
  const parsed = parseStudyTerm(term);

  if (!parsed) return undefined;

  if (parsed.letter === "C") {
    return String(parsed.year);
  }

  if (parsed.letter === "A" || parsed.letter === "B") {
    return String(parsed.year - 1);
  }

  return String(parsed.year);
}

export function getEarliestStudyTerm(
  modules: StudyPlanModule[]
): string | undefined {
  const terms = modules
    .filter((m) => m.planStage === "programme")
    .filter((m) => m.status === "planned")
    .filter((m) => !!m.studyTerm)
    .map((m) => m.studyTerm as string)
    .sort(compareStudyTerm);

  return terms[0];
}

export function getLatestStudyTerm(
  modules: StudyPlanModule[]
): string | undefined {
  const terms = modules
    .filter((m) => m.planStage === "programme")
    .filter((m) => m.status === "planned")
    .filter((m) => !!m.studyTerm)
    .map((m) => m.studyTerm as string)
    .sort(compareStudyTerm);

  return terms[terms.length - 1];
}

export function calculateStudentStatus(
  modules: StudyPlanModule[],
  currentTerm: string
): StudentStatus {
  const plannedTerms = modules
    .filter((m) => m.planStage === "programme")
    .filter((m) => m.status === "planned")
    .filter((m) => !!m.studyTerm)
    .map((m) => m.studyTerm as string);

  if (plannedTerms.length === 0) return "potential";

  const sortedTerms = [...plannedTerms].sort(compareStudyTerm);
  const earliest = sortedTerms[0];
  const latest = sortedTerms[sortedTerms.length - 1];

  if (compareStudyTerm(latest, currentTerm) < 0) return "graduated";
  if (compareStudyTerm(earliest, currentTerm) > 0) return "potential";

  return "in_progress";
}

export function normalizeProgrammeType(value?: string | null): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Whether programmes.programme_type represents a Degree programme.
 * Authoritative source: programmes table column programme_type.
 */
export function isDegreeProgrammeType(programmeType?: string | null): boolean {
  const normalized = normalizeProgrammeType(programmeType);

  return (
    normalized === "degree" ||
    normalized === "ug" ||
    normalized === "undergraduate"
  );
}

/**
 * Whether programmes.programme_type represents an HD programme.
 */
export function isHDProgrammeType(programmeType?: string | null): boolean {
  const normalized = normalizeProgrammeType(programmeType);

  return normalized === "hd" || normalized === "higher diploma";
}

/**
 * Degree vs HD — requires programme_type from programmes table.
 * Do not guess from programme code alone.
 */
export function isDegreeProgramme(
  _programmeCode?: string | null,
  programmeType?: string | null
): boolean {
  if (!programmeType) {
    return false;
  }

  return isDegreeProgrammeType(programmeType);
}

export function isHDProgramme(
  _programmeCode?: string | null,
  programmeType?: string | null
): boolean {
  if (!programmeType) {
    return false;
  }

  return isHDProgrammeType(programmeType);
}

export function getDefaultIntakeLevel(
  programmeCode?: string | null,
  intakeLevel?: string,
  programmeType?: string | null
): string {
  if (intakeLevel) return intakeLevel;

  if (isDegreeProgramme(programmeCode, programmeType)) return "Year 3";

  return "Year 1";
}

export function summarizeStudyPlan(modules: StudyPlanModule[]) {
  const modulesPerTerm: Record<string, number> = {};

  for (const module of modules) {
    if (module.status === "planned" && module.studyTerm) {
      modulesPerTerm[module.studyTerm] =
        (modulesPerTerm[module.studyTerm] ?? 0) + 1;
    }
  }

  return {
    totalModules: modules.length,
    exemptedModules: modules.filter((m) => m.status === "exempted").length,
    plannedModules: modules.filter(
      (m) => m.status === "planned" && !!m.studyTerm
    ).length,
    failedModules: modules.filter((m) => m.status === "failed").length,
    modulesPerTerm,
  };
}
