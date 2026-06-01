export type IsoDateString = `${number}-${number}-${number}`;

export type TermCode = "Sep" | "Feb" | "Jun";
export type WeekCategory = "study" | "revision" | "exam" | "marking" | "holiday";

export interface WeekRange {
  weekIndex: number;
  startMonday: Date;
  endSunday: Date;
  isHolidayWeek: boolean;
  holidayWeekReason?: "Christmas" | "CNY";
  term?: TermCode;
  category?: WeekCategory;
  termWeekIndex?: number;
  termCategoryIndex?: number;
}

export interface TermSummary {
  term: TermCode;
  termStartDate: Date;
  termEndDate: Date;
  studyWeeks: { start: Date; end: Date; count: number };
  revisionWeeks?: { start: Date; end: Date; count: number };
  examWeeks: { start: Date; end: Date; count: number };
  markingWeeks: { start: Date; end: Date; count: number };
  studyWeekdayCounts: {
    mon: number;
    tue: number;
    wed: number;
    thu: number;
    fri: number;
    total: number;
  };
}

export interface SchoolBreakRange {
  start: Date;
  end: Date;
}

export interface WorkingDayContext {
  publicHolidayIsoDates: Set<IsoDateString>;
  christmasStart?: Date | null;
  christmasEnd?: Date | null;
  cnyStart?: Date | null;
  cnyEnd?: Date | null;
  schoolBreaks: SchoolBreakRange[];
}

export interface AcademicCalendarInput {
  startDate: Date;
  christmasStart?: Date | null;
  christmasEnd?: Date | null;
  cnyStart?: Date | null;
  cnyEnd?: Date | null;
  publicHolidayIsoDates?: Set<IsoDateString>;
  schoolBreaks?: SchoolBreakRange[];
}

export interface CalendarHolidayPeriod {
  label: "Christmas" | "CNY";
  startDate: IsoDateString;
  endDate: IsoDateString;
}

export interface AcademicCalendarResult {
  weeks: WeekRange[];
  terms: TermSummary[];
  warnings: string[];
  holidayPeriods: CalendarHolidayPeriod[];
}

