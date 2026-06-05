import {
  addDays,
  toIsoDateString,
  type TermSummary,
  type WeekRange,
} from "./academicCalendar";
import {
  isDegreeProgrammeType,
  isHDProgrammeType,
} from "../pages/programme-leader/make-study-plan/helpers";
import { buildSessionLabelSequenceFromContactHours } from "./dailyTimetablePlan";

export type DailySessionKind = "teaching" | "tutorial";

export interface DailySessionLabelSlot {
  kind: DailySessionKind;
  label: string;
  /** Session duration in hours when derived from contact-hour rules. */
  durationHours?: number;
}

/** HD contact-hour sequence: L1–L3, T1, L4–L6, T2, L7–L9, T3. */
export const HD_DAILY_SESSION_LABELS: DailySessionLabelSlot[] = [
  { kind: "teaching", label: "L1" },
  { kind: "teaching", label: "L2" },
  { kind: "teaching", label: "L3" },
  { kind: "tutorial", label: "T1" },
  { kind: "teaching", label: "L4" },
  { kind: "teaching", label: "L5" },
  { kind: "teaching", label: "L6" },
  { kind: "tutorial", label: "T2" },
  { kind: "teaching", label: "L7" },
  { kind: "teaching", label: "L8" },
  { kind: "teaching", label: "L9" },
  { kind: "tutorial", label: "T3" },
];

export const HD_TEACHING_SESSION_COUNT = 9;
export const HD_TUTORIAL_SESSION_COUNT = 3;

/** HD401 / HD402 / HD405 legacy helper — prefer contact-hour plan. */
export function buildHdLectureOnlySessionLabelSequence(
  lectureCount = 12
): DailySessionLabelSlot[] {
  const slots: DailySessionLabelSlot[] = [];

  for (let index = 1; index <= lectureCount; index += 1) {
    slots.push({ kind: "teaching", label: `L${index}` });
  }

  return slots;
}

export function describeSessionLabelSequence(
  labelSequence: DailySessionLabelSlot[]
) {
  const teaching = labelSequence.filter((slot) => slot.kind === "teaching").length;
  const tutorial = labelSequence.filter((slot) => slot.kind === "tutorial").length;

  if (tutorial === 0) {
    return `${teaching} lecture${teaching === 1 ? "" : "s"} (no tutorials)`;
  }

  return `${teaching} teaching + ${tutorial} tutorial`;
}

export function isHdDailyTimetableModule(params: {
  programmeCode: string;
  programmeType?: string | null;
}) {
  if (isHDProgrammeType(params.programmeType)) {
    return true;
  }

  if (isDegreeProgrammeType(params.programmeType)) {
    return false;
  }

  return true;
}

export function computeDegreeTeachingSessionCount(teachingContactHours: number) {
  const hours = Number(teachingContactHours);

  if (!Number.isFinite(hours) || hours <= 0) {
    return 0;
  }

  return Math.ceil(hours / 4);
}

export function studyWeekdayCountForJsDay(
  termSummary: TermSummary,
  jsDay: number
): number {
  const counts = termSummary.studyWeekdayCounts;

  if (jsDay === 1) return counts.mon;
  if (jsDay === 2) return counts.tue;
  if (jsDay === 3) return counts.wed;
  if (jsDay === 4) return counts.thu;
  if (jsDay === 5) return counts.fri;

  return 0;
}

export function countStudyWeekdayOccurrences(params: {
  termWeeks: WeekRange[];
  weekday: number;
  publicHolidayIsoDates: Set<string>;
}): number {
  let total = 0;
  const studyWeeks = params.termWeeks.filter((week) => week.category === "study");

  for (const week of studyWeeks) {
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(week.startMonday, offset);
      const iso = toIsoDateString(date);

      if (date.getDay() !== params.weekday) continue;
      if (params.publicHolidayIsoDates.has(iso)) continue;

      total += 1;
    }
  }

  return total;
}

export function computeDegreeSessionCounts(params: {
  teachingContactHours: number;
  studyWeekdayOccurrences: number;
}) {
  const teachingCount = computeDegreeTeachingSessionCount(
    params.teachingContactHours
  );
  const tutorialCount = Math.max(
    0,
    params.studyWeekdayOccurrences - teachingCount
  );

  return { teachingCount, tutorialCount };
}

export function buildDegreeSessionLabelSequence(
  teachingCount: number,
  tutorialCount: number
): DailySessionLabelSlot[] {
  const slots: DailySessionLabelSlot[] = [];

  for (let index = 1; index <= teachingCount; index += 1) {
    slots.push({ kind: "teaching", label: `L${index}` });
  }

  for (let index = 1; index <= tutorialCount; index += 1) {
    slots.push({ kind: "tutorial", label: `T${index}` });
  }

  return slots;
}

export function buildSessionLabelSequence(params: {
  programmeCode: string;
  programmeType?: string | null;
  moduleCode?: string | null;
  teachingContactHours: number;
  tutorialContactHours?: number;
  studyWeekdayOccurrences: number;
}): DailySessionLabelSlot[] {
  return buildSessionLabelSequenceFromContactHours({
    programmeCode: params.programmeCode,
    programmeType: params.programmeType,
    teachingContactHours: params.teachingContactHours,
    tutorialContactHours: params.tutorialContactHours ?? 0,
    maxSlots: params.studyWeekdayOccurrences,
  });
}

export function weekdayLabel(jsDay: number) {
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return labels[jsDay] ?? "?";
}
