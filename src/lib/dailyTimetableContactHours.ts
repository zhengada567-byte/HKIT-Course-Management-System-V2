import {
  isDegreeProgrammeType,
  isHDProgrammeType,
} from "../pages/programme-leader/make-study-plan/helpers";
import type { DailySessionKind, DailySessionLabelSlot } from "./dailyTimetable";

export const HDHC_PROGRAMME_CODE = "HDHC";
export const SESSION_HOURS_THRESHOLD = 29;
export const SESSION_HOURS_SHORT = 3;
export const SESSION_HOURS_LONG = 4;
export const HD_TUTORIAL_HOUR_RESERVE = 3;
export const HDHC_EXAM_HOUR_RESERVE = 2;

export interface ContactHourSessionSlot {
  kind: DailySessionKind;
  durationHours: number;
}

export interface ContactHourDailyPlanResult {
  lectureSlots: ContactHourSessionSlot[];
  tutorialSlots: ContactHourSessionSlot[];
  labelSequence: DailySessionLabelSlot[];
  sessionHoursPerSlot: number;
  unscheduledTutorialHours: number;
  warnings: string[];
}

function normalizeProgrammeCode(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase();
}

export function isHdhcProgramme(programmeCode: string | null | undefined) {
  return normalizeProgrammeCode(programmeCode) === HDHC_PROGRAMME_CODE;
}

export function computeSessionHoursPerSlot(params: {
  teachingContactHours: number;
  tutorialContactHours: number;
}) {
  const teaching = Number(params.teachingContactHours ?? 0);
  const tutorial = Number(params.tutorialContactHours ?? 0);
  const total = teaching + tutorial;

  if (!Number.isFinite(total) || total <= 0) {
    return SESSION_HOURS_LONG;
  }

  return total < SESSION_HOURS_THRESHOLD
    ? SESSION_HOURS_SHORT
    : SESSION_HOURS_LONG;
}

export function splitHoursIntoSessionSlots(params: {
  totalHours: number;
  sessionHours: number;
}): ContactHourSessionSlot[] {
  const totalHours = Math.max(0, Number(params.totalHours ?? 0));
  const sessionHours = Math.max(1, Number(params.sessionHours ?? SESSION_HOURS_LONG));

  if (totalHours <= 0) {
    return [];
  }

  const fullCount = Math.floor(totalHours / sessionHours);
  const remainder = totalHours % sessionHours;
  const slots: ContactHourSessionSlot[] = [];

  for (let index = 0; index < fullCount; index += 1) {
    slots.push({
      kind: "teaching",
      durationHours: sessionHours,
    });
  }

  if (remainder > 0) {
    slots.push({
      kind: "teaching",
      durationHours: remainder,
    });
  }

  return slots;
}

function splitTutorialHoursIntoSessionSlots(params: {
  totalHours: number;
  sessionHours: number;
}): ContactHourSessionSlot[] {
  const slots = splitHoursIntoSessionSlots(params);

  return slots.map((slot) => ({
    ...slot,
    kind: "tutorial" as const,
  }));
}

export function computeEffectiveTeachingHours(params: {
  programmeCode: string;
  teachingContactHours: number;
}) {
  const teaching = Math.max(0, Number(params.teachingContactHours ?? 0));

  if (isHdhcProgramme(params.programmeCode)) {
    return Math.max(0, teaching - HDHC_EXAM_HOUR_RESERVE);
  }

  return teaching;
}

export function computeEffectiveTutorialHours(params: {
  programmeCode: string;
  programmeType?: string | null;
  tutorialContactHours: number;
}) {
  const tutorial = Math.max(0, Number(params.tutorialContactHours ?? 0));

  if (isDegreeProgrammeType(params.programmeType)) {
    return tutorial;
  }

  if (isHDProgrammeType(params.programmeType) || isHdhcProgramme(params.programmeCode)) {
    return Math.max(0, tutorial - HD_TUTORIAL_HOUR_RESERVE);
  }

  return tutorial;
}