export function buildCalendarHolidayPeriods(params: {
  christmasStart?: Date | null;
  christmasEnd?: Date | null;
  cnyStart?: Date | null;
  cnyEnd?: Date | null;
}): CalendarHolidayPeriod[] {
  const periods: CalendarHolidayPeriod[] = [];

  if (params.christmasStart && params.christmasEnd) {
    periods.push({
      label: "Christmas",
      startDate: toIsoDateString(params.christmasStart),
      endDate: toIsoDateString(params.christmasEnd),
    });
  }

  if (params.cnyStart && params.cnyEnd) {
    periods.push({
      label: "CNY",
      startDate: toIsoDateString(params.cnyStart),
      endDate: toIsoDateString(params.cnyEnd),
    });
  }

  return periods;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function toIsoDateString(date: Date): IsoDateString {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}-${pad2(month)}-${pad2(day)}` as IsoDateString;
}

export function parseIsoDate(value: string): Date | undefined {
  const text = String(value ?? "").trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return undefined;
  }

  return new Date(year, month - 1, day);
}

export function normalizeHolidayIsoDate(value: string): IsoDateString | null {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  return toIsoDateString(parsed);
}

export function getMonthGridIsoRange(month: Date): {
  fromInclusive: IsoDateString;
  toInclusive: IsoDateString;
} {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const jsDay = first.getDay();
  const delta = jsDay === 0 ? -6 : 1 - jsDay;
  const gridStart = addDays(first, delta);
  const gridEnd = addDays(gridStart, 41);

  return {
    fromInclusive: toIsoDateString(gridStart),
    toInclusive: toIsoDateString(gridEnd),
  };
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfWeekMonday(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const jsDay = d.getDay();
  const delta = jsDay === 0 ? -6 : 1 - jsDay;
  return addDays(d, delta);
}

function endOfWeekSunday(monday: Date): Date {
  return addDays(monday, 6);
}

function isDateInClosedRange(date: Date, start: Date, end: Date): boolean {
  const time = date.getTime();
  return time >= start.getTime() && time <= end.getTime();
}

function isWeekFullyCoveredByPeriod(params: {
  weekMonday: Date;
  weekSunday: Date;
  periodStart?: Date | null;
  periodEnd?: Date | null;
}): boolean {
  const { periodStart, periodEnd } = params;
  if (!periodStart || !periodEnd) return false;

  return (
    params.weekMonday.getTime() >= periodStart.getTime() &&
    params.weekSunday.getTime() <= periodEnd.getTime()
  );
}

function buildWorkingDayContext(input: AcademicCalendarInput): WorkingDayContext {
  return {
    publicHolidayIsoDates:
      input.publicHolidayIsoDates ?? new Set<IsoDateString>(),
    christmasStart: input.christmasStart ?? null,
    christmasEnd: input.christmasEnd ?? null,
    cnyStart: input.cnyStart ?? null,
    cnyEnd: input.cnyEnd ?? null,
    schoolBreaks: input.schoolBreaks ?? [],
  };
}

export function isWorkingDay(date: Date, ctx: WorkingDayContext): boolean {
  const jsDay = date.getDay();
  if (jsDay === 0 || jsDay === 6) return false;

  const iso = toIsoDateString(date);
  if (ctx.publicHolidayIsoDates.has(iso)) return false;

  if (
    ctx.christmasStart &&
    ctx.christmasEnd &&
    isDateInClosedRange(date, ctx.christmasStart, ctx.christmasEnd)
  ) {
    return false;
  }

  if (
    ctx.cnyStart &&
    ctx.cnyEnd &&
    isDateInClosedRange(date, ctx.cnyStart, ctx.cnyEnd)
  ) {
    return false;
  }

  for (const br of ctx.schoolBreaks) {
    if (isDateInClosedRange(date, br.start, br.end)) {
      return false;
    }
  }

  return true;
}

function firstWorkingDayInRange(
  rangeStart: Date,
  rangeEnd: Date,
  ctx: WorkingDayContext
): Date {
  let cursor = new Date(rangeStart.getTime());
  while (cursor.getTime() <= rangeEnd.getTime()) {
    if (isWorkingDay(cursor, ctx)) {
      return cursor;
    }
    cursor = addDays(cursor, 1);
  }

  return rangeStart;
}

function lastWorkingDayInRange(
  rangeStart: Date,
  rangeEnd: Date,
  ctx: WorkingDayContext
): Date {
  let cursor = new Date(rangeEnd.getTime());
  while (cursor.getTime() >= rangeStart.getTime()) {
    if (isWorkingDay(cursor, ctx)) {
      return cursor;
    }
    cursor = addDays(cursor, -1);
  }

  return rangeEnd;
}

function buildCategoryPlan(term: TermCode): WeekCategory[] {
  if (term === "Sep" || term === "Feb") {
    return [
      ...Array.from({ length: 14 }, () => "study" as const),
      "revision",
      "exam",
      "exam",
      "marking",
    ];
  }

  return [
    ...Array.from({ length: 12 }, () => "study" as const),
    "exam",
    "marking",
  ];
}

function requiredTeachingWeeks(term: TermCode): number {
  return buildCategoryPlan(term).length;
}

function unionBounds(weeks: WeekRange[]): { start: Date; end: Date } | undefined {
  if (weeks.length === 0) return undefined;

  return {
    start: weeks[0]!.startMonday,
    end: weeks[weeks.length - 1]!.endSunday,
  };
}

function sliceRanges(
  weeks: WeekRange[],
  category: WeekCategory,
  ctx: WorkingDayContext
) {
  const filtered = weeks.filter((w) => w.category === category);
  if (filtered.length === 0) {
    return undefined;
  }

  const bounds = unionBounds(filtered);
  if (!bounds) return undefined;

  return {
    start: firstWorkingDayInRange(bounds.start, bounds.end, ctx),
    end: lastWorkingDayInRange(bounds.start, bounds.end, ctx),
    count: filtered.length,
  };
}

function countStudyWeekdays(params: {
  weeks: WeekRange[];
  publicHolidayIsoDates: Set<IsoDateString>;
}) {
  let mon = 0;
  let tue = 0;
  let wed = 0;
  let thu = 0;
  let fri = 0;

  const studyWeeks = params.weeks.filter((w) => w.category === "study");

  for (const w of studyWeeks) {
    for (let offset = 0; offset < 7; offset += 1) {
      const d = addDays(w.startMonday, offset);
      const jsDay = d.getDay();
      if (jsDay < 1 || jsDay > 5) continue;
      if (params.publicHolidayIsoDates.has(toIsoDateString(d))) continue;

      if (jsDay === 1) mon += 1;
      else if (jsDay === 2) tue += 1;
      else if (jsDay === 3) wed += 1;
      else if (jsDay === 4) thu += 1;
      else if (jsDay === 5) fri += 1;
    }
  }

  return {
    mon,
    tue,
    wed,
    thu,
    fri,
    total: mon + tue + wed + thu + fri,
  };
}

export function generateAcademicCalendar(
  input: AcademicCalendarInput
): AcademicCalendarResult {
  const warnings: string[] = [];
  const ctx = buildWorkingDayContext(input);
  const baseMonday = startOfWeekMonday(input.startDate);

  const terms: TermCode[] = ["Sep", "Feb", "Jun"];
  const weeks: WeekRange[] = [];

  let termPointer = 0;
  let termPlan = buildCategoryPlan(terms[termPointer]!);
  let planIndex = 0;

  const termCategoryCounters: Record<TermCode, Record<WeekCategory, number>> = {
    Sep: { study: 0, revision: 0, exam: 0, marking: 0, holiday: 0 },
    Feb: { study: 0, revision: 0, exam: 0, marking: 0, holiday: 0 },
    Jun: { study: 0, revision: 0, exam: 0, marking: 0, holiday: 0 },
  };

  const maxTimelineWeeks = 120;
  let weekIndex = 0;

  while (termPointer < terms.length && weekIndex < maxTimelineWeeks) {
    weekIndex += 1;
    const monday = addDays(baseMonday, (weekIndex - 1) * 7);
    const sunday = endOfWeekSunday(monday);

    const isChristmas = isWeekFullyCoveredByPeriod({
      weekMonday: monday,
      weekSunday: sunday,
      periodStart: input.christmasStart ?? null,
      periodEnd: input.christmasEnd ?? null,
    });
    const isCny = isWeekFullyCoveredByPeriod({
      weekMonday: monday,
      weekSunday: sunday,
      periodStart: input.cnyStart ?? null,
      periodEnd: input.cnyEnd ?? null,
    });

    const isHolidayWeek = isChristmas || isCny;
    const holidayWeekReason = isChristmas
      ? "Christmas"
      : isCny
        ? "CNY"
        : undefined;

    const week: WeekRange = {
      weekIndex,
      startMonday: monday,
      endSunday: sunday,
      isHolidayWeek,
      holidayWeekReason,
      category: isHolidayWeek ? "holiday" : undefined,
    };

    if (isHolidayWeek) {
      weeks.push(week);
      continue;
    }

    const currentTerm = terms[termPointer]!;
    const category = termPlan[planIndex];

    if (!category) {
      warnings.push(`Missing category plan for term ${currentTerm}.`);
      break;
    }

    week.term = currentTerm;
    week.category = category;
    week.termWeekIndex = planIndex + 1;
    termCategoryCounters[currentTerm]![category] += 1;
    week.termCategoryIndex = termCategoryCounters[currentTerm]![category];

    weeks.push(week);
    planIndex += 1;

    if (planIndex >= termPlan.length) {
      termPointer += 1;
      planIndex = 0;
      if (termPointer < terms.length) {
        termPlan = buildCategoryPlan(terms[termPointer]!);
      }
    }
  }

  if (termPointer < terms.length) {
    warnings.push(
      `Timeline ended before all terms were allocated (stopped at week ${weekIndex}).`
    );
  }

  const termSummaries: TermSummary[] = [];

  for (const term of terms) {
    const termWeeks = weeks.filter((w) => w.term === term);
    if (termWeeks.length === 0) {
      warnings.push(`No weeks allocated for term ${term}.`);
      continue;
    }

    const studyWeeks = sliceRanges(termWeeks, "study", ctx);
    const revisionWeeks = sliceRanges(termWeeks, "revision", ctx);
    const examWeeks = sliceRanges(termWeeks, "exam", ctx);
    const markingWeeks = sliceRanges(termWeeks, "marking", ctx);

    if (!studyWeeks || !examWeeks || !markingWeeks) {
      warnings.push(`Term ${term} is missing required category weeks.`);
      continue;
    }

    termSummaries.push({
      term,
      termStartDate: studyWeeks.start,
      termEndDate: markingWeeks.end,
      studyWeeks,
      revisionWeeks: revisionWeeks ?? undefined,
      examWeeks,
      markingWeeks,
      studyWeekdayCounts: countStudyWeekdays({
        weeks: termWeeks,
        publicHolidayIsoDates: ctx.publicHolidayIsoDates,
      }),
    });
  }

  for (const term of terms) {
    const allocated = weeks.filter((w) => w.term === term).length;
    const expected = requiredTeachingWeeks(term);
    if (allocated !== expected) {
      warnings.push(
        `Term ${term} has ${allocated} teaching weeks allocated (expected ${expected}).`
      );
    }
  }

  return {
    weeks,
    terms: termSummaries,
    warnings,
    holidayPeriods: buildCalendarHolidayPeriods({
      christmasStart: input.christmasStart ?? null,
      christmasEnd: input.christmasEnd ?? null,
      cnyStart: input.cnyStart ?? null,
      cnyEnd: input.cnyEnd ?? null,
    }),
  };
}
