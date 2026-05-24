import type { StudyPlanModule, StudyPlanStudent } from "./types";
import { isDegreeProgramme } from "./helpers";

interface GenerateStudyPlanInput {
  student: StudyPlanStudent;
  modules: StudyPlanModule[];
  startTerm: string;
}

type TermCode = "A" | "B" | "C";

type ModuleOfferedTerm = "Sep" | "Feb" | "Jun" | "Other";

function parseStudyTerm(term: string): {
  year: number;
  code: TermCode;
} {
  const text = String(term ?? "").trim().toUpperCase();

  const matched = text.match(/^T(\d{4})([ABC])$/);

  if (!matched) {
    throw new Error(
      `Invalid study term format: ${term}. Expected format like T2026A.`
    );
  }

  return {
    year: Number(matched[1]),
    code: matched[2] as TermCode,
  };
}

function formatStudyTerm(year: number, code: TermCode): string {
  return `T${year}${code}`;
}

function getModuleYearNumber(module: StudyPlanModule): number {
  const raw = module.moduleYear;

  if (raw === null || raw === undefined) return 999;

  const text = String(raw).trim();

  const direct = Number(text);

  if (Number.isFinite(direct)) {
    return direct;
  }

  const matched = text.match(/\d+/);

  if (!matched) return 999;

  const value = Number(matched[0]);

  return Number.isFinite(value) ? value : 999;
}

function getModuleOfferedTerm(module: StudyPlanModule): string {
  return String(module.moduleTerm || module.moduleTermPattern || "").trim();
}

/**
 * Identify module offered term nature.
 *
 * Business mapping:
 * - Sep module -> C term
 * - Feb module -> A term
 * - Jun module -> B term
 */
function getModuleOfferedTermName(module: StudyPlanModule): ModuleOfferedTerm {
  const text = getModuleOfferedTerm(module).toLowerCase();

  if (
    text === "sep" ||
    text === "sept" ||
    text === "september" ||
    text.includes("sep") ||
    text === "c" ||
    /^t\d{4}c$/i.test(text)
  ) {
    return "Sep";
  }

  if (
    text === "feb" ||
    text === "february" ||
    text.includes("feb") ||
    text === "a" ||
    /^t\d{4}a$/i.test(text)
  ) {
    return "Feb";
  }

  if (
    text === "jun" ||
    text === "june" ||
    text.includes("jun") ||
    text === "summer" ||
    text.includes("summer") ||
    text === "b" ||
    /^t\d{4}b$/i.test(text)
  ) {
    return "Jun";
  }

  return "Other";
}

function getModuleOfferedTermOrder(module: StudyPlanModule): number {
  const term = getModuleOfferedTermName(module);

  if (term === "Sep") return 1;
  if (term === "Feb") return 2;
  if (term === "Jun") return 3;

  return 999;
}

/**
 * Convert offered term nature to study term letter.
 *
 * Auto-generation rule:
 * - Sep modules go to C term
 * - Feb modules go to A term
 * - Jun modules go to B term
 */
function moduleOfferedTermToStudyTermCode(
  offeredTerm: ModuleOfferedTerm
): TermCode | null {
  if (offeredTerm === "Sep") return "C";
  if (offeredTerm === "Feb") return "A";
  if (offeredTerm === "Jun") return "B";

  return null;
}

/**
 * Find the first study term with target letter that is on or after startTerm.
 *
 * Examples:
 * startTerm = T2026C
 * target C -> T2026C
 * target A -> T2027A
 * target B -> T2027B
 *
 * startTerm = T2027A
 * target A -> T2027A
 * target B -> T2027B
 * target C -> T2027C
 */
function getFirstTargetTermOnOrAfterStart(
  startTerm: string,
  targetCode: TermCode
): string {
  const start = parseStudyTerm(startTerm);

  if (start.code === targetCode) {
    return formatStudyTerm(start.year, targetCode);
  }

  /**
   * Academic term order inside an intake cycle:
   * C -> next A -> B -> C
   *
   * Calendar/code order:
   * A -> B -> C
   *
   * Here we need terms on or after actual start term.
   */
  if (start.code === "C") {
    if (targetCode === "A") return formatStudyTerm(start.year + 1, "A");
    if (targetCode === "B") return formatStudyTerm(start.year + 1, "B");
    return formatStudyTerm(start.year, "C");
  }

  if (start.code === "A") {
    if (targetCode === "B") return formatStudyTerm(start.year, "B");
    if (targetCode === "C") return formatStudyTerm(start.year, "C");
    return formatStudyTerm(start.year, "A");
  }

  /**
   * start.code === "B"
   */
  if (targetCode === "C") return formatStudyTerm(start.year, "C");
  if (targetCode === "A") return formatStudyTerm(start.year + 1, "A");
  return formatStudyTerm(start.year, "B");
}

/**
 * Add academic years to a study term while keeping the same term code.
 *
 * Examples:
 * T2026C + 1 -> T2027C
 * T2027A + 1 -> T2028A
 * T2027B + 1 -> T2028B
 */
function addAcademicYearToSameTerm(
  studyTerm: string,
  yearOffset: number
): string {
  const parsed = parseStudyTerm(studyTerm);

  return formatStudyTerm(parsed.year + yearOffset, parsed.code);
}

/**
 * Programme year offset is based on curriculum year.
 *
 * For HD:
 * - Year 1 -> offset 0
 * - Year 2 -> offset 1
 *
 * For Degree:
 * - Usually Year 3 modules are treated as the first study year,
 *   so Year 3 -> offset 0.
 */
