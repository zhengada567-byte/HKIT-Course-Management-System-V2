import {
  isDegreeProgrammeType,
  isHDProgrammeType,
} from "../pages/programme-leader/make-study-plan/helpers";

/** Degree programmes: teaching 24h, tutorial = 75 - 24 (except zero-tutorial list). */
export const MODULE_TEACHING_24_PROGRAMMES = [
  "WUCS",
  "WUBM",
  "WUAFM",
] as const;

/** Degree programmes: teaching 48h, tutorial = 75 - 48 (except zero-tutorial list). */
export const MODULE_TEACHING_48_PROGRAMMES = [
  "UWLBS",
  "UWLBM",
  "UWLCFI",
  "UWLC",
  "UWLCS",
] as const;

/** No tutorial contact hours in module catalogue. */
export const MODULE_ZERO_TUTORIAL_PROGRAMMES = [
  "UWLCS",
  "UWLBS",
  "WUBM",
] as const;

/** HD modules with lectures only — daily timetable uses L1–L12, no T1–T3. */
export const HD_ZERO_TUTORIAL_MODULE_CODES = [
  "HD401",
  "HD402",
  "HD405",
] as const;

export const HD_ZERO_TUTORIAL_LECTURE_COUNT = 12;
export const HD_ZERO_TUTORIAL_TEACHING_HOURS = 48;

export const DEGREE_MODULE_TOTAL_CONTACT_HOURS = 75;
export const HD_MODULE_TEACHING_HOURS_DEFAULT = 36;
export const HD_MODULE_TUTORIAL_HOURS_DEFAULT = 21;
export const DEGREE_24_MODULE_TEACHING_HOURS_DEFAULT = 24;
export const DEGREE_48_MODULE_TEACHING_HOURS_DEFAULT = 48;

const TEACHING_24_SET = new Set(
  MODULE_TEACHING_24_PROGRAMMES.map((code) => code.toUpperCase())
);
const TEACHING_48_SET = new Set(
  MODULE_TEACHING_48_PROGRAMMES.map((code) => code.toUpperCase())
);
const ZERO_TUTORIAL_SET = new Set(
  MODULE_ZERO_TUTORIAL_PROGRAMMES.map((code) => code.toUpperCase())
);
const HD_ZERO_TUTORIAL_MODULE_SET = new Set(
  HD_ZERO_TUTORIAL_MODULE_CODES.map((code) => code.toUpperCase())
);

export function normalizeModuleCodeKey(moduleCode: string | null | undefined) {
  return String(moduleCode ?? "")
    .trim()
    .toUpperCase()
    .split("-")[0];
}

export function isHdZeroTutorialModule(moduleCode: string | null | undefined) {
  return HD_ZERO_TUTORIAL_MODULE_SET.has(normalizeModuleCodeKey(moduleCode));
}

export interface ModuleTeachingTutorialHours {
  module_teaching_contact_hours: number;
  module_tutorial_contact_hours: number;
}

export function normalizeProgrammeCodeKey(programmeCode: string | null | undefined) {
  return String(programmeCode ?? "").trim().toUpperCase();
}

export function degreeTutorialHoursFromTeaching(teachingHours: number) {
  return DEGREE_MODULE_TOTAL_CONTACT_HOURS - teachingHours;
}

export function normalizeModuleContactHours(
  value: number | string | null | undefined
): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed);
}

/** Tutorial hours may be zero (e.g. UWLCS / UWLBS / WUBM). */
export function normalizeModuleTutorialContactHours(
  value: number | string | null | undefined
): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed);
}

/**
 * Default teaching + tutorial hours by programme (catalog rule).
 */
export function resolveDefaultModuleTeachingTutorialHours(params: {
  programmeCode: string;
  programmeType?: string | null;
  moduleCode?: string | null;
}): ModuleTeachingTutorialHours {
  const code = normalizeProgrammeCodeKey(params.programmeCode);

  if (isHdZeroTutorialModule(params.moduleCode)) {
    return {
      module_teaching_contact_hours: HD_MODULE_TEACHING_HOURS_DEFAULT,
      module_tutorial_contact_hours: 0,
    };
  }

  if (ZERO_TUTORIAL_SET.has(code)) {
    if (TEACHING_24_SET.has(code)) {
      return {
        module_teaching_contact_hours: DEGREE_24_MODULE_TEACHING_HOURS_DEFAULT,
        module_tutorial_contact_hours: 0,
      };
    }

    if (TEACHING_48_SET.has(code)) {
      return {
        module_teaching_contact_hours: DEGREE_48_MODULE_TEACHING_HOURS_DEFAULT,
        module_tutorial_contact_hours: 0,
      };
    }
  }

  if (TEACHING_24_SET.has(code)) {
    return {
      module_teaching_contact_hours: DEGREE_24_MODULE_TEACHING_HOURS_DEFAULT,
      module_tutorial_contact_hours: degreeTutorialHoursFromTeaching(
        DEGREE_24_MODULE_TEACHING_HOURS_DEFAULT
      ),
    };
  }

  if (TEACHING_48_SET.has(code)) {
    return {
      module_teaching_contact_hours: DEGREE_48_MODULE_TEACHING_HOURS_DEFAULT,
      module_tutorial_contact_hours: degreeTutorialHoursFromTeaching(
        DEGREE_48_MODULE_TEACHING_HOURS_DEFAULT
      ),
    };
  }

  if (isHDProgrammeType(params.programmeType)) {
    return {
      module_teaching_contact_hours: HD_MODULE_TEACHING_HOURS_DEFAULT,
      module_tutorial_contact_hours: HD_MODULE_TUTORIAL_HOURS_DEFAULT,
    };
  }

  if (isDegreeProgrammeType(params.programmeType)) {
    return {
      module_teaching_contact_hours: DEGREE_48_MODULE_TEACHING_HOURS_DEFAULT,
      module_tutorial_contact_hours: degreeTutorialHoursFromTeaching(
        DEGREE_48_MODULE_TEACHING_HOURS_DEFAULT
      ),
    };
  }

  return {
    module_teaching_contact_hours: HD_MODULE_TEACHING_HOURS_DEFAULT,
    module_tutorial_contact_hours: HD_MODULE_TUTORIAL_HOURS_DEFAULT,
  };
}

export function formatModuleTeachingHoursDefaultHint(
  programmeCode: string,
  moduleCode?: string | null
) {
  const defaults = resolveDefaultModuleTeachingTutorialHours({
    programmeCode,
    moduleCode,
  });

  return String(defaults.module_teaching_contact_hours);
}

export function formatModuleTutorialHoursDefaultHint(
  programmeCode: string,
  moduleCode?: string | null
) {
  const defaults = resolveDefaultModuleTeachingTutorialHours({
    programmeCode,
    moduleCode,
  });

  return String(defaults.module_tutorial_contact_hours);
}
