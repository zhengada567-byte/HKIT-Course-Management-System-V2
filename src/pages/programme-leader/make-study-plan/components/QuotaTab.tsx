import { useCallback, useEffect, useMemo, useState } from "react";

import { useAcademicYear } from "../../../../contexts/AcademicYearContext";
import { useAuth } from "../../../../contexts/AuthContext";
import {
  getDefaultQuotaPlanningAcademicYear,
  getNextAcademicYear,
  getPreviousAcademicYear,
} from "../../../../lib/utils";
import {
  ensureQuotaCopiedForAcademicYear,
  getProgrammeQuotaDetail,
  getQuotaStatusMessage,
  listQuotaProgrammesForUser,
  saveProgrammeQuota,
  type ProgrammeQuotaListItem,
  type ProgrammeQuotaSummary,
} from "../../../../services/programmeQuotaService";

export default function QuotaTab() {
  const { user } = useAuth();
  const { academicYear: currentAcademicYear } = useAcademicYear();

  const defaultPlanningYear = useMemo(
    () => getDefaultQuotaPlanningAcademicYear(currentAcademicYear),
    [currentAcademicYear]
  );

  const academicYearOptions = useMemo(() => {
    return [
      currentAcademicYear,
      getNextAcademicYear(currentAcademicYear),
      getPreviousAcademicYear(currentAcademicYear),
    ].filter((value, index, array) => array.indexOf(value) === index);
  }, [currentAcademicYear]);

  const [academicYear, setAcademicYear] = useState(defaultPlanningYear);
  const [programmeList, setProgrammeList] = useState<ProgrammeQuotaListItem[]>(
    []
  );
  const [selectedProgrammeCode, setSelectedProgrammeCode] = useState("");
  const [detail, setDetail] = useState<ProgrammeQuotaSummary | null>(null);
  const [ftQuota, setFtQuota] = useState(0);
  const [ptQuota, setPtQuota] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const refreshList = useCallback(async () => {
    if (!user) return;

    const rows = await listQuotaProgrammesForUser(user, academicYear);
    setProgrammeList(rows);
  }, [academicYear, user]);

  const loadDetail = useCallback(
    async (programmeCode: string) => {
      if (!user || !programmeCode) {
        setDetail(null);
        return;
      }

      setLoading(true);
      setMessage("");

      try {
        const result = await getProgrammeQuotaDetail(
          academicYear,
          programmeCode,
          user
        );

        setDetail(result);
        setFtQuota(result.ftQuota);
        setPtQuota(result.ptQuota);
      } catch (error) {
        setDetail(null);

        setMessage(
          error instanceof Error ? error.message : "載入 Quota 失敗。"
        );
      } finally {
        setLoading(false);
      }
    },
    [academicYear, user]
  );

  useEffect(() => {
    setAcademicYear(defaultPlanningYear);
  }, [defaultPlanningYear]);

  useEffect(() => {
    if (!user) return;

    void (async () => {
      setLoading(true);

      try {
        await refreshList();

        try {
          await ensureQuotaCopiedForAcademicYear(academicYear, user);
          await refreshList();
        } catch (copyError) {
          console.warn("[QuotaTab] Copy quota from previous year failed:", copyError);
        }
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "載入 Quota 清單失敗。"
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [academicYear, refreshList, user]);

  useEffect(() => {
    if (!selectedProgrammeCode) {
      setDetail(null);
      return;
    }

    void loadDetail(selectedProgrammeCode);
  }, [loadDetail, selectedProgrammeCode]);

  async function handleSave() {
    if (!user || !selectedProgrammeCode) return;

    setSaving(true);
    setMessage("");

    try {
      await saveProgrammeQuota({
        academicYear,
        programmeCode: selectedProgrammeCode,
        ftQuota,
        ptQuota,
        user,
      });

      await refreshList();
      await loadDetail(selectedProgrammeCode);
      setMessage("已儲存 Quota。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "儲存失敗。");
    } finally {
      setSaving(false);
    }
  }

  const overQuotaCount = programmeList.filter(
    (row) => row.isOverFtQuota || row.isOverPtQuota
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">学年 Quota</h2>
        <p className="text-sm text-muted-foreground mt-1">
          按课程设定 FT / PT 收生上限，并与 Study Plan 该学年实际人数比对（仅供参考）。
          与制作时间表无关；模块 Expected 默认来自 Study Plan Actual，不由 Quota 写入。
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          {getQuotaStatusMessage(academicYear)}
        </p>
      </div>

      {overQuotaCount > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {academicYear} 学年有{" "}
          <span className="font-semibold">{overQuotaCount}</span>{" "}
          个课程的 FT 或 PT 实际人数超过 Quota，请核对收生安排。
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="rounded-md border bg-white p-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Academic Year</label>
            <select
              className="w-full rounded border px-3 py-2 text-sm"
              value={academicYear}
              onChange={(event) => {
                setAcademicYear(event.target.value);
                setSelectedProgrammeCode("");
                setDetail(null);
              }}
              disabled={loading || saving}
            >
              {academicYearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                  {year === defaultPlanningYear ? "（建议）" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {programmeList.map((row) => (
              <button
                key={row.programmeCode}
                type="button"
                className={`w-full rounded border px-3 py-2 text-left text-sm transition ${
                  selectedProgrammeCode === row.programmeCode
                    ? "border-primary bg-primary/5"
                    : "hover:bg-slate-50"
                }`}
                onClick={() => setSelectedProgrammeCode(row.programmeCode)}
              >
                <div className="font-medium">{row.programmeCode}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  FT {row.actualFt}/{row.ftQuota || "—"} · PT {row.actualPt}/
                  {row.ptQuota || "—"}
                  {(row.isOverFtQuota || row.isOverPtQuota) && (
                    <span className="text-amber-700"> · 超收</span>
                  )}
                </div>
              </button>
            ))}

            {programmeList.length === 0 && !loading && (
              <p className="text-sm text-muted-foreground">
                programmes 表中沒有課程記錄。
              </p>
            )}
          </div>
        </div>

        <div className="rounded-md border bg-white p-4 space-y-4">
          {!selectedProgrammeCode && (
            <p className="text-sm text-muted-foreground">
              请从左侧选择课程以编辑 Quota。
            </p>
          )}

          {selectedProgrammeCode && loading && (
            <p className="text-sm text-muted-foreground">载入中...</p>
          )}

          {selectedProgrammeCode && detail && !loading && (
            <>
              <div>
                <h3 className="text-base font-semibold">{detail.programmeCode}</h3>
                <p className="text-sm text-muted-foreground">
                  {detail.programmeName ?? "-"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Leader: {detail.programmeLeader ?? "-"}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">FT Quota</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={ftQuota}
                    onChange={(event) =>
                      setFtQuota(Math.max(0, Number(event.target.value) || 0))
                    }
                  />
                  <p
                    className={`text-xs mt-1 ${
                      detail.isOverFtQuota ? "text-red-600" : "text-muted-foreground"
                    }`}
                  >
                    Study Plan 实际 FT：{detail.actualFt}
                    {detail.isOverFtQuota ? "（超过 Quota）" : ""}
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">PT Quota</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={ptQuota}
                    onChange={(event) =>
                      setPtQuota(Math.max(0, Number(event.target.value) || 0))
                    }
                  />
                  <p
                    className={`text-xs mt-1 ${
                      detail.isOverPtQuota ? "text-red-600" : "text-muted-foreground"
                    }`}
                  >
                    Study Plan 实际 PT：{detail.actualPt}
                    {detail.isOverPtQuota ? "（超过 Quota）" : ""}
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {saving ? "储存中..." : "储存 Quota"}
              </button>

              {detail.savedAt && (
                <p className="text-xs text-muted-foreground">
                  上次储存：{new Date(detail.savedAt).toLocaleString()}
                  {detail.savedBy ? `（${detail.savedBy}）` : ""}
                </p>
              )}
            </>
          )}

          {message && (
            <p
              className={`text-sm ${
                message.includes("失败") || message.includes("失敗")
                  ? "text-red-600"
                  : "text-muted-foreground"
              }`}
              role="alert"
            >
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