function getProgrammeYearOffset(params: {
  student: StudyPlanStudent;
  module: StudyPlanModule;
}): number {
  const { student, module } = params;

  const degree = isDegreeProgramme(student.programmeCode);
  const year = getModuleYearNumber(module);

  if (degree) {
    if (year >= 3) return year - 3;
    return 0;
  }

  if (year >= 1) return year - 1;

  return 0;
}

function sortModulesByProgrammeStructure(
  modules: StudyPlanModule[]
): StudyPlanModule[] {
  return [...modules].sort((a, b) => {
    const yearDiff = getModuleYearNumber(a) - getModuleYearNumber(b);

    if (yearDiff !== 0) return yearDiff;

    const termDiff =
      getModuleOfferedTermOrder(a) - getModuleOfferedTermOrder(b);

    if (termDiff !== 0) return termDiff;

    const sequenceDiff =
      Number(a.moduleSequence ?? 999) - Number(b.moduleSequence ?? 999);

    if (sequenceDiff !== 0) return sequenceDiff;

    return String(a.moduleCode ?? "").localeCompare(
      String(b.moduleCode ?? "")
    );
  });
}

/**
 * Filter modules by programme level.
 *
 * Current rule:
 * - Degree students normally take Year 3+ modules.
 * - HD / Diploma students normally take Year 1 and Year 2 modules.
 *
 * This does NOT impose workload capacity.
 */
function filterModulesByProgrammeLevel(params: {
  student: StudyPlanStudent;
  modules: StudyPlanModule[];
}): StudyPlanModule[] {
  const { student, modules } = params;

  const degree = isDegreeProgramme(student.programmeCode);

  return modules.filter((module) => {
    const year = getModuleYearNumber(module);

    if (degree) {
      return year >= 3;
    }

    return year === 1 || year === 2;
  });
}

/**
 * Generate default study plan.
 *
 * Core rule:
 *
 * Auto-generation follows the module's offered term nature:
 * - Feb module -> A term
 * - Jun module -> B term
 * - Sep module -> C term
 *
 * The generated study term is only the default suggestion.
 * Users can manually change studyTerm in ModulePlanTable afterwards.
 *
 * Example:
 * Intake Term = T2026C
 *
 * Y1 Sep -> T2026C
 * Y1 Feb -> T2027A
 * Y1 Jun -> T2027B
 * Y2 Sep -> T2027C
 * Y2 Feb -> T2028A
 * Y2 Jun -> T2028B
 */
export function generateStudyPlanForStudent({
  student,
  modules,
  startTerm,
}: GenerateStudyPlanInput): StudyPlanModule[] {
  if (!startTerm) {
    throw new Error("Start term is required.");
  }

  parseStudyTerm(startTerm);

  const programmeModules = modules.filter(
    (module) => module.planStage === "programme"
  );

  const otherModules = modules.filter(
    (module) => module.planStage !== "programme"
  );

  const filteredProgrammeModules = filterModulesByProgrammeLevel({
    student,
    modules: programmeModules,
  });

  const sortedProgrammeModules = sortModulesByProgrammeStructure(
    filteredProgrammeModules
  );

  const generatedProgrammeModules = sortedProgrammeModules.map((module) => {
    if (module.status === "exempted") {
      return {
        ...module,
        studyTerm: undefined,
        status: "exempted" as const,
        isExempted: true,
        isFailed: false,
        isLocked: module.isLocked ?? false,
      };
    }

    const offeredTerm = getModuleOfferedTermName(module);
    const targetStudyTermCode = moduleOfferedTermToStudyTermCode(offeredTerm);

    /**
     * If module_term is unknown, keep existing studyTerm if any.
     * This prevents accidentally assigning a wrong term.
     */
    if (!targetStudyTermCode) {
      return {
        ...module,
        status: module.status === "failed" ? ("failed" as const) : ("planned" as const),
        studyTerm: module.studyTerm,
        isExempted: false,
        isFailed: module.status === "failed",
        isLocked: module.isLocked ?? false,
      };
    }

    const firstMatchingTerm = getFirstTargetTermOnOrAfterStart(
      startTerm,
      targetStudyTermCode
    );

    const yearOffset = getProgrammeYearOffset({
      student,
      module,
    });

    const generatedStudyTerm = addAcademicYearToSameTerm(
      firstMatchingTerm,
      yearOffset
    );

    return {
      ...module,
      status: module.status === "failed" ? ("failed" as const) : ("planned" as const),
      studyTerm: generatedStudyTerm,
      isExempted: false,
      isFailed: module.status === "failed",
      isLocked: module.isLocked ?? false,
    };
  });

  return [
    ...generatedProgrammeModules,
    ...otherModules,
  ];
}

/**
 * Compatibility function.
 *
 * Keep selected start term unchanged.
 */
export function getDegreeStartTermAfterBridging(
  _modules: StudyPlanModule[],
  startTerm: string
): string {
  return startTerm;
}

/**
 * Kept for compatibility with existing UI/summary code.
 *
 * Important:
 * This value should only be used as reference/warning.
 * It must NOT be used to generate or restrict study plan terms.
 */
export function getMaxModulesPerTerm(student: StudyPlanStudent): number {
  const degree = isDegreeProgramme(student.programmeCode);

  if (student.studyMode === "PT") {
    return 2;
  }

  if (degree) {
    return 3;
  }

  return 4;
}
