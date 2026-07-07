import { useEffect, useMemo, useState } from "react";

import {
  listTimetableClassrooms,
  type TimetableClassroomRow,
  type TimetableScheduleTerm,
} from "../../../../services/timetableScheduleService";
import type { TimetableModuleInstanceRow } from "../../../../services/timetableModuleInstanceService";
import { dedupeJoinedModuleName } from "../../../../lib/moduleDisplay";
import {
  isTeacherExcludedFromScheduleDropdown,
  buildDayAutoScheduleStartOptions,
} from "../../../../lib/timetableSchedulingRules";
import {
  listTeacherAvailabilitySaved,
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
  crossProgrammeInstanceCount?: number;
  classroomRefreshToken?: number;
}) {
  const {
    academicYear,
    moduleTerm,
    timetableInstances,
    programmeCode,
    sourceTimetableModuleCount = 0,
    crossProgrammeInstanceCount = 0,
    classroomRefreshToken = 0,
  } = props;

  const [classrooms, setClassrooms] = useState<TimetableClassroomRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const rows = await listTimetableClassrooms();
        if (!cancelled) setClassrooms(rows);
      } catch {
        if (!cancelled) setClassrooms([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [classroomRefreshToken]);

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

  const teachersOnPageKey = useMemo(
    () => teachersOnPage.join("\u0000"),
    [teachersOnPage]
  );

  const [savedTeacherSet, setSavedTeacherSet] = useState<Set<string>>(
    () => new Set()
  );
  const [availabilityWarningLoading, setAvailabilityWarningLoading] =
    useState(false);

  useEffect(() => {
    if (teachersOnPage.length === 0) {
      setSavedTeacherSet(new Set());
      return;
    }

    let cancelled = false;
    setAvailabilityWarningLoading(true);

    void (async () => {
      try {
        const savedRows = await listTeacherAvailabilitySaved({
          academicYear,
          teacherNames: teachersOnPage,
        });
        if (cancelled) return;

        const saved = new Set<string>();
        for (const row of savedRows) {
          const teacher = String(row.teacher_name ?? "").trim();
          if (teacher) saved.add(teacher);
        }
        setSavedTeacherSet(saved);
      } catch {
        if (!cancelled) setSavedTeacherSet(new Set());
      } finally {
        if (!cancelled) setAvailabilityWarningLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [academicYear, teachersOnPageKey]);

  const teachersMissingAvailability = useMemo(() => {
    return teachersOnPage.filter((teacher) => !savedTeacherSet.has(teacher));
  }, [teachersOnPage, savedTeacherSet]);

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
        const startMap: Record<string, string> = {};
        for (const row of rows) {
          if (row.preferred_start_time) {
            startMap[row.module_instance_code] = String(
              row.preferred_start_time
            ).slice(0, 5);
          }
        }
        setPreferredStartByCode(startMap);
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

  const startTimeOptions = useMemo(() => buildDayAutoScheduleStartOptions(), []);

  async function savePreferences() {
    const rows = moduleOptions.map((module) => ({
      module_instance_code: module.moduleInstanceCode,
      preferred_start_time:
        preferredStartByCode[module.moduleInstanceCode] || null,
    }));

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
        forceReschedule: false,
      });

      setAutoFailures(result.failures);
      setAutoResult(
        result.skippedAlreadyScheduledCount > 0
          ? `Scheduled: ${result.scheduledCount}; skipped (already scheduled): ${result.skippedAlreadyScheduledCount}; failed: ${result.failedCount}.`
          : `Scheduled: ${result.scheduledCount}; failed: ${result.failedCount}.`
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

        {crossProgrammeInstanceCount > 0 && (
          <div className="mt-3 rounded border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
            {crossProgrammeInstanceCount} cross-programme combined instance(s) on
            this page are managed by Admin only and are hidden from scheduling
            here.
          </div>
        )}

        {!availabilityWarningLoading &&
          teachersMissingAvailability.length > 0 && (
            <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              以下老師尚未在「Teacher Availability」儲存 Not Available 設定，自動排課可能不準確：
              <span className="ml-1 font-medium">
                {teachersMissingAvailability.join("、")}
              </span>
              。請使用頁面頂部按鈕設定後再排課。
            </div>
          )}

        <div className="mt-6">
          <div className="text-sm font-medium text-slate-900">排課偏好</div>
          <div className="mt-1 text-xs text-slate-600">
            Preferred start 預設 Any time（Day/Saturday 會在 08:00–14:30
            內嘗試）。Night 固定 18:30。星期由老師 Availability 決定。
          </div>

          {prefError && (
            <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {prefError}
            </div>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[640px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                    Module instance
                  </th>
                  <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                    Year
                  </th>
                  <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                    Mode
                  </th>
                  <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                    Teacher
                  </th>
                  <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                    Size
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
                  const startValue =
                    preferredStartByCode[m.moduleInstanceCode] ?? "";
                  return (
                    <tr key={m.id}>
                      <td className="border border-slate-200 px-2 py-2">
                        <div className="font-medium">{m.moduleInstanceCode}</div>
                        {m.moduleName ? (
                          <div className="text-xs text-slate-600">
                            {dedupeJoinedModuleName(m.moduleName)}
                          </div>
                        ) : null}
                      </td>
                      <td className="border border-slate-200 px-2 py-2">
                        {m.moduleYear || "—"}
                      </td>
                      <td className="border border-slate-200 px-2 py-2">
                        {m.mode || "—"}
                      </td>
                      <td className="border border-slate-200 px-2 py-2">
                        {m.teacherName || "—"}
                      </td>
                      <td className="border border-slate-200 px-2 py-2">
                        {m.size ?? "—"}
                      </td>
                      <td className="border border-slate-200 px-2 py-2">
                        {isEditable ? (
                          <select
                            className="form-select min-w-[6.5rem]"
                            value={startValue}
                            title={`Preferred start time for ${m.moduleInstanceCode}`}
                            disabled={prefLoading}
                            onChange={(e) => {
                              const next = { ...preferredStartByCode };
                              const value = e.target.value;
                              if (!value) {
                                delete next[m.moduleInstanceCode];
                              } else {
                                next[m.moduleInstanceCode] = value;
                              }
                              setPreferredStartByCode(next);
                            }}
                          >
                            <option value="">Any time</option>
                            {startTimeOptions.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-500">
                            {m.mode === "Night" ? "18:30" : "—"}
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
              disabled={prefLoading || moduleOptions.length === 0}
            >
              Save preferences
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
            allowEditAllGridModules
            open={weeklyOpen}
            onOpenChange={setWeeklyOpen}
            refreshToken={weeklyRefreshToken}
          />
        </div>
      </div>
    </div>
  );
}
