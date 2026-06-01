import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useAuth } from "../../contexts/AuthContext";
import {
  getNextAcademicYear,
  getPreviousAcademicYear,
  normalizeAcademicYear,
} from "../../lib/utils";
import {
  buildAcademicCalendarPreview,
  deleteAcademicCalendarBreak,
  downloadAcademicCalendarExcel,
  getAcademicCalendarDraft,
  listAcademicCalendarBreaks,
  filterPublicHolidaysInMonth,
  loadPublicHolidaysForCalendarDisplay,
  publishAcademicCalendar,
  updateHkPublicHolidaysFrom1823,
  upsertAcademicCalendarBreak,
  upsertAcademicCalendarDraft,
  type PublicHolidayForDisplay,
} from "../../services/academicCalendarService";
import {
  buildCalendarHolidayPeriods,
  parseIsoDate,
  toIsoDateString,
  type AcademicCalendarResult,
} from "../../lib/academicCalendar";
import { MonthCalendar } from "../../components/academic-calendar/MonthCalendar";

function toDateInputValue(value: string | null | undefined) {
  return String(value ?? "").slice(0, 10);
}

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

export function AcademicCalendarAdminPage() {
  const { user } = useAuth();
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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [startDate, setStartDate] = useState("");
  const [christmasStart, setChristmasStart] = useState("");
  const [christmasEnd, setChristmasEnd] = useState("");
  const [cnyStart, setCnyStart] = useState("");
  const [cnyEnd, setCnyEnd] = useState("");

  const [breakName, setBreakName] = useState("");
  const [breakStart, setBreakStart] = useState("");
  const [breakEnd, setBreakEnd] = useState("");
  const [breaks, setBreaks] = useState<
    Array<{
      id: string;
      break_name: string;
      start_date: string;
      end_date: string;
    }>
  >([]);

  const [preview, setPreview] = useState<AcademicCalendarResult | null>(null);
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

  const holidayPeriods = useMemo(
    () =>
      buildCalendarHolidayPeriods({
        christmasStart: parseIsoDate(christmasStart) ?? null,
        christmasEnd: parseIsoDate(christmasEnd) ?? null,
        cnyStart: parseIsoDate(cnyStart) ?? null,
        cnyEnd: parseIsoDate(cnyEnd) ?? null,
      }),
    [christmasStart, christmasEnd, cnyStart, cnyEnd]
  );

  const loadDraft = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const row = await getAcademicCalendarDraft(academicYear);
      if (!row) {
        // Default: start_date = today.
        const today = new Date();
        setStartDate(toIsoDateString(today));
        setChristmasStart("");
        setChristmasEnd("");
        setCnyStart("");
        setCnyEnd("");
        setBreaks([]);
        setPreview(null);
        return;
      }

      setStartDate(toDateInputValue(row.start_date));
      setChristmasStart(toDateInputValue(row.christmas_start));
      setChristmasEnd(toDateInputValue(row.christmas_end));
      setCnyStart(toDateInputValue(row.cny_start));
      setCnyEnd(toDateInputValue(row.cny_end));

      const breakRows = await listAcademicCalendarBreaks(academicYear);
      setBreaks(
        breakRows.map((b) => ({
          id: b.id,
          break_name: b.break_name,
          start_date: b.start_date,
          end_date: b.end_date,
        }))
      );

      setPreview(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [academicYear]);

  useEffect(() => {
    void loadDraft();
  }, [loadDraft]);

  const refreshPreview = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const result = await buildAcademicCalendarPreview({
        academicYear,
        usePublished: false,
      });
      setPreview(result);
    } catch (error) {
      setPreview(null);
      setPublicHolidays([]);
      setMessage(error instanceof Error ? error.message : "Failed to preview.");
    } finally {
      setLoading(false);
    }
  }, [academicYear]);

  useEffect(() => {
    if (!preview) return;

    void (async () => {
      try {
        const holidays = await loadPublicHolidaysForCalendarDisplay({
          selectedMonth,
          timelineWeeks: preview.weeks,
        });
        setPublicHolidays(holidays);
      } catch {
        setPublicHolidays([]);
      }
    })();
  }, [preview, selectedMonth]);

  const saveDraft = useCallback(async () => {
    if (!user) return;

    if (!startDate) {
      setMessage("Start date is required.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      await upsertAcademicCalendarDraft({
        academicYear,
        startDate: startDate as any,
        christmasStart: christmasStart || null,
        christmasEnd: christmasEnd || null,
        cnyStart: cnyStart || null,
        cnyEnd: cnyEnd || null,
        updatedBy: user.username,
      });

      setMessage("Draft saved.");
      await loadDraft();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [
    academicYear,
    user,
    startDate,
    christmasStart,
    christmasEnd,
    cnyStart,
    cnyEnd,
    loadDraft,
  ]);

  const publish = useCallback(async () => {
    if (!user) return;

    setSaving(true);
    setMessage("");

    try {
      await publishAcademicCalendar({
        academicYear,
        publishedBy: user.username,
      });
      setMessage("Published.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Publish failed.");
    } finally {
      setSaving(false);
    }
  }, [academicYear, user]);

  const exportExcel = useCallback(async () => {
    setSaving(true);
    setMessage("");

    try {
      const result = await downloadAcademicCalendarExcel({
        academicYear,
        usePublished: false,
      });
      setMessage(`Exported ${result.sheetCount} sheet(s) to ${result.fileName}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setSaving(false);
    }
  }, [academicYear]);

  const updateHolidays = useCallback(async () => {
    setSaving(true);
    setMessage("");

    try {
      const result = await updateHkPublicHolidaysFrom1823({ language: "en" });
      setMessage(
        `HK public holidays updated: ${result.insertedOrUpdated} item(s).`
      );

      if (preview) {
        const monthHolidays = await loadPublicHolidaysForCalendarDisplay({
          selectedMonth,
          timelineWeeks: preview.weeks,
        });
        setPublicHolidays(monthHolidays);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to update holidays."
      );
    } finally {
      setSaving(false);
    }
  }, [preview, selectedMonth]);

  const addBreak = useCallback(async () => {
    if (!breakName.trim() || !breakStart || !breakEnd) {
      setMessage("Break name, start date, and end date are required.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      await upsertAcademicCalendarBreak({
        academicYear,
        breakName,
        startDate: breakStart as any,
        endDate: breakEnd as any,
      });

      setBreakName("");
      setBreakStart("");
      setBreakEnd("");
      await loadDraft();
      setMessage("Break saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save break.");
    } finally {
      setSaving(false);
    }
  }, [academicYear, breakName, breakStart, breakEnd, loadDraft]);

  const removeBreak = useCallback(
    async (id: string) => {
      setSaving(true);
      setMessage("");

      try {
        await deleteAcademicCalendarBreak(id);
        await loadDraft();
        setMessage("Break deleted.");
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Failed to delete break."
        );
      } finally {
        setSaving(false);
      }
    },
    [loadDraft]
  );

  return (
    <div className="page-container space-y-6">
      <PageHeader
        title="Academic Calendar (Admin)"
        description="Configure, preview, and publish an academic calendar."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-muted px-3 py-2 text-sm"
              onClick={loadDraft}
              disabled={loading || saving}
            >
              Reload
            </button>
            <button
              type="button"
              className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              onClick={saveDraft}
              disabled={loading || saving}
            >
              Save Draft
            </button>
            <button
              type="button"
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              onClick={publish}
              disabled={loading || saving}
            >
              Publish
            </button>
            <button
              type="button"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              onClick={refreshPreview}
              disabled={loading || saving}
            >
              Preview
            </button>
            <button
              type="button"
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              onClick={exportExcel}
              disabled={loading || saving}
            >
              Export Excel
            </button>
            <button
              type="button"
              className="rounded-md bg-amber-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              onClick={updateHolidays}
              disabled={loading || saving}
            >
              Update HK Public Holidays
            </button>
          </div>
        }
      />

      <div className="card">
        <div className="card-body space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <label className="form-label" htmlFor="ac-admin-academic-year">
                Academic Year
              </label>
              <select
                id="ac-admin-academic-year"
                className="form-input"
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                disabled={loading || saving}
                title="Academic Year"
              >
                {academicYearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label" htmlFor="ac-admin-start-date">
                Start Date
              </label>
              <input
                id="ac-admin-start-date"
                type="date"
                className="form-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={loading || saving}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="form-label" htmlFor="ac-admin-christmas-start">
                Christmas Start
              </label>
              <input
                id="ac-admin-christmas-start"
                type="date"
                className="form-input"
                value={christmasStart}
                onChange={(e) => setChristmasStart(e.target.value)}
                disabled={loading || saving}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="ac-admin-christmas-end">
                Christmas End
              </label>
              <input
                id="ac-admin-christmas-end"
                type="date"
                className="form-input"
                value={christmasEnd}
                onChange={(e) => setChristmasEnd(e.target.value)}
                disabled={loading || saving}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="ac-admin-cny-start">
                CNY Start
              </label>
              <input
                id="ac-admin-cny-start"
                type="date"
                className="form-input"
                value={cnyStart}
                onChange={(e) => setCnyStart(e.target.value)}
                disabled={loading || saving}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="ac-admin-cny-end">
                CNY End
              </label>
              <input
                id="ac-admin-cny-end"
                type="date"
                className="form-input"
                value={cnyEnd}
                onChange={(e) => setCnyEnd(e.target.value)}
                disabled={loading || saving}
              />
            </div>
          </div>

          {message && (
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{message}</p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">School Breaks (Display Only)</h3>
        </div>
        <div className="card-body space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className="form-label" htmlFor="ac-admin-break-name">
                Break Name
              </label>
              <input
                id="ac-admin-break-name"
                className="form-input"
                value={breakName}
                onChange={(e) => setBreakName(e.target.value)}
                disabled={loading || saving}
                placeholder="e.g. Mid-term break"
              />
            </div>
            <div>
              <label className="form-label" htmlFor="ac-admin-break-start">
                Start
              </label>
              <input
                id="ac-admin-break-start"
                type="date"
                className="form-input"
                value={breakStart}
                onChange={(e) => setBreakStart(e.target.value)}
                disabled={loading || saving}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="ac-admin-break-end">
                End
              </label>
              <input
                id="ac-admin-break-end"
                type="date"
                className="form-input"
                value={breakEnd}
                onChange={(e) => setBreakEnd(e.target.value)}
                disabled={loading || saving}
              />
            </div>
          </div>
          <div>
            <button
              type="button"
              className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              onClick={addBreak}
              disabled={loading || saving}
            >
              Add / Save Break
            </button>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-2 text-left">Name</th>
                  <th className="p-2 text-left">Start</th>
                  <th className="p-2 text-left">End</th>
                  <th className="p-2 text-left"></th>
                </tr>
              </thead>
              <tbody>
                {breaks.length === 0 && (
                  <tr className="border-t">
                    <td className="p-3" colSpan={4}>
                      No breaks.
                    </td>
                  </tr>
                )}
                {breaks.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="p-2">{b.break_name}</td>
                    <td className="p-2">{b.start_date}</td>
                    <td className="p-2">{b.end_date}</td>
                    <td className="p-2">
                      <button
                        type="button"
                        className="text-red-600 hover:underline"
                        onClick={() => removeBreak(b.id)}
                        disabled={loading || saving}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {preview && (
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-900">Preview Summary</h3>
          </div>
          <div className="card-body space-y-4">
            {preview.warnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Warnings</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {preview.warnings.map((w, idx) => (
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
                  {preview.terms.map((t) => (
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
                  {preview.terms.map((t) => (
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
                  <label className="form-label" htmlFor="ac-admin-month">
                    Month
                  </label>
                  <input
                    id="ac-admin-month"
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
                    disabled={loading || saving}
                  />
                </div>
                <div className="flex items-end text-sm text-slate-600">
                  Public holidays and school breaks affect working-day start/end dates; holiday weeks (Christmas/CNY full weeks) are inserted into the timeline.
                </div>
              </div>

              <div className="mt-3">
                <MonthCalendar
                  month={selectedMonth}
                  weeks={preview.weeks}
                  publicHolidays={publicHolidays}
                  holidayPeriods={holidayPeriods}
                  breaks={breaks.map((b) => ({
                    name: b.break_name,
                    startDate: b.start_date as any,
                    endDate: b.end_date as any,
                  }))}
                  termStartIsoDates={
                    new Set(preview.terms.map((t) => toIsoDateString(t.termStartDate) as any))
                  }
                  termEndIsoDates={
                    new Set(preview.terms.map((t) => toIsoDateString(t.termEndDate) as any))
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

