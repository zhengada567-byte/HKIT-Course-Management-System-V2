import { useCallback, useEffect, useMemo, useState } from "react";

import { useAcademicYear } from "../../../../contexts/AcademicYearContext";
import { useAuth } from "../../../../contexts/AuthContext";
import {
  getDefaultQuotaPlanningAcademicYear,
  getQuotaEditDeadlineLabel,
  getNextAcademicYear,
  getPreviousAcademicYear,
} from "../../../../lib/utils";
import {
  adminUnlockProgrammeQuota,
  confirmProgrammeQuota,
  ensureQuotaCopiedForAcademicYear,
  getProgrammeQuotaDetail,
  getQuotaStatusMessage,
  listQuotaProgrammesForUser,
  saveProgrammeQuotaDraft,
  type ProgrammeQuotaListItem,
  type ProgrammeQuotaStreamRow,
  type ProgrammeQuotaSummary,
} from "../../../../services/programmeQuotaService";

function displayStream(value: string) {
  return value === "nil" ? "-" : value;
}

function distributeEvenly(programmeQuota: number, streams: ProgrammeQuotaStreamRow[]) {
  if (streams.length === 0) {
    return streams;
  }

  const base = Math.floor(programmeQuota / streams.length);
  let remainder = programmeQuota - base * streams.length;

  return streams.map((row) => {
    const extra = remainder > 0 ? 1 : 0;

    if (remainder > 0) {
      remainder -= 1;
    }

    return {
      ...row,
      streamQuota: base + extra,
    };
  });
}

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
  const [programmeQuota, setProgrammeQuota] = useState(0);
  const [streams, setStreams] = useState<ProgrammeQuotaStreamRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [adminUnlockUntil, setAdminUnlockUntil] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  const streamTotal = useMemo(
    () => streams.reduce((sum, row) => sum + (row.streamQuota || 0), 0),
    [streams]
  );

  const streamBalance = programmeQuota - streamTotal;
  const canEdit = detail?.editableByProgrammeLeader ?? false;
  const isAdmin = user?.role === "admin";

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
        setProgrammeQuota(result.programmeQuota);
        setStreams(result.streams);
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

          setMessage(
            copyError instanceof Error
              ? `課程列表已載入，但自動複製上年 Quota 失敗：${copyError.message}`
              : "課程列表已載入，但自動複製上年 Quota 失敗。"
          );
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

  async function handleSaveDraft() {
    if (!user || !selectedProgrammeCode) return;

    setSaving(true);
    setMessage("");

    try {
      await saveProgrammeQuotaDraft({
        academicYear,
        programmeCode: selectedProgrammeCode,
        programmeQuota,
        streams,
        user,
      });

      await refreshList();
      await loadDetail(selectedProgrammeCode);
      setMessage("已儲存草稿（尚未確認）。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "儲存失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    if (!user || !selectedProgrammeCode) return;

    setConfirming(true);
    setMessage("");

    try {
      await confirmProgrammeQuota({
        academicYear,
        programmeCode: selectedProgrammeCode,
        programmeQuota,
        streams,
        user,
      });

      await refreshList();
      await loadDetail(selectedProgrammeCode);
      setMessage("已確認 Quota，並已生成各科目 Expected 人數。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "確認失敗。");
    } finally {
      setConfirming(false);
    }
  }

  async function handleAdminUnlock() {
    if (!user || !selectedProgrammeCode || !adminUnlockUntil) return;

    setUnlocking(true);
    setMessage("");

    try {
      await adminUnlockProgrammeQuota({
        academicYear,
        programmeCode: selectedProgrammeCode,
        unlockUntil: new Date(adminUnlockUntil).toISOString(),
        adminUser: user,
      });

      await refreshList();
      await loadDetail(selectedProgrammeCode);
      setMessage("已解鎖 Quota，PL 可重新編輯並確認。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "解鎖失敗。");
    } finally {
      setUnlocking(false);
    }
  }

  const pendingCount = programmeList.filter((row) => row.needsReview).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">学年 Quota</h2>
        <p className="text-sm text-muted-foreground mt-1">
          每学年為制作时间表设定一次预期人数；列出 programmes
          表中的所有课程（共用 PL 账号，不按 programme leader 筛选）。通常于在学期间准备{" "}
          <span className="font-medium text-foreground">
            {defaultPlanningYear}
          </span>{" "}
          学年 Quota。
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          {getQuotaStatusMessage(academicYear)}
        </p>
      </div>

      {pendingCount > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {academicYear} 学年尚有{" "}
          <span className="font-semibold">{pendingCount}</span>{" "}
          个课程未确认 Quota。未确认的课程无法开始制作时间表 Step 1。
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
              disabled={loading || saving || confirming}
            >
              {academicYearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                  {year === defaultPlanningYear ? "（建议）" : ""}
                </option>
              ))}
            </select>
          </div>

          <p className="text-xs text-muted-foreground">
            截止：{getQuotaEditDeadlineLabel(academicYear)}（之后锁定）
          </p>

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
                  {row.isConfirmed ? "已确认" : "待确认"}
                  {!row.editableByProgrammeLeader ? " · 已锁定" : ""}
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
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold">{detail.programmeCode}</h3>
                  <p className="text-sm text-muted-foreground">
                    {detail.programmeName ?? "-"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Leader: {detail.programmeLeader ?? "-"}
                  </p>
                </div>

                <div className="text-sm">
                  {detail.isConfirmed ? (
                    <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-800">
                      已确认
                    </span>
                  ) : (
                    <span className="rounded bg-amber-100 px-2 py-1 text-amber-800">
                      待确认
                    </span>
                  )}
                  {!canEdit && (
                    <span className="ml-2 rounded bg-slate-200 px-2 py-1 text-slate-700">
                      已锁定
                    </span>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Programme Quota
                  </label>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={programmeQuota}
                    disabled={!canEdit}
                    onChange={(event) =>
                      setProgrammeQuota(Math.max(0, Number(event.target.value) || 0))
                    }
                  />
                </div>

                <div className="rounded border bg-slate-50 px-3 py-2 text-sm">
                  <p>
                    Stream 总和：{" "}
                    <span className="font-medium">{streamTotal}</span> /{" "}
                    {programmeQuota}
                  </p>
                  <p
                    className={
                      streamBalance === 0 ? "text-emerald-700" : "text-red-600"
                    }
                  >
                    差额：{streamBalance}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
                  disabled={!canEdit}
                  onClick={() => setStreams(distributeEvenly(programmeQuota, streams))}
                >
                  平均分配到各 Stream
                </button>
              </div>

              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-2 text-left">Stream</th>
                      <th className="p-2 text-left">Stream Quota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {streams.map((row) => (
                      <tr key={row.programmeStream} className="border-t">
                        <td className="p-2">{displayStream(row.programmeStream)}</td>
                        <td className="p-2">
                          <input
                            type="number"
                            min={0}
                            className="w-28 rounded border px-2 py-1"
                            disabled={!canEdit}
                            value={row.streamQuota}
                            onChange={(event) => {
                              const value = Math.max(
                                0,
                                Number(event.target.value) || 0
                              );

                              setStreams((current) =>
                                current.map((item) =>
                                  item.programmeStream === row.programmeStream
                                    ? { ...item, streamQuota: value }
                                    : item
                                )
                              );
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="px-4 py-2 rounded-md border text-sm disabled:opacity-50"
                  disabled={!canEdit || saving || streamBalance !== 0}
                  onClick={() => void handleSaveDraft()}
                >
                  {saving ? "储存中..." : "储存草稿"}
                </button>

                <button
                  type="button"
                  className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
                  disabled={
                    !canEdit || confirming || streamBalance !== 0 || programmeQuota < 0
                  }
                  onClick={() => void handleConfirm()}
                >
                  {confirming ? "确认中..." : "确认本课程 Quota"}
                </button>
              </div>

              {detail.confirmedAt && (
                <p className="text-xs text-muted-foreground">
                  上次确认：{new Date(detail.confirmedAt).toLocaleString()}（
                  {detail.confirmedBy ?? "-"}）
                </p>
              )}

              {isAdmin && (
                <div className="rounded-md border border-dashed p-4 space-y-3">
                  <p className="text-sm font-medium">Admin 解锁</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium">
                        解锁至
                      </label>
                      <input
                        type="datetime-local"
                        className="rounded border px-2 py-1 text-sm"
                        value={adminUnlockUntil}
                        onChange={(event) =>
                          setAdminUnlockUntil(event.target.value)
                        }
                      />
                    </div>
                    <button
                      type="button"
                      className="px-3 py-2 rounded bg-slate-800 text-white text-sm disabled:opacity-50"
                      disabled={unlocking || !adminUnlockUntil}
                      onClick={() => void handleAdminUnlock()}
                    >
                      {unlocking ? "解锁中..." : "解锁"}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    解锁后 PL 可重新编辑；确认前会清除确认状态。
                  </p>
                </div>
              )}
            </>
          )}

          {message && (
            <p
              className={`text-sm ${
                message.includes("失败") || message.includes("必須")
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
