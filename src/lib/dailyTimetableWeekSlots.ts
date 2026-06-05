import {
  addDays,
  toIsoDateString,
  type IsoDateString,
  type WeekRange,
} from "./academicCalendar";
import { weekdayLabel, type DailySessionLabelSlot } from "./dailyTimetable";
import { buildStudyWeekDatesForWeekday } from "../services/timetableScheduleService";
import type { buildExcludedIsoDatesForTerm } from "../services/timetableScheduleService";

export const TARGET_WEEK_SLOTS = 13;
export const EXTENDED_WEEKDAY_OCCURRENCES = 14;

export interface WeekDateSlot {
  sessionDate: IsoDateString;
  calendarWeekday: number;
  calendarWeekdayLabel: string;
  isBorrowedDay: boolean;
  borrowRemark: string | null;
}

function buildRevisionWeekDatesForWeekday(params: {
  termWeeks: WeekRange[];
  weekday: number;
  excluded: Awaited<ReturnType<typeof buildExcludedIsoDatesForTerm>>;
}): IsoDateString[] {
  const dates: IsoDateString[] = [];
  const revisionWeeks = params.termWeeks.filter(
    (week) => week.category === "revision"
  );

  for (const week of revisionWeeks) {
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(week.startMonday, offset);

      if (date.getDay() !== params.weekday) continue;

      const iso = toIsoDateString(date);

      if (params.excluded.publicHolidayIsoDates.has(iso)) continue;

      dates.push(iso);
    }
  }

  return dates;
}

export function buildWeekDateSlots(params: {
  termWeeks: WeekRange[];
  excluded: Awaited<ReturnType<typeof buildExcludedIsoDatesForTerm>>;
  primaryWeekday: number;
}): WeekDateSlot[] {
  const primaryWeekday = params.primaryWeekday;
  const primaryLabel = weekdayLabel(primaryWeekday);

  const primaryDates = buildStudyWeekDatesForWeekday({
    termWeeks: params.termWeeks,
    weekday: primaryWeekday as 1 | 2 | 3 | 4 | 5 | 6,
    excluded: params.excluded,
  });

  const targetSlotCount =
    primaryDates.length >= EXTENDED_WEEKDAY_OCCURRENCES
      ? EXTENDED_WEEKDAY_OCCURRENCES
      : TARGET_WEEK_SLOTS;

  const slots: WeekDateSlot[] = primaryDates.slice(0, targetSlotCount).map(
    (sessionDate) => ({
      sessionDate,
      calendarWeekday: primaryWeekday,
      calendarWeekdayLabel: primaryLabel,
      isBorrowedDay: false,
      borrowRemark: null,
    })
  );

  if (slots.length >= targetSlotCount) {
    return slots;
  }

  const needBorrow = targetSlotCount - slots.length;

  if (needBorrow > 0) {
    for (let donorWeekday = 1; donorWeekday <= 6; donorWeekday += 1) {
      if (donorWeekday === primaryWeekday) continue;

      const donorDates = buildStudyWeekDatesForWeekday({
        termWeeks: params.termWeeks,
        weekday: donorWeekday as 1 | 2 | 3 | 4 | 5 | 6,
        excluded: params.excluded,
      });

      if (donorDates.length < EXTENDED_WEEKDAY_OCCURRENCES) {
        continue;
      }

      const borrowCandidates = donorDates.slice(TARGET_WEEK_SLOTS);
      const donorLabel = weekdayLabel(donorWeekday);

      for (
        let index = 0;
        index < needBorrow && index < borrowCandidates.length;
        index += 1
      ) {
        slots.push({
          sessionDate: borrowCandidates[index]!,
          calendarWeekday: donorWeekday,
          calendarWeekdayLabel: donorLabel,
          isBorrowedDay: true,
          borrowRemark: `Scheduled on ${donorLabel} (primary ${primaryLabel} has ${primaryDates.length} study-week date(s); borrowed from ${donorLabel} week ${TARGET_WEEK_SLOTS + index + 1}).`,
        });
      }

      if (slots.length >= targetSlotCount) {
        break;
      }
    }
  }

  if (slots.length < targetSlotCount) {
    const stillNeed = targetSlotCount - slots.length;
    const revisionDates = buildRevisionWeekDatesForWeekday({
      termWeeks: params.termWeeks,
      weekday: primaryWeekday,
      excluded: params.excluded,
    });

    for (let index = 0; index < stillNeed && index < revisionDates.length; index += 1) {
      slots.push({
        sessionDate: revisionDates[index]!,
        calendarWeekday: primaryWeekday,
        calendarWeekdayLabel: primaryLabel,
        isBorrowedDay: true,
        borrowRemark: `Scheduled on revision-week ${primaryLabel} (fallback after weekday borrow).`,
      });
    }
  }

  return slots;
}

export function addHoursToSessionTime(startTime: string, hours: number) {
  const normalized = String(startTime ?? "09:00:00").trim();
  const matched = normalized.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (!matched) {
    return normalized;
  }

  const startHour = Number(matched[1]);
  const startMinute = Number(matched[2]);
  const startSecond = Number(matched[3] ?? 0);
  const totalMinutes = startHour * 60 + startMinute + Math.round(hours * 60);
  const endHour = Math.floor(totalMinutes / 60) % 24;
  const endMinute = totalMinutes % 60;

  return `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}:${String(startSecond).padStart(2, "0")}`;
}

export interface LabelDateAssignment {
  slot: DailySessionLabelSlot;
  dateSlot: WeekDateSlot | null;
  isDoubleSession: boolean;
  scheduleRemark: string | null;
}

export function assignLabelsToWeekDateSlots(params: {
  labelSequence: DailySessionLabelSlot[];
  dateSlots: WeekDateSlot[];
  doubleWeekIndices?: number[];
}) {
  const assignments: LabelDateAssignment[] = [];
  const doubleWeekSet = new Set(params.doubleWeekIndices ?? []);
  let labelIndex = 0;

  for (let weekIndex = 0; weekIndex < params.dateSlots.length; weekIndex += 1) {
    const dateSlot = params.dateSlots[weekIndex]!;
    const sessionsThisWeek = doubleWeekSet.has(weekIndex) ? 2 : 1;

    for (let sessionInWeek = 0; sessionInWeek < sessionsThisWeek; sessionInWeek += 1) {
      if (labelIndex >= params.labelSequence.length) {
        break;
      }

      const slot = params.labelSequence[labelIndex]!;
      const remarks: string[] = [];

      if (dateSlot.borrowRemark) {
        remarks.push(dateSlot.borrowRemark);
      }

      if (sessionInWeek > 0) {
        remarks.push("Double session week (second slot).");
      }

      assignments.push({
        slot,
        dateSlot,
        isDoubleSession: sessionInWeek > 0,
        scheduleRemark: remarks.length > 0 ? remarks.join(" ") : null,
      });

      labelIndex += 1;
    }
  }

  while (labelIndex < params.labelSequence.length) {
    assignments.push({
      slot: params.labelSequence[labelIndex]!,
      dateSlot: null,
      isDoubleSession: false,
      scheduleRemark:
        "No weekly date slot available. Add an extra weekly session in Make Timetable.",
    });
    labelIndex += 1;
  }

  return assignments;
}
