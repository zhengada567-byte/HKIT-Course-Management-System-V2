import { useEffect, useMemo, useState } from "react";

import {
  defaultClassroomsForHKIT,
  type TimetableClassroomRow,
  type TimetableScheduleTerm,
} from "../../../../services/timetableScheduleService";
import type { TimetableModuleInstanceRow } from "../../../../services/timetableModuleInstanceService";
import { dedupeJoinedModuleName } from "../../../../lib/moduleDisplay";
import {
  applyFtWednesdayAmToTeacherDraft,
  buildFtTeacherNameSet,
  isFtTeacherOnPage,
  isFtWednesdayAmInstitutionalBlock,
  isTeacherExcludedFromScheduleDropdown,
} from "../../../../lib/timetableSchedulingRules";
import { listTeachers } from "../../../../services/teacherService";
import {
  acknowledgeTeacherAvailabilitySaved,
  listTeacherAvailabilitySaved,
  listTeacherNotAvailableForTeachers,
  setTeacherNotAvailable,
  type TeacherAvailabilityPeriod,
} from "../../../../services/timetableTeacherAvailabilityService";
import {
  listInstancePreferences,
  upsertInstancePreferences,
} from "../../../../services/timetableInstancePreferenceService";
import {
  autoScheduleInstances,
  type AutoScheduleFailure,
} from "../../../../services/timetableAutoScheduleService";
import { listTimetableModulesByInstanceCodes } from "../../../../services/timetableService";
import type { ModuleTerm, TimetableModuleRow } from "../../../../types";
import { WeeklyTimetableEditor } from "./WeeklyTimetableEditor";

