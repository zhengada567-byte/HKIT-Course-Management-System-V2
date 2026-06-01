import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "../components/ui/PageHeader";
import { useAcademicYear } from "../contexts/AcademicYearContext";
import {
  getNextAcademicYear,
  getPreviousAcademicYear,
  normalizeAcademicYear,
} from "../lib/utils";
import {
  buildAcademicCalendarPreview,
  downloadAcademicCalendarExcel,
  listAcademicCalendarBreaks,
  filterPublicHolidaysInMonth,
  loadPublicHolidaysForCalendarDisplay,
  type PublicHolidayForDisplay,
} from "../services/academicCalendarService";
import type { AcademicCalendarResult } from "../lib/academicCalendar";
import { MonthCalendar } from "../components/academic-calendar/MonthCalendar";
import { toIsoDateString } from "../lib/academicCalendar";

function formatDateRange(start: Date, end: Date) {
  return `${start.toLocaleDateString()} → ${end.toLocaleDateString()}`;
}

function formatDate(value: Date) {
  return value.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    weekday: "short",
  });
}

export function AcademicCalendarPage() {
  const { academicYear: currentAcademicYear } = useAcademicYear();

  const academicYearOptions = useMemo(() => {
    return [
      normalizeAcademicYear(currentAcademicYear),
      getNextAcademicYear(currentAcademicYear),
      getPreviousAcademicYear(currentAcademicYear),
    ].filter((value, index, array) => array.indexOf(value) === index);
  }, [currentAcademicYear]);

  const [academicYear, setAcademicYear] = useState(
    normalizeAcademicYear(currentAcademicYear)
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [calendar, setCalendar] = useState<AcademicCalendarResult | null>(null);
  const [breaks, setBreaks] = useState<
    Array<{ name: string; startDate: string; endDate: string }>
  >([]);
  const [publicHolidays, setPublicHolidays] = useState<PublicHolidayForDisplay[]>(
    []
  );
  const [selectedMonth, setSelectedMonth] = useState(() => new Date());

  const monthPublicHolidays = useMemo(
    () => filterPublicHolidaysInMonth(publicHolidays, selectedMonth),
    [publicHolidays, selectedMonth]
  );

  const selectedMonthLabel = useMemo(
    () =>
      selectedMonth.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
      }),
    [selectedMonth]
  );

  const loadPublished = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const result = await buildAcademicCalendarPreview({
        academicYear,
        usePublished: true,
      });
      setCalendar(result);

      const breakRows = await listAcademicCalendarBreaks(academicYear);
      setBreaks(
        breakRows.map((b) => ({
          name: b.break_name,
          startDate: b.start_date,
          endDate: b.end_date,
        }))
      );

    } catch (error) {
      setCalendar(null);
      setPublicHolidays([]);
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to load published calendar."
      );
    } finally {
      setLoading(false);
    }
  }, [academicYear]);

  const exportExcel = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const result = await downloadAcademicCalendarExcel({
        academicYear,
        usePublished: true,
      });
      setMessage(`Exported ${result.sheetCount} sheet(s) to ${result.fileName}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setLoading(false);
    }
  }, [academicYear]);

  useEffect(() => {
    void loadPublished();
  }, [loadPublished]);

  useEffect(() => {
    if (!calendar) return;

    void (async () => {
      try {
        const holidays = await loadPublicHolidaysForCalendarDisplay({
          selectedMonth,
          timelineWeeks: calendar.weeks,
        });
        setPublicHolidays(holidays);
      } catch {
        setPublicHolidays([]);
      }
    })();
  }, [calendar, selectedMonth]);

  return (
    <div className="page-container space-y-6">
      <PageHeader
        title="Academic Calendar"
        description="Published academic calendar summary."
        actions={
          <div className="flex flex-wrap gap-2">
            <select
              className="form-input"
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              disabled={loading}
              title="Academic Year"
            >
              {academicYearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-md bg-muted px-3 py-2 text-sm"
              onClick={loadPublished}
              disabled={loading}
            >
              Refresh
            </button>
            <button
              type="button"
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              onClick={exportExcel}
              disabled={loading}
            >
              Export Excel
            </button>
          </div>
        }
      />

      {message && (
        <div className="rounded-md border bg-white p-4 text-sm text-slate-700 whitespace-pre-wrap">
          {message}
        </div>
      )}

      {loading && (
        <div className="rounded-md border bg-white p-4 text-sm text-slate-700">
          Loading...
        </div>
      )}

      {!loading && calendar && (
        <div className="card">
          <div className="card-body space-y-4">
            {calendar.warnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Warnings</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {calendar.warnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-2 text-left">Term</th>
                    <th className="p-2 text-left">Term Start Date</th>
                    <th className="p-2 text-left">Study Weeks</th>
                    <th className="p-2 text-left">Revision Week</th>
                    <th className="p-2 text-left">Exam Weeks</th>
                    <th className="p-2 text-left">Marking Weeks</th>
                    <th className="p-2 text-left">Term End Date</th>
                  </tr>
                </thead>
                <tbody>
                  {calendar.terms.map((t) => (
                    <tr key={t.term} className="border-t">
                      <td className="p-2 font-semibold">{t.term}</td>
                      <td className="p-2 bg-purple-50">{formatDate(t.termStartDate)}</td>
                      <td className="p-2">
                        {t.studyWeeks.count} ({formatDateRange(t.studyWeeks.start, t.studyWeeks.end)})
                      </td>
                      <td className="p-2">
                        {t.revisionWeeks
                          ? `${t.revisionWeeks.count} (${formatDateRange(
                              t.revisionWeeks.start,
                              t.revisionWeeks.end
                            )})`
                          : "-"}
                      </td>
                      <td className="p-2">
                        {t.examWeeks.count} ({formatDateRange(t.examWeeks.start, t.examWeeks.end)})
                      </td>
                      <td className="p-2">
                        {t.markingWeeks.count} ({formatDateRange(t.markingWeeks.start, t.markingWeeks.end)})
                      </td>
                      <td className="p-2 bg-green-50">{formatDate(t.termEndDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-2 text-left">Term</th>
                    <th className="p-2 text-left">Study Weeks</th>
                    <th className="p-2 text-left">Mon</th>
                    <th className="p-2 text-left">Tue</th>
                    <th className="p-2 text-left">Wed</th>
                    <th className="p-2 text-left">Thu</th>
                    <th className="p-2 text-left">Fri</th>
                    <th className="p-2 text-left">Total Study Days (PH excluded)</th>
                  </tr>
                </thead>
                <tbody>
                  {calendar.terms.map((t) => (
                    <tr key={t.term} className="border-t">
                      <td className="p-2 font-semibold">{t.term}</td>
                      <td className="p-2">{t.studyWeeks.count}</td>
                      <td className="p-2">{t.studyWeekdayCounts.mon}</td>
                      <td className="p-2">{t.studyWeekdayCounts.tue}</td>
                      <td className="p-2">{t.studyWeekdayCounts.wed}</td>
                      <td className="p-2">{t.studyWeekdayCounts.thu}</td>
                      <td className="p-2">{t.studyWeekdayCounts.fri}</td>
                      <td className="p-2 font-semibold">{t.studyWeekdayCounts.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="text-sm text-muted-foreground">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="form-label" htmlFor="ac-view-month">
                    Month
                  </label>
                  <input
                    id="ac-view-month"
                    type="month"
                    className="form-input"
                    value={`${selectedMonth.getFullYear()}-${String(
                      selectedMonth.getMonth() + 1
                    ).padStart(2, "0")}`}
                    onChange={(e) => {
                      const [y, m] = e.target.value.split("-").map(Number);
                      if (Number.isFinite(y) && Number.isFinite(m)) {
                        setSelectedMonth(new Date(y, m - 1, 1));
                      }
                    }}
                    disabled={loading}
                  />
                </div>
                <div className="flex items-end text-sm text-slate-600">
                  Public holidays are excluded from weekday counts. Breaks are display only.
                </div>
              </div>

              <div className="mt-3">
                <MonthCalendar
                  month={selectedMonth}
                  weeks={calendar.weeks}
                  publicHolidays={publicHolidays}
                  holidayPeriods={calendar.holidayPeriods}
                  breaks={breaks.map((b) => ({
                    name: b.name,
                    startDate: b.startDate as any,
                    endDate: b.endDate as any,
                  }))}
                  termStartIsoDates={
                    new Set(calendar.terms.map((t) => toIsoDateString(t.termStartDate) as any))
                  }
                  termEndIsoDates={
                    new Set(calendar.terms.map((t) => toIsoDateString(t.termEndDate) as any))
                  }
                />
              </div>

              <div className="mt-4 rounded-md border overflow-x-auto">
                <h3 className="border-b bg-muted px-3 py-2 text-sm font-semibold text-slate-900">
                  HK Public Holidays — {selectedMonthLabel}
                </h3>
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-2 text-left">Date</th>
                      <th className="p-2 text-left">Holiday</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthPublicHolidays.length === 0 && (
                      <tr>
                        <td className="p-2 text-slate-500" colSpan={2}>
                          No public holidays in {selectedMonthLabel}.
                        </td>
                      </tr>
                    )}
                    {monthPublicHolidays.map((holiday) => (
                      <tr key={holiday.date} className="border-t">
                        <td className="p-2 whitespace-nowrap bg-orange-50 font-medium">
                          {holiday.date}
                        </td>
                        <td className="p-2">{holiday.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

