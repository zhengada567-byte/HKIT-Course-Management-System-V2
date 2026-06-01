import { useMemo } from "react";

import { cn } from "../../lib/utils";
import {
  addDays,
  toIsoDateString,
  type CalendarHolidayPeriod,
  type IsoDateString,
  type WeekRange,
} from "../../lib/academicCalendar";
import type { PublicHolidayForDisplay } from "../../services/academicCalendarService";

export interface CalendarBreakItem {
  name: string;
  startDate: IsoDateString;
  endDate: IsoDateString;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfGridMonday(date: Date) {
  const first = startOfMonth(date);
  const jsDay = first.getDay(); // 0=Sun,1=Mon
  const delta = jsDay === 0 ? -6 : 1 - jsDay;
  const d = new Date(first);
  d.setDate(d.getDate() + delta);
  return d;
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long" });
}

function isIsoInRange(iso: IsoDateString, start: IsoDateString, end: IsoDateString) {
  return iso >= start && iso <= end;
}

function findWeekForDate(weeks: WeekRange[], date: Date) {
  const iso = toIsoDateString(date);
  return weeks.find((w) => iso >= toIsoDateString(w.startMonday) && iso <= toIsoDateString(w.endSunday));
}

function badgeColor(category?: string) {
  if (category === "study") return "bg-blue-100 text-blue-800";
  if (category === "revision") return "bg-purple-100 text-purple-800";
  if (category === "exam") return "bg-red-100 text-red-800";
  if (category === "marking") return "bg-amber-100 text-amber-900";
  if (category === "holiday") return "bg-orange-100 text-orange-800";
  return "bg-slate-100 text-slate-700";
}

function shortCategoryLabel(category?: string) {
  if (category === "study") return "Study";
  if (category === "revision") return "Revision";
  if (category === "exam") return "Exam";
  if (category === "marking") return "Marking";
  if (category === "holiday") return "Holiday";
  return "";
}

function findHolidayPeriodForDate(
  iso: IsoDateString,
  periods: CalendarHolidayPeriod[]
): CalendarHolidayPeriod | undefined {
  return periods.find((period) =>
    isIsoInRange(iso, period.startDate, period.endDate)
  );
}

export function MonthCalendar(props: {
  month: Date;
  weeks: WeekRange[];
  publicHolidays: PublicHolidayForDisplay[];
  holidayPeriods?: CalendarHolidayPeriod[];
  breaks: CalendarBreakItem[];
  termStartIsoDates?: Set<IsoDateString>;
  termEndIsoDates?: Set<IsoDateString>;
}) {
  const monthStart = useMemo(() => startOfMonth(props.month), [props.month]);
  const monthEnd = useMemo(() => endOfMonth(props.month), [props.month]);
  const holidayByDate = useMemo(
    () => new Map(props.publicHolidays.map((holiday) => [holiday.date, holiday.name])),
    [props.publicHolidays]
  );

  const gridStart = useMemo(() => startOfGridMonday(props.month), [props.month]);
  const dayCells = useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 42; i += 1) {
      days.push(addDays(gridStart, i));
    }
    return days;
  }, [gridStart]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900">
          {formatMonthLabel(props.month)}
        </h3>
        <p className="text-sm text-slate-500">
          {monthStart.toLocaleDateString()} → {monthEnd.toLocaleDateString()}
        </p>
      </div>

      <div className="grid grid-cols-7 gap-px rounded-lg border bg-slate-200 overflow-hidden">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
          <div
            key={label}
            className="bg-white p-2 text-xs font-medium text-slate-600"
          >
            {label}
          </div>
        ))}

        {dayCells.map((d) => {
          const iso = toIsoDateString(d);
          const inMonth = d.getMonth() === props.month.getMonth();
          const isPublicHoliday = holidayByDate.has(iso);
          const publicHolidayName = holidayByDate.get(iso);
          const week = findWeekForDate(props.weeks, d);
          const category = week?.category;
          const term = week?.term;
          const isSchoolBreak = props.breaks.some((b) =>
            isIsoInRange(iso, b.startDate, b.endDate)
          );
          const holidayPeriod = findHolidayPeriodForDate(
            iso,
            props.holidayPeriods ?? []
          );
          const isPeriodHoliday = Boolean(holidayPeriod);
          const isHolidayOrange =
            isPublicHoliday ||
            isSchoolBreak ||
            Boolean(week?.isHolidayWeek) ||
            isPeriodHoliday;
          const isTermStart = props.termStartIsoDates?.has(iso) ?? false;
          const isTermEnd = props.termEndIsoDates?.has(iso) ?? false;

          return (
            <div
              key={iso}
              className={cn(
                "min-h-20 p-2",
                inMonth ? "bg-white" : "bg-slate-50 text-slate-400",
                isHolidayOrange && inMonth && "bg-orange-100",
                !inMonth && isPeriodHoliday && "bg-orange-50",
                isTermStart && inMonth && "ring-2 ring-purple-400 ring-inset",
                isTermEnd && inMonth && "ring-2 ring-green-500 ring-inset"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{d.getDate()}</span>
                {isPublicHoliday && (
                  <span className="rounded bg-orange-200 px-1.5 py-0.5 text-[10px] font-medium text-orange-900">
                    PH
                  </span>
                )}
              </div>

              <div className="mt-1 space-y-1">
                {category && (
                  <span
                    className={cn(
                      "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                      badgeColor(category)
                    )}
                    title={`${term ?? ""} ${shortCategoryLabel(category)}`}
                  >
                    {term ? `${term} ` : ""}
                    {shortCategoryLabel(category)}
                  </span>
                )}
                {isPublicHoliday && (
                  <span
                    className="inline-flex items-center rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800"
                    title={publicHolidayName}
                  >
                    {publicHolidayName ?? "Public Holiday"}
                  </span>
                )}
                {isSchoolBreak && (
                  <span className="inline-flex items-center rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800">
                    Break
                  </span>
                )}
                {isPeriodHoliday && holidayPeriod && (
                  <span className="inline-flex items-center rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800">
                    {holidayPeriod.label}
                  </span>
                )}
                {week?.isHolidayWeek && (
                  <span className="inline-flex items-center rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800">
                    Holiday Week
                  </span>
                )}
                {isTermStart && (
                  <span className="inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-800">
                    Term Start
                  </span>
                )}
                {isTermEnd && (
                  <span className="inline-flex items-center rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800">
                    Term End
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