export function ScheduleStep(props: {
  academicYear: string;
  moduleTerm: ModuleTerm;
  timetableInstances: TimetableModuleInstanceRow[];
  programmeCode?: string;
  /** Timetable modules on this page (split + no-split); used for empty-state hints */
  sourceTimetableModuleCount?: number;
}) {
  const {
    academicYear,
    moduleTerm,
    timetableInstances,
    programmeCode,
    sourceTimetableModuleCount = 0,
  } = props;

  const classrooms = useMemo<TimetableClassroomRow[]>(
    () => defaultClassroomsForHKIT(),
    []
  );

  const scheduleTerm = moduleTerm as TimetableScheduleTerm;

  const [timetableModuleMeta, setTimetableModuleMeta] = useState<
    Record<string, TimetableModuleRow>
  >({});

  useEffect(() => {
    const codes = timetableInstances
      .map((row) => String(row.module_instance_code ?? "").trim())
      .filter(Boolean);

    if (codes.length === 0) {
      setTimetableModuleMeta({});
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const modules = await listTimetableModulesByInstanceCodes({
          academicYear,
          moduleInstanceCodes: codes,
        });

        if (cancelled) return;

        const map: Record<string, TimetableModuleRow> = {};
        for (const module of modules) {
          const code = String(module.module_instance_code ?? "").trim();
          if (code) map[code] = module;
        }
        setTimetableModuleMeta(map);
      } catch {
        if (!cancelled) setTimetableModuleMeta({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [academicYear, timetableInstances]);

  const moduleOptions = useMemo(() => {
    return timetableInstances
      .filter((row) => row.module_term === moduleTerm)
      .map((row) => {
        const meta = timetableModuleMeta[row.module_instance_code];

        return {
          id: row.id,
          moduleInstanceCode: row.module_instance_code,
          moduleName: row.module_name || "",
          moduleTerm: row.module_term,
          moduleYear: meta?.module_year ?? "",
          streamCode: meta?.stream_code ?? "",
          mode:
            String(row.instance_mode ?? "").trim() ||
            String(meta?.mode ?? "").trim() ||
            "",
          size: row.instance_expected_size ?? null,
          teacherName: row.instance_teacher_name ?? "",
        };
      })
      .sort((a, b) => a.moduleInstanceCode.localeCompare(b.moduleInstanceCode));
  }, [timetableInstances, moduleTerm, timetableModuleMeta]);

  const instancesForTermCount = useMemo(
    () => timetableInstances.filter((row) => row.module_term === moduleTerm).length,
    [timetableInstances, moduleTerm]
  );

  const teachersOnPage = useMemo(() => {
    return Array.from(
      new Set(
        timetableInstances
          .map((row) => String(row.instance_teacher_name ?? "").trim())
          .filter(Boolean)
          .filter((name) => !isTeacherExcludedFromScheduleDropdown(name))
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [timetableInstances]);

  const [selectedTeacher, setSelectedTeacher] = useState("");
  useEffect(() => {
    if (!selectedTeacher && teachersOnPage.length > 0) {
      setSelectedTeacher(teachersOnPage[0]!);
    }
    if (
      selectedTeacher &&
      teachersOnPage.length > 0 &&
      !teachersOnPage.includes(selectedTeacher)
    ) {
      setSelectedTeacher(teachersOnPage[0]!);
    }
  }, [teachersOnPage, selectedTeacher]);

  const [teacherLoading, setTeacherLoading] = useState(false);
  const [teacherError, setTeacherError] = useState<string | null>(null);

  // Per-teacher draft state (edit first, save later).
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
  const [teachersAvailabilityReady, setTeachersAvailabilityReady] = useState(false);
  const [ftTeacherNames, setFtTeacherNames] = useState<Set<string>>(() => new Set());

  const teachersOnPageKey = useMemo(
    () => teachersOnPage.join("\u0000"),
    [teachersOnPage]
  );

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

  const teacherNotAvailable = useMemo(() => {
    if (!selectedTeacher) return new Set<string>();
    return naDraftByTeacher[selectedTeacher] ?? new Set<string>();
  }, [naDraftByTeacher, selectedTeacher]);

  useEffect(() => {
    if (teachersOnPage.length === 0) {
      setNaDraftByTeacher({});
      setNaOriginalByTeacher({});
      setSavedTeacherSet(new Set());
      setTeachersAvailabilityReady(true);
      return;
    }

    let cancelled = false;
    setTeachersAvailabilityReady(false);
    setTeacherLoading(true);
    setTeacherError(null);

    void (async () => {
      try {
        const [naRows, savedRows, teacherCatalog] = await Promise.all([
          listTeacherNotAvailableForTeachers({
            academicYear,
            teacherNames: teachersOnPage,
          }),
          listTeacherAvailabilitySaved({
            academicYear,
            teacherNames: teachersOnPage,
          }),
          listTeachers(academicYear),
        ]);
        if (cancelled) return;

        const ftNames = buildFtTeacherNameSet(teacherCatalog);
        setFtTeacherNames(ftNames);

        const draft: Record<string, Set<string>> = {};
        const original: Record<string, Set<string>> = {};
        for (const teacher of teachersOnPage) {
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

        for (const teacher of teachersOnPage) {
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
        for (const teacher of teachersOnPage) {
          empty[teacher] = new Set<string>();
        }
        setNaDraftByTeacher(empty);
        setNaOriginalByTeacher(empty);
        setSavedTeacherSet(new Set());
      } finally {
        if (!cancelled) {
          setTeacherLoading(false);
          setTeachersAvailabilityReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [academicYear, teachersOnPageKey]);

  const selectedTeacherIsFt = useMemo(() => {
    if (!selectedTeacher) return false;
    return isFtTeacherOnPage(selectedTeacher, ftTeacherNames);
  }, [selectedTeacher, ftTeacherNames]);

  function toggleTeacherNotAvailable(params: {
    weekday: 1 | 2 | 3 | 4 | 5 | 6;
    period: TeacherAvailabilityPeriod;
  }) {
    if (!selectedTeacher) return;

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

  /** All-available teachers can Save without ticking any cell (marks teacher as done). */
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
    if (!selectedTeacher) return;

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
      setNaOriginalByTeacher((prev) => ({ ...prev, [selectedTeacher]: finalDraft }));
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

  const instanceCodesForTerm = useMemo(() => {
    return timetableInstances
      .filter((row) => row.module_term === moduleTerm)
      .map((row) => row.module_instance_code);
  }, [timetableInstances, moduleTerm]);

  const [prefLoading, setPrefLoading] = useState(false);
  const [prefError, setPrefError] = useState<string | null>(null);
  const [preferredStartByCode, setPreferredStartByCode] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    if (instanceCodesForTerm.length === 0) {
      setPreferredStartByCode({});
      return;
    }

    let cancelled = false;
    setPrefLoading(true);
    setPrefError(null);

    void (async () => {
      try {
        const rows = await listInstancePreferences({
          academicYear,
          moduleInstanceCodes: instanceCodesForTerm,
        });
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const row of rows) {
          if (!row.preferred_start_time) continue;
          map[row.module_instance_code] = String(row.preferred_start_time).slice(
            0,
            5
          );
        }
        setPreferredStartByCode(map);
      } catch (error) {
        if (cancelled) return;
        setPrefError(
          error instanceof Error
            ? error.message
            : "Failed to load instance preferences."
        );
        setPreferredStartByCode({});
      } finally {
        if (!cancelled) setPrefLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [academicYear, instanceCodesForTerm]);

  const startTimeOptions = useMemo(() => {
    const options: string[] = [];
    const startMinutes = 8 * 60;
    const endMinutes = 14 * 60 + 30;
    for (let m = startMinutes; m <= endMinutes; m += 30) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      options.push(`${hh}:${mm}`);
    }
    return options;
  }, []);

  const hasUnsavedTeacherDrafts = useMemo(() => {
    if (!teachersAvailabilityReady) return true;

    for (const teacher of teachersOnPage) {
      const draft = naDraftByTeacher[teacher];
      const original = naOriginalByTeacher[teacher];
      if (!draft || !original) {
        return true;
      }
      if (draft.size !== original.size) return true;
      for (const key of draft) {
        if (!original.has(key)) return true;
      }
    }
    return false;
  }, [
    teachersOnPage,
    naDraftByTeacher,
    naOriginalByTeacher,
    teachersAvailabilityReady,
  ]);

  const allTeachersSavedOnce = useMemo(() => {
    if (teachersOnPage.length === 0) return true;
    for (const teacher of teachersOnPage) {
      if (!savedTeacherSet.has(teacher)) return false;
    }
    return true;
  }, [teachersOnPage, savedTeacherSet]);

  const canEditStartTimes = allTeachersSavedOnce && !hasUnsavedTeacherDrafts;

  async function savePreferences() {
    const rows = Object.entries(preferredStartByCode).map(
      ([module_instance_code, preferred_start_time]) => ({
        module_instance_code,
        preferred_start_time: preferred_start_time || null,
      })
    );

    try {
      await upsertInstancePreferences({
        academicYear,
        rows,
      });
    } catch (error) {
      setPrefError(
        error instanceof Error
          ? error.message
          : "Failed to save instance preferences."
      );
    }
  }

  const [autoLoading, setAutoLoading] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [autoResult, setAutoResult] = useState<string | null>(null);
  const [autoFailures, setAutoFailures] = useState<AutoScheduleFailure[]>([]);
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const [weeklyRefreshToken, setWeeklyRefreshToken] = useState(0);

  const instancesForSelectedTerm = useMemo(
    () => timetableInstances.filter((row) => row.module_term === moduleTerm),
    [timetableInstances, moduleTerm]
  );

  async function handleAutoSchedule() {
    setAutoLoading(true);
    setAutoError(null);
    setAutoResult(null);
    setAutoFailures([]);

    try {
      const result = await autoScheduleInstances({
        academicYear,
        term: scheduleTerm,
        programmeCode: programmeCode || undefined,
        instances: timetableInstances.filter((row) => row.module_term === moduleTerm),
        classrooms,
        preferredStartByCode,
      });

      setAutoFailures(result.failures);
      setAutoResult(
        result.skippedAlreadyScheduledCount > 0
          ? `Scheduled: ${result.scheduledCount}; skipped (already scheduled): ${result.skippedAlreadyScheduledCount}; failed: ${result.failedCount}.`
          : `Scheduled: ${result.scheduledCount}（已覆盖本学期既有排课）; failed: ${result.failedCount}.`
      );
      setWeeklyRefreshToken((value) => value + 1);
    } catch (error) {
      setAutoError(
        error instanceof Error ? error.message : "Auto schedule failed."
      );
    } finally {
      setAutoLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-lg font-semibold">排課（自動排課）</div>
        <div className="mt-1 text-sm text-slate-600">
          以 <span className="font-medium">module_instance_code</span>{" "}
          為排課單位（來自分班後的 instances 表）。
        </div>

        <div className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          流程：填老師 Not Available（Mon–Sat × 上午/下午/晚上）＋ Day/Sat 開始時間 →
          點「自動排課」→ 系統寫入 timetable_sessions；亦可展開 Weekly Timetable
          手動以 + / − 編輯後按 Save Timetable 儲存。預設顯示全部課程已儲存時段；可切換「只看本
          Programme」。衝突：同一時段內相同老師 + programme + stream + 年級不可重複。
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium text-slate-900">
          Module instances（本頁範圍）
        </div>
        <div className="mt-1 text-sm text-slate-600">
          共 {timetableInstances.length} 個 instance
          {programmeCode ? `（${programmeCode}）` : ""}；{moduleTerm} 學期：
          {instancesForTermCount} 個
        </div>
        {sourceTimetableModuleCount > 0 && timetableInstances.length === 0 && (
          <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            本頁已有 {sourceTimetableModuleCount} 條分班記錄，但尚未生成 module
            instance。請回到「分班」步驟點擊{" "}
            <span className="font-medium">Confirm All Split Decisions</span>
            ，或確認已執行 Supabase migration 014/015/016/017。
          </div>
        )}
        {timetableInstances.length > 0 && instancesForTermCount === 0 && (
          <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            本頁有 {timetableInstances.length} 個 instance，但當前選擇的 {moduleTerm}{" "}
            學期為 0 個。請在頁面頂部切換 Module Term。
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium text-slate-900">自動排課前設定</div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="form-label">Teacher</label>
            <select
              className="form-select"
              value={selectedTeacher}
              title="Teacher"
              onChange={(e) => setSelectedTeacher(e.target.value)}
              disabled={teachersOnPage.length === 0}
            >
              {teachersOnPage.length === 0 ? (
                <option value="">No teacher on instances</option>
              ) : (
                teachersOnPage.map((t) => (
                  <option key={t} value={t}>
                    {t}
                    {savedTeacherSet.has(t) ? " ✓" : ""}
                  </option>
                ))
              )}
            </select>
            <div className="mt-1 text-xs text-slate-500">
              老师 Not Available 会影响全局排课（跨 programme leader）。
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-sm font-medium text-slate-900">
            Teacher Not Available（Mon–Sat × AM/PM/Evening）
          </div>
          <div className="mt-1 text-xs text-slate-600">
            先为每个老师设置并点击 <span className="font-medium">Save</span>（若全部时间都可上课、无需勾选，直接 Save 即可），完成后才可设置 Day/Saturday 的上课时间。
          </div>
          <div className="mt-1 text-xs text-slate-600">
            机构规则：<span className="font-medium">FT</span> 老师{" "}
            <span className="font-medium">星期三上午</span>（Wed AM）固定开会，不可排课（自动勾选且不可取消）。
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-[520px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                    Period
                  </th>
                  {weekdays.map((d) => (
                    <th
                      key={d.id}
                      className="border border-slate-200 bg-slate-50 px-2 py-2 text-center"
                    >
                      {d.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p}>
                    <td className="border border-slate-200 px-2 py-2 font-medium">
                      {p}
                    </td>
                    {weekdays.map((d) => {
                      const key = naKey(d.id, p);
                      const checked = teacherNotAvailable.has(key);
                      const institutionalFtBlock =
                        selectedTeacherIsFt &&
                        isFtWednesdayAmInstitutionalBlock(d.id, p);
                      return (
                        <td
                          key={d.id}
                          className="border border-slate-200 px-2 py-2 text-center"
                        >
                          <input
                            type="checkbox"
                            checked={checked || institutionalFtBlock}
                            title={
                              institutionalFtBlock
                                ? "FT staff meeting: Wednesday AM is not available for teaching"
                                : `${selectedTeacher || "Teacher"} not available: ${d.label} ${p}`
                            }
                            disabled={
                              !selectedTeacher ||
                              teacherLoading ||
                              savingTeacher ||
                              institutionalFtBlock
                            }
                            onChange={() =>
                              void toggleTeacherNotAvailable({
                                weekday: d.id,
                                period: p,
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
            <div className="mt-2 text-xs text-slate-500">Loading…</div>
          )}
          {selectedTeacher && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void saveSelectedTeacherAvailability()}
                disabled={
                  teacherLoading || savingTeacher || !selectedTeacherCanSave
                }
                title={
                  selectedTeacherCanSave
                    ? savedTeacherSet.has(selectedTeacher) && !selectedTeacherDirty
                      ? "No changes to save"
                      : `Save availability for ${selectedTeacher}`
                    : "Loading teacher availability…"
                }
              >
                {savingTeacher ? "Saving..." : "Save teacher availability"}
              </button>
              <div className="text-xs text-slate-500">
                Saved teachers: {savedTeacherSet.size} / {teachersOnPage.length}
                {allTeachersSavedOnce && !hasUnsavedTeacherDrafts && (
                  <span className="ml-2 text-emerald-700">（已全部保存，可设置 Day/Sat 上课时间）</span>
                )}
              </div>
            </div>
          )}
          {teacherError && (
            <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {teacherError}
            </div>
          )}
        </div>

        <div className="mt-6">
          <div className="text-sm font-medium text-slate-900">
            Day / Saturday start time（4 hours）
          </div>
          <div className="mt-1 text-xs text-slate-600">
            只对 Day/Saturday 生效（Night 固定 18:30）。可选 08:00–14:30（每 30 分钟）。
          </div>
          {!canEditStartTimes && teachersOnPage.length > 0 && (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              请先为本页所有老师完成 Not Available 设置并点击 Save（且没有未保存改动），再设置 Day/Saturday 上课时间。
            </div>
          )}

          {prefError && (
            <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {prefError}
            </div>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[720px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                    Module instance
                  </th>
                  <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                    Module year
                  </th>
                  <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                    Stream
                  </th>
                  <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                    Mode
                  </th>
                  <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                    Teacher
                  </th>
                  <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                    Expected size
                  </th>
                  <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                    Preferred start
                  </th>
                </tr>
              </thead>
              <tbody>
                {moduleOptions.map((m) => {
                  const isEditable =
                    m.mode === "Day" || m.mode === "Saturday";
                  const value = preferredStartByCode[m.moduleInstanceCode] ?? "";
                  return (
                    <tr key={m.id}>
                      <td className="border border-slate-200 px-2 py-2">
                        {m.moduleInstanceCode}{" "}
                        {m.moduleName
                          ? `- ${dedupeJoinedModuleName(m.moduleName)}`
                          : ""}
                      </td>
                      <td className="border border-slate-200 px-2 py-2">
                        {m.moduleYear || "(empty)"}
                      </td>
                      <td className="border border-slate-200 px-2 py-2">
                        {m.streamCode || "(empty)"}
                      </td>
                      <td className="border border-slate-200 px-2 py-2">
                        {m.mode || "(empty)"}
                      </td>
                      <td className="border border-slate-200 px-2 py-2">
                        {m.teacherName || "(empty)"}
                      </td>
                      <td className="border border-slate-200 px-2 py-2">
                        {m.size ?? "(empty)"}
                      </td>
                      <td className="border border-slate-200 px-2 py-2">
                        {isEditable ? (
                          <select
                            className="form-select"
                            value={value}
                            title={`Preferred start time for ${m.moduleInstanceCode}`}
                            disabled={prefLoading || !canEditStartTimes}
                            onChange={(e) => {
                              const next = { ...preferredStartByCode };
                              next[m.moduleInstanceCode] = e.target.value;
                              setPreferredStartByCode(next);
                            }}
                          >
                            <option value="">(not set)</option>
                            {startTimeOptions.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-500">
                            {m.mode === "Night" ? "18:30" : "-"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void savePreferences()}
              disabled={prefLoading || !canEditStartTimes}
            >
              Save start time preferences
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleAutoSchedule()}
              disabled={autoLoading || moduleOptions.length === 0}
            >
              {autoLoading ? "Scheduling..." : "Auto schedule"}
            </button>
          </div>

          {autoError && (
            <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {autoError}
            </div>
          )}
          {autoResult && (
            <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {autoResult}
            </div>
          )}

          {autoFailures.length > 0 && (
            <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <div className="font-medium">
                Failed modules ({autoFailures.length})
              </div>
              <p className="mt-1 text-xs text-amber-900">
                Check Module year and per-weekday notes (e.g. why Tue evening was
                skipped).
              </p>
              <div className="mt-2 max-h-80 overflow-auto">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="border border-amber-200 bg-amber-100/80 px-2 py-1 text-left">
                        Code
                      </th>
                      <th className="border border-amber-200 bg-amber-100/80 px-2 py-1 text-left">
                        Year
                      </th>
                      <th className="border border-amber-200 bg-amber-100/80 px-2 py-1 text-left">
                        Stream
                      </th>
                      <th className="border border-amber-200 bg-amber-100/80 px-2 py-1 text-left">
                        Mode
                      </th>
                      <th className="border border-amber-200 bg-amber-100/80 px-2 py-1 text-left">
                        Time
                      </th>
                      <th className="border border-amber-200 bg-amber-100/80 px-2 py-1 text-left">
                        Summary
                      </th>
                      <th className="border border-amber-200 bg-amber-100/80 px-2 py-1 text-left">
                        Mon–Fri detail
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {autoFailures.map((row) => (
                      <tr key={`${row.code}-${row.reason}`}>
                        <td className="border border-amber-200 px-2 py-1 font-mono">
                          {row.code}
                        </td>
                        <td className="border border-amber-200 px-2 py-1">
                          {row.module_year ?? "-"}
                        </td>
                        <td className="border border-amber-200 px-2 py-1">
                          {row.stream_code ?? "-"}
                        </td>
                        <td className="border border-amber-200 px-2 py-1">
                          {row.mode ?? "-"}
                        </td>
                        <td className="border border-amber-200 px-2 py-1 whitespace-nowrap">
                          {row.time_window}
                        </td>
                        <td className="border border-amber-200 px-2 py-1">
                          {row.reason}
                        </td>
                        <td className="border border-amber-200 px-2 py-1">
                          {row.weekday_detail || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <WeeklyTimetableEditor
            academicYear={academicYear}
            term={scheduleTerm}
            programmeCode={programmeCode || undefined}
            timetableInstances={instancesForSelectedTerm}
            classrooms={classrooms}
            preferredStartByCode={preferredStartByCode}
            startTimeOptions={startTimeOptions}
            open={weeklyOpen}
            onOpenChange={setWeeklyOpen}
            refreshToken={weeklyRefreshToken}
          />
        </div>
      </div>
    </div>
  );
}
