import { useEffect, useMemo, useState } from "react";

import {
  applyFtWednesdayAmToTeacherDraft,
  buildFtTeacherNameSet,
  isFtTeacherOnPage,
  isFtWednesdayAmInstitutionalBlock,
} from "../../../../lib/timetableSchedulingRules";
import { listTeachers } from "../../../../services/teacherService";
import {
  acknowledgeTeacherAvailabilitySaved,
  listTeacherAvailabilitySaved,
  listTeacherNotAvailableForTeachers,
  setTeacherNotAvailable,
  type TeacherAvailabilityPeriod,
} from "../../../../services/timetableTeacherAvailabilityService";

const periods: TeacherAvailabilityPeriod[] = ["AM", "PM", "EVENING"];
const weekdays: Array<{ id: 1 | 2 | 3 | 4 | 5 | 6; label: string }> = [
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
];

function naKey(weekday: number, period: string) {
  return `${weekday}|${period}`;
}

export function TeacherAvailabilityEditor({
  academicYear,
  teacherNames,
  readOnly = false,
}: {
  academicYear: string;
  teacherNames: string[];
  readOnly?: boolean;
}) {
  const sortedTeacherNames = useMemo(
    () =>
      [...new Set(teacherNames.map((name) => String(name ?? "").trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b)
      ),
    [teacherNames]
  );

  const teachersKey = useMemo(
    () => sortedTeacherNames.join("\u0000"),
    [sortedTeacherNames]
  );

  const [selectedTeacher, setSelectedTeacher] = useState("");

  useEffect(() => {
    if (!selectedTeacher && sortedTeacherNames.length > 0) {
      setSelectedTeacher(sortedTeacherNames[0]!);
    }
    if (
      selectedTeacher &&
      sortedTeacherNames.length > 0 &&
      !sortedTeacherNames.includes(selectedTeacher)
    ) {
      setSelectedTeacher(sortedTeacherNames[0]!);
    }
  }, [sortedTeacherNames, selectedTeacher]);

  const [teacherLoading, setTeacherLoading] = useState(false);
  const [teacherError, setTeacherError] = useState<string | null>(null);
  const [naDraftByTeacher, setNaDraftByTeacher] = useState<
    Record<string, Set<string>>
  >({});
  const [naOriginalByTeacher, setNaOriginalByTeacher] = useState<
    Record<string, Set<string>>
  >({});
  const [savedTeacherSet, setSavedTeacherSet] = useState<Set<string>>(
    () => new Set()
  );
  const [savingTeacher, setSavingTeacher] = useState(false);
  const [ftTeacherNames, setFtTeacherNames] = useState<Set<string>>(
    () => new Set()
  );

  const teacherNotAvailable = useMemo(() => {
    if (!selectedTeacher) return new Set<string>();
    return naDraftByTeacher[selectedTeacher] ?? new Set<string>();
  }, [naDraftByTeacher, selectedTeacher]);

  useEffect(() => {
    if (sortedTeacherNames.length === 0) {
      setNaDraftByTeacher({});
      setNaOriginalByTeacher({});
      setSavedTeacherSet(new Set());
      return;
    }

    let cancelled = false;
    setTeacherLoading(true);
    setTeacherError(null);

    void (async () => {
      try {
        const [naRows, savedRows, teacherCatalog] = await Promise.all([
          listTeacherNotAvailableForTeachers({
            academicYear,
            teacherNames: sortedTeacherNames,
          }),
          listTeacherAvailabilitySaved({
            academicYear,
            teacherNames: sortedTeacherNames,
          }),
          listTeachers(academicYear),
        ]);
        if (cancelled) return;

        const ftNames = buildFtTeacherNameSet(teacherCatalog);
        setFtTeacherNames(ftNames);

        const draft: Record<string, Set<string>> = {};
        const original: Record<string, Set<string>> = {};
        for (const teacher of sortedTeacherNames) {
          draft[teacher] = new Set<string>();
          original[teacher] = new Set<string>();
        }

        for (const row of naRows) {
          const teacher = String(row.teacher_name ?? "").trim();
          if (!draft[teacher]) continue;
          const key = naKey(row.weekday, row.period);
          draft[teacher].add(key);
          original[teacher].add(key);
        }

        for (const teacher of sortedTeacherNames) {
          if (!isFtTeacherOnPage(teacher, ftNames)) continue;
          applyFtWednesdayAmToTeacherDraft(draft[teacher]!);
          applyFtWednesdayAmToTeacherDraft(original[teacher]!);
        }

        const saved = new Set<string>();
        for (const row of savedRows) {
          const teacher = String(row.teacher_name ?? "").trim();
          if (teacher) saved.add(teacher);
        }

        setNaDraftByTeacher(draft);
        setNaOriginalByTeacher(original);
        setSavedTeacherSet(saved);
      } catch (error) {
        if (cancelled) return;
        setTeacherError(
          error instanceof Error
            ? error.message
            : "Failed to load teacher availability."
        );
        const empty: Record<string, Set<string>> = {};
        for (const teacher of sortedTeacherNames) {
          empty[teacher] = new Set<string>();
        }
        setNaDraftByTeacher(empty);
        setNaOriginalByTeacher(empty);
        setSavedTeacherSet(new Set());
      } finally {
        if (!cancelled) {
          setTeacherLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [academicYear, teachersKey, sortedTeacherNames]);

  const selectedTeacherIsFt = useMemo(() => {
    if (!selectedTeacher) return false;
    return isFtTeacherOnPage(selectedTeacher, ftTeacherNames);
  }, [selectedTeacher, ftTeacherNames]);

  function toggleTeacherNotAvailable(params: {
    weekday: 1 | 2 | 3 | 4 | 5 | 6;
    period: TeacherAvailabilityPeriod;
  }) {
    if (readOnly || !selectedTeacher) return;

    if (
      selectedTeacherIsFt &&
      isFtWednesdayAmInstitutionalBlock(params.weekday, params.period)
    ) {
      return;
    }

    const key = naKey(params.weekday, params.period);
    setNaDraftByTeacher((prev) => {
      const current = prev[selectedTeacher] ?? new Set<string>();
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [selectedTeacher]: next };
    });
  }

  const selectedTeacherDirty = useMemo(() => {
    if (!selectedTeacher) return false;
    const draft = naDraftByTeacher[selectedTeacher];
    const original = naOriginalByTeacher[selectedTeacher];
    if (!draft || !original) return false;
    if (draft.size !== original.size) return true;
    for (const key of draft) {
      if (!original.has(key)) return true;
    }
    return false;
  }, [naDraftByTeacher, naOriginalByTeacher, selectedTeacher]);

  const selectedTeacherLoaded = useMemo(() => {
    if (!selectedTeacher) return false;
    return (
      naDraftByTeacher[selectedTeacher] !== undefined &&
      naOriginalByTeacher[selectedTeacher] !== undefined
    );
  }, [naDraftByTeacher, naOriginalByTeacher, selectedTeacher]);

  const selectedTeacherCanSave = useMemo(() => {
    if (!selectedTeacher || !selectedTeacherLoaded) return false;
    if (!savedTeacherSet.has(selectedTeacher)) return true;
    return selectedTeacherDirty;
  }, [
    selectedTeacher,
    selectedTeacherLoaded,
    savedTeacherSet,
    selectedTeacherDirty,
  ]);

  async function saveSelectedTeacherAvailability() {
    if (readOnly || !selectedTeacher) return;

    const draft = naDraftByTeacher[selectedTeacher] ?? new Set<string>();
    const original = naOriginalByTeacher[selectedTeacher] ?? new Set<string>();

    const changedKeys = new Set<string>();
    for (const key of draft) {
      if (!original.has(key)) changedKeys.add(key);
    }
    for (const key of original) {
      if (!draft.has(key)) changedKeys.add(key);
    }

    if (isFtTeacherOnPage(selectedTeacher, ftTeacherNames)) {
      changedKeys.add(naKey(3, "AM"));
    }

    setSavingTeacher(true);
    setTeacherError(null);

    try {
      for (const key of changedKeys) {
        const [weekdayText, period] = key.split("|");
        const weekday = Number(weekdayText) as 1 | 2 | 3 | 4 | 5 | 6;
        const notAvailable =
          draft.has(key) ||
          (isFtTeacherOnPage(selectedTeacher, ftTeacherNames) &&
            key === naKey(3, "AM"));
        if (!weekday || !period) continue;
        await setTeacherNotAvailable({
          academicYear,
          teacherName: selectedTeacher,
          weekday,
          period: period as TeacherAvailabilityPeriod,
          notAvailable,
        });
      }

      await acknowledgeTeacherAvailabilitySaved({
        academicYear,
        teacherName: selectedTeacher,
      });

      const finalDraft = new Set(draft);
      if (isFtTeacherOnPage(selectedTeacher, ftTeacherNames)) {
        applyFtWednesdayAmToTeacherDraft(finalDraft);
      }

      setNaDraftByTeacher((prev) => ({ ...prev, [selectedTeacher]: finalDraft }));
      setNaOriginalByTeacher((prev) => ({
        ...prev,
        [selectedTeacher]: finalDraft,
      }));
      setSavedTeacherSet((prev) => {
        const next = new Set(prev);
        next.add(selectedTeacher);
        return next;
      });
    } catch (error) {
      setTeacherError(
        error instanceof Error
          ? error.message
          : "Failed to save teacher availability."
      );
    } finally {
      setSavingTeacher(false);
    }
  }

  if (sortedTeacherNames.length === 0) {
    return (
      <p className="text-sm text-slate-600">No teachers in the catalog for this year.</p>
    );
  }

  return (
    <div className="space-y-4">
      {readOnly && (
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Read-only view for the selected academic year.
        </div>
      )}
      <p className="text-sm text-slate-600">
        Teacher Not Available applies across programmes for this academic year. Tick
        cells when the teacher cannot teach; leave all unchecked and Save if fully
        available.
      </p>
      <p className="text-xs text-slate-500">
        FT teachers: Wednesday AM is fixed as not available (staff meeting).
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="form-label">Teacher</label>
          <select
            className="form-select"
            value={selectedTeacher}
            title="Teacher"
            onChange={(event) => setSelectedTeacher(event.target.value)}
          >
            {sortedTeacherNames.map((teacher) => (
              <option key={teacher} value={teacher}>
                {teacher}
                {savedTeacherSet.has(teacher) ? " ✓" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[520px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                Period
              </th>
              {weekdays.map((day) => (
                <th
                  key={day.id}
                  className="border border-slate-200 bg-slate-50 px-2 py-2 text-center"
                >
                  {day.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => (
              <tr key={period}>
                <td className="border border-slate-200 px-2 py-2 font-medium">
                  {period}
                </td>
                {weekdays.map((day) => {
                  const key = naKey(day.id, period);
                  const checked = teacherNotAvailable.has(key);
                  const institutionalFtBlock =
                    selectedTeacherIsFt &&
                    isFtWednesdayAmInstitutionalBlock(day.id, period);
                  return (
                    <td
                      key={day.id}
                      className="border border-slate-200 px-2 py-2 text-center"
                    >
                      <input
                        type="checkbox"
                        checked={checked || institutionalFtBlock}
                        title={
                          institutionalFtBlock
                            ? "FT staff meeting: Wednesday AM is not available for teaching"
                            : `${selectedTeacher || "Teacher"} not available: ${day.label} ${period}`
                        }
                        disabled={
                          readOnly ||
                          !selectedTeacher ||
                          teacherLoading ||
                          savingTeacher ||
                          institutionalFtBlock
                        }
                        onChange={() =>
                          toggleTeacherNotAvailable({
                            weekday: day.id,
                            period,
                          })
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {teacherLoading && (
        <div className="text-xs text-slate-500">Loading…</div>
      )}

      {selectedTeacher && !readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void saveSelectedTeacherAvailability()}
            disabled={teacherLoading || savingTeacher || !selectedTeacherCanSave}
          >
            {savingTeacher ? "Saving..." : "Save teacher availability"}
          </button>
          <div className="text-xs text-slate-500">
            Saved teachers: {savedTeacherSet.size} / {sortedTeacherNames.length}
          </div>
        </div>
      )}
      {readOnly && (
        <div className="text-xs text-slate-500">
          Saved teachers: {savedTeacherSet.size} / {sortedTeacherNames.length}
        </div>
      )}

      {teacherError && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {teacherError}
        </div>
      )}
    </div>
  );
}
