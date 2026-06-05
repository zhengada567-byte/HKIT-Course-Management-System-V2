import type { TimetableSessionRow } from "../services/timetableScheduleService";
import type { DailySessionLabelSlot } from "./dailyTimetable";
import { weekdayLabel } from "./dailyTimetable";
import { buildContactHourDailyPlan } from "./dailyTimetableContactHours";
import {
  assignLabelsToWeekDateSlots,
  buildWeekDateSlots,
  type LabelDateAssignment,
  type WeekDateSlot,
} from "./dailyTimetableWeekSlots";
import type { buildExcludedIsoDatesForTerm } from "../services/timetableScheduleService";
import type { WeekRange } from "./academicCalendar";

/** Borrower module code → donor module code (same term / weekday). */
export const CROSS_MODULE_BORROW_DONOR: Record<string, string> = {
  HC421: "HC420",
  HC423: "HC422",
};

export interface ModuleContactHourPlan {
  moduleCode: string;
  moduleInstanceCode: string;
  timetableModuleId: string;
  weekday: number;
  dateSlots: WeekDateSlot[];
  labelSequence: DailySessionLabelSlot[];
  doubleWeekIndices: number[];
  assignments: LabelDateAssignment[];
  /** Study-week sessions beyond labelled count — available for paired module borrow. */
  spareWeeklySessions: TimetableSessionRow[];
  warnings: string[];
}

function normalizeModuleCode(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .split("-")[0];
}

export function computeDoubleWeekIndices(params: {
  labelCount: number;
  dateSlotCount: number;
}) {
  if (params.labelCount <= params.dateSlotCount) {
    return [];
  }

  const extraNeeded = params.labelCount - params.dateSlotCount;
  const indices: number[] = [];

  for (
    let weekIndex = params.dateSlotCount - 1;
    weekIndex >= 0 && indices.length < extraNeeded;
    weekIndex -= 1
  ) {
    indices.unshift(weekIndex);
  }

  return indices;
}

export function buildModuleContactHourPlan(params: {
  moduleCode: string;
  moduleInstanceCode: string;
  timetableModuleId: string;
  programmeCode: string;
  programmeType?: string | null;
  teachingContactHours: number;
  tutorialContactHours: number;
  weekday: number;
  termWeeks: WeekRange[];
  excluded: Awaited<ReturnType<typeof buildExcludedIsoDatesForTerm>>;
  studyWeekSessions: TimetableSessionRow[];
}): ModuleContactHourPlan {
  const warnings: string[] = [];

  const dateSlots = buildWeekDateSlots({
    termWeeks: params.termWeeks,
    excluded: params.excluded,
    primaryWeekday: params.weekday,
  });

  const contactPlan = buildContactHourDailyPlan({
    programmeCode: params.programmeCode,
    programmeType: params.programmeType,
    teachingContactHours: params.teachingContactHours,
    tutorialContactHours: params.tutorialContactHours,
    maxSlots: dateSlots.length,
  });

  warnings.push(...contactPlan.warnings);

  const doubleWeekIndices = computeDoubleWeekIndices({
    labelCount: contactPlan.labelSequence.length,
    dateSlotCount: dateSlots.length,
  });

  const assignments = assignLabelsToWeekDateSlots({
    labelSequence: contactPlan.labelSequence,
    dateSlots,
    doubleWeekIndices,
  });

  const labelledCapacity =
    dateSlots.length + doubleWeekIndices.length;
  const spareWeeklySessions = params.studyWeekSessions.slice(labelledCapacity);

  if (assignments.some((row) => !row.dateSlot)) {
    const missing = assignments.filter((row) => !row.dateSlot).length;
    warnings.push(
      `${missing} session(s) could not be placed on weekly dates. Add extra weekly slot(s) in Make Timetable or rely on paired-module borrow (HC421←HC420, HC423←HC422).`
    );
  }

  return {
    moduleCode: params.moduleCode,
    moduleInstanceCode: params.moduleInstanceCode,
    timetableModuleId: params.timetableModuleId,
    weekday: params.weekday,
    dateSlots,
    labelSequence: contactPlan.labelSequence,
    doubleWeekIndices,
    assignments,
    spareWeeklySessions,
    warnings,
  };
}

export function resolveCrossModuleSlotBorrow(plans: ModuleContactHourPlan[]) {
  const planByCode = new Map<string, ModuleContactHourPlan>();

  for (const plan of plans) {
    planByCode.set(normalizeModuleCode(plan.moduleCode), plan);
  }

  for (const [borrowerCode, donorCode] of Object.entries(CROSS_MODULE_BORROW_DONOR)) {
    const borrower = planByCode.get(normalizeModuleCode(borrowerCode));
    const donor = planByCode.get(normalizeModuleCode(donorCode));

    if (!borrower || !donor) continue;

    const unassigned = borrower.assignments.filter((row) => !row.dateSlot);

    if (unassigned.length === 0) continue;

    const donorSpare = [...donor.spareWeeklySessions];
    let borrowIndex = 0;

    for (const assignment of unassigned) {
      const spareSession = donorSpare[borrowIndex];

      if (!spareSession) break;

      const spareDate = String(spareSession.session_date ?? "").trim().slice(0, 10);
      const parsedWeekday = new Date(`${spareDate}T12:00:00`).getDay();

      assignment.dateSlot = {
        sessionDate: spareDate as WeekDateSlot["sessionDate"],
        calendarWeekday: parsedWeekday || donor.weekday,
        calendarWeekdayLabel: weekdayLabel(parsedWeekday || donor.weekday),
        isBorrowedDay: true,
        borrowRemark: `Borrowed weekly slot from ${donor.moduleInstanceCode} (${spareDate}).`,
      };
      assignment.scheduleRemark = [
        assignment.scheduleRemark,
        assignment.dateSlot.borrowRemark,
      ]
        .filter(Boolean)
        .join(" ");

      borrowIndex += 1;
      borrower.warnings.push(
        `Used spare weekly slot from ${donor.moduleInstanceCode} for ${assignment.slot.label}.`
      );
    }

    const stillMissing = borrower.assignments.filter((row) => !row.dateSlot).length;

    if (stillMissing > 0) {
      borrower.warnings.push(
        `Need ${stillMissing} extra weekly slot(s) — add second session(s) in Make Timetable.`
      );
    }
  }
}

export function buildSessionLabelSequenceFromContactHours(params: {
  programmeCode: string;
  programmeType?: string | null;
  teachingContactHours: number;
  tutorialContactHours: number;
  maxSlots: number;
}) {
  return buildContactHourDailyPlan({
    programmeCode: params.programmeCode,
    programmeType: params.programmeType,
    teachingContactHours: params.teachingContactHours,
    tutorialContactHours: params.tutorialContactHours,
    maxSlots: params.maxSlots,
  }).labelSequence;
}