export function interleaveTeachingAndTutorialSlots(params: {
  lectureSlots: ContactHourSessionSlot[];
  tutorialSlots: ContactHourSessionSlot[];
}): ContactHourSessionSlot[] {
  const lectureSlots = params.lectureSlots;
  const tutorialSlots = params.tutorialSlots;

  if (tutorialSlots.length === 0) {
    return [...lectureSlots];
  }

  if (lectureSlots.length === 0) {
    return [...tutorialSlots];
  }

  const groups = tutorialSlots.length + 1;
  const baseSize = Math.floor(lectureSlots.length / groups);
  const extraGroups = lectureSlots.length % groups;
  const interleaved: ContactHourSessionSlot[] = [];
  let lectureIndex = 0;

  for (let groupIndex = 0; groupIndex < groups; groupIndex += 1) {
    const groupSize = baseSize + (groupIndex < extraGroups ? 1 : 0);

    for (let index = 0; index < groupSize; index += 1) {
      interleaved.push(lectureSlots[lectureIndex]!);
      lectureIndex += 1;
    }

    if (groupIndex < tutorialSlots.length) {
      interleaved.push(tutorialSlots[groupIndex]!);
    }
  }

  return interleaved;
}

function labelInterleavedSlots(slots: ContactHourSessionSlot[]): DailySessionLabelSlot[] {
  let lectureNumber = 0;
  let tutorialNumber = 0;

  return slots.map((slot) => {
    if (slot.kind === "tutorial") {
      tutorialNumber += 1;

      return {
        kind: slot.kind,
        label: `T${tutorialNumber}`,
        durationHours: slot.durationHours,
      };
    }

    lectureNumber += 1;

    return {
      kind: slot.kind,
      label: `L${lectureNumber}`,
      durationHours: slot.durationHours,
    };
  });
}

export function trimTutorialLabelsFromEnd(params: {
  labelSequence: DailySessionLabelSlot[];
  maxSlots: number;
}) {
  const trimmed = [...params.labelSequence];
  const warnings: string[] = [];
  let unscheduledTutorialHours = 0;

  while (trimmed.length > params.maxSlots) {
    let lastTutorialIndex = -1;

    for (let index = trimmed.length - 1; index >= 0; index -= 1) {
      if (trimmed[index]?.kind === "tutorial") {
        lastTutorialIndex = index;
        break;
      }
    }

    if (lastTutorialIndex < 0) {
      break;
    }

    const removed = trimmed.splice(lastTutorialIndex, 1)[0]!;
    unscheduledTutorialHours += removed.durationHours ?? SESSION_HOURS_LONG;
  }

  if (unscheduledTutorialHours > 0) {
    warnings.push(
      `${unscheduledTutorialHours} tutorial hour(s) could not fit in ${params.maxSlots} week slot(s). Schedule remaining tutorial on Saturday manually.`
    );
  }

  return {
    labelSequence: trimmed,
    unscheduledTutorialHours,
    warnings,
    needsDoubleSessionCount: Math.max(0, trimmed.length - params.maxSlots),
  };
}

export function buildContactHourDailyPlan(params: {
  programmeCode: string;
  programmeType?: string | null;
  teachingContactHours: number;
  tutorialContactHours: number;
  maxSlots: number;
}): ContactHourDailyPlanResult {
  const warnings: string[] = [];
  const sessionHoursPerSlot = computeSessionHoursPerSlot({
    teachingContactHours: params.teachingContactHours,
    tutorialContactHours: params.tutorialContactHours,
  });

  const teachingEffective = computeEffectiveTeachingHours({
    programmeCode: params.programmeCode,
    teachingContactHours: params.teachingContactHours,
  });

  const tutorialEffective = computeEffectiveTutorialHours({
    programmeCode: params.programmeCode,
    programmeType: params.programmeType,
    tutorialContactHours: params.tutorialContactHours,
  });

  const lectureSlots = splitHoursIntoSessionSlots({
    totalHours: teachingEffective,
    sessionHours: sessionHoursPerSlot,
  }).map((slot) => ({
    ...slot,
    kind: "teaching" as const,
  }));

  const tutorialSlots = splitTutorialHoursIntoSessionSlots({
    totalHours: tutorialEffective,
    sessionHours: sessionHoursPerSlot,
  });

  const interleaved = interleaveTeachingAndTutorialSlots({
    lectureSlots,
    tutorialSlots,
  });

  let labelSequence = labelInterleavedSlots(interleaved);

  const trimResult = trimTutorialLabelsFromEnd({
    labelSequence,
    maxSlots: Math.max(0, params.maxSlots),
  });

  labelSequence = trimResult.labelSequence;
  warnings.push(...trimResult.warnings);

  if (trimResult.needsDoubleSessionCount > 0) {
    warnings.push(
      `${trimResult.needsDoubleSessionCount} extra lecture session(s) need double weekly slots.`
    );
  }

  return {
    lectureSlots,
    tutorialSlots,
    labelSequence,
    sessionHoursPerSlot,
    unscheduledTutorialHours: trimResult.unscheduledTutorialHours,
    warnings,
  };
}
