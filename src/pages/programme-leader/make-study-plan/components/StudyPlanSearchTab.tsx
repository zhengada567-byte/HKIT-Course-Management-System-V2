import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import {
  downloadBridgingCompleteStudentsCsv,
  downloadGraduatingStudentsCsv,
  listProgrammeCodesByProgrammeType,
  searchBridgingCompleteStudents,
  searchGraduatingStudents,
  type BridgingCompleteStudentSearchRow,
  type GraduatingStudentSearchRow,
} from "../../../../services/studyPlanService";
import { listModuleEnrollmentStudyTerms } from "../../../../services/studyPlanReportService";

interface Props {
  loading: boolean;
  programmeCodes: string[];
  onSearchByStudentId: (studentId: string) => Promise<void>;
  onOpenStudent: (profileId: string) => Promise<void>;
}

function displayStream(value: string): string {
  return value === "nil" ? "-" : value;
}

interface CollapsibleSearchResultsProps {
  rowCount: number;
  summary: ReactNode;
  listExpanded: boolean;
  onToggleList: () => void;
  children: ReactNode;
}

function CollapsibleSearchResults({
  rowCount,
  summary,
  listExpanded,
  onToggleList,
  children,
}: CollapsibleSearchResultsProps) {
  const showToggle = rowCount > 0;

  return (
    <div className="space-y-2">
      {showToggle && (
        <div className="flex flex-wrap items-center gap-2">
          {rowCount > 0 && (
            <p className="text-sm text-muted-foreground">{summary}</p>
          )}

          {showToggle && (
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-lg font-medium leading-none text-slate-700 hover:bg-slate-50"
              onClick={onToggleList}
              aria-expanded={listExpanded}
              aria-label={listExpanded ? "收起學生名單" : "展開學生名單"}
              title={listExpanded ? "收起學生名單" : "展開學生名單"}
            >
              {listExpanded ? "−" : "+"}
            </button>
          )}
        </div>
      )}

      {listExpanded && (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            {children}
          </table>
        </div>
      )}

      {!listExpanded && rowCount > 0 && (
        <p className="text-sm text-muted-foreground">學生名單已收起。</p>
      )}
    </div>
  );
}

export default function StudyPlanSearchTab({
  loading,
  programmeCodes,
  onSearchByStudentId,
  onOpenStudent,
}: Props) {
  const [studentId, setStudentId] = useState("");
  const [idSearching, setIdSearching] = useState(false);
  const [idMessage, setIdMessage] = useState("");

  const [studyTerms, setStudyTerms] = useState<string[]>([]);
  const [degreeProgrammeCodes, setDegreeProgrammeCodes] = useState<string[]>([]);

  const [graduateStudyTerm, setGraduateStudyTerm] = useState("");
  const [graduateProgrammeCode, setGraduateProgrammeCode] = useState("");
  const [graduateRows, setGraduateRows] = useState<GraduatingStudentSearchRow[]>(
    []
  );
  const [graduateHasSearched, setGraduateHasSearched] = useState(false);
  const [graduateListExpanded, setGraduateListExpanded] = useState(true);
  const [graduateSearching, setGraduateSearching] = useState(false);
  const [graduateExporting, setGraduateExporting] = useState(false);
  const [graduateMessage, setGraduateMessage] = useState("");

  const [bridgingStudyTerm, setBridgingStudyTerm] = useState("");
  const [bridgingProgrammeCode, setBridgingProgrammeCode] = useState("");
  const [bridgingRows, setBridgingRows] = useState<
    BridgingCompleteStudentSearchRow[]
  >([]);
  const [bridgingHasSearched, setBridgingHasSearched] = useState(false);
  const [bridgingListExpanded, setBridgingListExpanded] = useState(true);
  const [bridgingSearching, setBridgingSearching] = useState(false);
  const [bridgingExporting, setBridgingExporting] = useState(false);
  const [bridgingMessage, setBridgingMessage] = useState("");

  const sortedProgrammeCodes = useMemo(() => {
    return [...programmeCodes].sort((a, b) => a.localeCompare(b));
  }, [programmeCodes]);

  const sortedDegreeProgrammeCodes = useMemo(() => {
    const degreeSet = new Set(
      degreeProgrammeCodes.map((code) => code.trim().toUpperCase())
    );

    return programmeCodes
      .filter((code) => degreeSet.has(code.trim().toUpperCase()))
      .sort((a, b) => a.localeCompare(b));
  }, [programmeCodes, degreeProgrammeCodes]);

  useEffect(() => {
    void listModuleEnrollmentStudyTerms()
      .then(setStudyTerms)
      .catch(() => setStudyTerms([]));

    void listProgrammeCodesByProgrammeType("degree")
      .then(setDegreeProgrammeCodes)
      .catch(() => setDegreeProgrammeCodes([]));
  }, []);

  async function handleStudentIdSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmedId = studentId.trim();

    if (!trimmedId) {
      setIdMessage("請輸入學號。");
      return;
    }

    setIdSearching(true);
    setIdMessage("");

    try {
      await onSearchByStudentId(trimmedId);
    } catch (error) {
      const text =
        error instanceof Error
          ? error.message
          : "搜尋失敗，請稍後再試。";

      setIdMessage(text);
    } finally {
      setIdSearching(false);
    }
  }

  async function handleGraduateSearch() {
    if (!graduateStudyTerm || !graduateProgrammeCode) {
      setGraduateMessage("請選擇 Study Term 及 Programme Code。");
      return;
    }

    setGraduateSearching(true);
    setGraduateMessage("");
    setGraduateListExpanded(true);

    try {
      const rows = await searchGraduatingStudents({
        studyTerm: graduateStudyTerm,
        programmeCode: graduateProgrammeCode,
      });

      setGraduateRows(rows);
      setGraduateHasSearched(true);

      if (rows.length === 0) {
        setGraduateMessage("沒有符合條件的畢業生。");
      }
    } catch (error) {
      setGraduateRows([]);
      setGraduateHasSearched(true);

      const text =
        error instanceof Error
          ? error.message
          : "畢業生搜尋失敗，請稍後再試。";

      setGraduateMessage(text);
    } finally {
      setGraduateSearching(false);
    }
  }

  async function handleGraduateExport() {
    if (!graduateStudyTerm || !graduateProgrammeCode) {
      setGraduateMessage("請選擇 Study Term 及 Programme Code。");
      return;
    }

    setGraduateExporting(true);
    setGraduateMessage("");

    try {
      const result = await downloadGraduatingStudentsCsv({
        studyTerm: graduateStudyTerm,
        programmeCode: graduateProgrammeCode,
      });

      alert(`已匯出 ${result.rowCount} 位學生至 ${result.fileName}。`);
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "匯出失敗，請稍後再試。";

      setGraduateMessage(text);
    } finally {
      setGraduateExporting(false);
    }
  }

  async function handleBridgingSearch() {
    if (!bridgingStudyTerm || !bridgingProgrammeCode) {
      setBridgingMessage("請選擇 Study Term 及 Degree Programme Code。");
      return;
    }

    setBridgingSearching(true);
    setBridgingMessage("");
    setBridgingListExpanded(true);

    try {
      const rows = await searchBridgingCompleteStudents({
        studyTerm: bridgingStudyTerm,
        programmeCode: bridgingProgrammeCode,
      });

      setBridgingRows(rows);
      setBridgingHasSearched(true);

      if (rows.length === 0) {
        setBridgingMessage("沒有符合條件的學生。");
      }
    } catch (error) {
      setBridgingRows([]);
      setBridgingHasSearched(true);

      const text =
        error instanceof Error
          ? error.message
          : "Bridging 完成搜尋失敗，請稍後再試。";

      setBridgingMessage(text);
    } finally {
      setBridgingSearching(false);
    }
  }

  async function handleBridgingExport() {
    if (!bridgingStudyTerm || !bridgingProgrammeCode) {
      setBridgingMessage("請選擇 Study Term 及 Degree Programme Code。");
      return;
    }

    setBridgingExporting(true);
    setBridgingMessage("");

    try {
      const result = await downloadBridgingCompleteStudentsCsv({
        studyTerm: bridgingStudyTerm,
        programmeCode: bridgingProgrammeCode,
      });

      alert(`已匯出 ${result.rowCount} 位學生至 ${result.fileName}。`);
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "匯出失敗，請稍後再試。";

      setBridgingMessage(text);
    } finally {
      setBridgingExporting(false);
    }
  }

  async function handleOpenGraduateStudent(profileId: string) {
    setGraduateMessage("");

    try {
      await onOpenStudent(profileId);
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "無法開啟學生學習計劃。";

      setGraduateMessage(text);
    }
  }

  async function handleOpenBridgingStudent(profileId: string) {
    setBridgingMessage("");

    try {
      await onOpenStudent(profileId);
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "無法開啟學生學習計劃。";

      setBridgingMessage(text);
    }
  }

  const idBusy = loading || idSearching;
  const graduateBusy = loading || graduateSearching || graduateExporting;
  const bridgingBusy = loading || bridgingSearching || bridgingExporting;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">搜寻</h2>
        <p className="text-sm text-muted-foreground">
          按學號、畢業學期或 Bridging 完成學期搜尋學生，以便快速查閱及更新學習計劃。
        </p>
      </div>

      <div className="rounded-md border bg-white p-4 space-y-4">
        <p className="text-sm font-medium text-slate-700">学号搜寻</p>

        <form
          onSubmit={handleStudentIdSubmit}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1 min-w-[200px]">
            <label
              htmlFor="study-plan-search-student-id"
              className="mb-1 block text-sm font-medium"
            >
              學號 Student ID
            </label>
            <input
              id="study-plan-search-student-id"
              className="w-full rounded border px-3 py-2 text-sm"
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
              placeholder="輸入完整學號"
              disabled={idBusy}
              autoComplete="off"
            />
          </div>

          <button
            type="submit"
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            disabled={idBusy}
          >
            {idSearching ? "搜寻中..." : "搜寻"}
          </button>
        </form>

        {idMessage && (
          <p className="text-sm text-red-600" role="alert">
            {idMessage}
          </p>
        )}
      </div>

      <div className="rounded-md border bg-white p-4 space-y-4">
        <div>
          <p className="text-sm font-medium text-slate-700">毕业生搜寻</p>
          <p className="text-xs text-muted-foreground mt-1">
            即時從學習計劃科目重算最後修讀學期（programme、planned）；若最大
            study term 等於所選學期，則列入畢業生名單。
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label
              htmlFor="graduate-search-study-term"
              className="mb-1 block text-sm font-medium"
            >
              Study Term
            </label>
            <select
              id="graduate-search-study-term"
              className="w-full rounded border px-3 py-2 text-sm"
              value={graduateStudyTerm}
              onChange={(event) => setGraduateStudyTerm(event.target.value)}
              disabled={graduateBusy}
            >
              <option value="">Select study term</option>
              {studyTerms.map((term) => (
                <option key={term} value={term}>
                  {term}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="graduate-search-programme-code"
              className="mb-1 block text-sm font-medium"
            >
              Programme Code
            </label>
            <select
              id="graduate-search-programme-code"
              className="w-full rounded border px-3 py-2 text-sm"
              value={graduateProgrammeCode}
              onChange={(event) =>
                setGraduateProgrammeCode(event.target.value)
              }
              disabled={graduateBusy}
            >
              <option value="">Select programme</option>
              {sortedProgrammeCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
              onClick={() => void handleGraduateSearch()}
              disabled={graduateBusy}
            >
              {graduateSearching ? "搜寻中..." : "搜寻"}
            </button>

            <button
              type="button"
              className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm disabled:opacity-50"
              onClick={() => void handleGraduateExport()}
              disabled={graduateBusy}
            >
              {graduateExporting ? "匯出中..." : "匯出 CSV"}
            </button>
          </div>
        </div>

        {graduateMessage && (
          <p
            className={`text-sm ${
              graduateRows.length > 0 ? "text-muted-foreground" : "text-red-600"
            }`}
            role="alert"
          >
            {graduateMessage}
          </p>
        )}

        <CollapsibleSearchResults
          rowCount={graduateRows.length}
          summary={
            <>
              共{" "}
              <span className="font-medium text-foreground">
                {graduateRows.length}
              </span>{" "}
              位畢業生（{graduateProgrammeCode} · {graduateStudyTerm}）
            </>
          }
          listExpanded={graduateListExpanded}
          onToggleList={() => setGraduateListExpanded((value) => !value)}
        >
          <thead className="bg-muted">
            <tr>
              <th className="p-2 text-left">Stream</th>
              <th className="p-2 text-left">Student ID</th>
              <th className="p-2 text-left">Student Name</th>
              <th className="p-2 text-left">Study Mode</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Graduate Term</th>
            </tr>
          </thead>

          <tbody>
            {graduateSearching && (
              <tr>
                <td className="p-3" colSpan={6}>
                  Loading...
                </td>
              </tr>
            )}

            {!graduateSearching &&
              !graduateHasSearched &&
              graduateRows.length === 0 && (
                <tr>
                  <td className="p-3" colSpan={6}>
                    請選擇條件後按搜寻。
                  </td>
                </tr>
              )}

            {!graduateSearching &&
              graduateHasSearched &&
              graduateRows.length === 0 && (
                <tr>
                  <td className="p-3" colSpan={6}>
                    沒有符合條件的畢業生。
                  </td>
                </tr>
              )}

            {!graduateSearching &&
              graduateRows.map((row) => (
                <tr key={row.profileId} className="border-t">
                  <td className="p-2">{displayStream(row.programmeStream)}</td>
                  <td className="p-2">
                    <button
                      type="button"
                      className="font-medium text-blue-700 hover:underline"
                      onClick={() =>
                        void handleOpenGraduateStudent(row.profileId)
                      }
                    >
                      {row.studentId}
                    </button>
                  </td>
                  <td className="p-2">{row.studentName}</td>
                  <td className="p-2">{row.studyMode}</td>
                  <td className="p-2">{row.studentStatus ?? "-"}</td>
                  <td className="p-2">{row.calculatedGraduateTerm}</td>
                </tr>
              ))}
          </tbody>
        </CollapsibleSearchResults>
      </div>

      <div className="rounded-md border bg-white p-4 space-y-4">
        <div>
          <p className="text-sm font-medium text-slate-700">
            Bridging 完成搜寻（Degree）
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            即時從學習計劃科目重算 bridging（planned）的最後修讀學期；若等於所選學期，表示該生最後一科
            bridging 在該學期完成。
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label
              htmlFor="bridging-search-study-term"
              className="mb-1 block text-sm font-medium"
            >
              Study Term
            </label>
            <select
              id="bridging-search-study-term"
              className="w-full rounded border px-3 py-2 text-sm"
              value={bridgingStudyTerm}
              onChange={(event) => setBridgingStudyTerm(event.target.value)}
              disabled={bridgingBusy}
            >
              <option value="">Select study term</option>
              {studyTerms.map((term) => (
                <option key={term} value={term}>
                  {term}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="bridging-search-programme-code"
              className="mb-1 block text-sm font-medium"
            >
              Degree Programme Code
            </label>
            <select
              id="bridging-search-programme-code"
              className="w-full rounded border px-3 py-2 text-sm"
              value={bridgingProgrammeCode}
              onChange={(event) =>
                setBridgingProgrammeCode(event.target.value)
              }
              disabled={bridgingBusy}
            >
              <option value="">Select degree programme</option>
              {sortedDegreeProgrammeCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
              onClick={() => void handleBridgingSearch()}
              disabled={bridgingBusy}
            >
              {bridgingSearching ? "搜寻中..." : "搜寻"}
            </button>

            <button
              type="button"
              className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm disabled:opacity-50"
              onClick={() => void handleBridgingExport()}
              disabled={bridgingBusy}
            >
              {bridgingExporting ? "匯出中..." : "匯出 CSV"}
            </button>
          </div>
        </div>

        {sortedDegreeProgrammeCodes.length === 0 && (
          <p className="text-xs text-amber-700">
            目前學習計劃中沒有 Degree 課程的學生記錄，無法選擇 Degree Programme。
          </p>
        )}

        {bridgingMessage && (
          <p
            className={`text-sm ${
              bridgingRows.length > 0 ? "text-muted-foreground" : "text-red-600"
            }`}
            role="alert"
          >
            {bridgingMessage}
          </p>
        )}

        <CollapsibleSearchResults
          rowCount={bridgingRows.length}
          summary={
            <>
              共{" "}
              <span className="font-medium text-foreground">
                {bridgingRows.length}
              </span>{" "}
              位學生（{bridgingProgrammeCode} · {bridgingStudyTerm}）
            </>
          }
          listExpanded={bridgingListExpanded}
          onToggleList={() => setBridgingListExpanded((value) => !value)}
        >
          <thead className="bg-muted">
            <tr>
              <th className="p-2 text-left">Stream</th>
              <th className="p-2 text-left">Student ID</th>
              <th className="p-2 text-left">Student Name</th>
              <th className="p-2 text-left">Study Mode</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Bridging Complete Term</th>
            </tr>
          </thead>

          <tbody>
            {bridgingSearching && (
              <tr>
                <td className="p-3" colSpan={6}>
                  Loading...
                </td>
              </tr>
            )}

            {!bridgingSearching &&
              !bridgingHasSearched &&
              bridgingRows.length === 0 && (
                <tr>
                  <td className="p-3" colSpan={6}>
                    請選擇條件後按搜寻。
                  </td>
                </tr>
              )}

            {!bridgingSearching &&
              bridgingHasSearched &&
              bridgingRows.length === 0 && (
                <tr>
                  <td className="p-3" colSpan={6}>
                    沒有符合條件的學生。
                  </td>
                </tr>
              )}

            {!bridgingSearching &&
              bridgingRows.map((row) => (
                <tr key={row.profileId} className="border-t">
                  <td className="p-2">{displayStream(row.programmeStream)}</td>
                  <td className="p-2">
                    <button
                      type="button"
                      className="font-medium text-blue-700 hover:underline"
                      onClick={() =>
                        void handleOpenBridgingStudent(row.profileId)
                      }
                    >
                      {row.studentId}
                    </button>
                  </td>
                  <td className="p-2">{row.studentName}</td>
                  <td className="p-2">{row.studyMode}</td>
                  <td className="p-2">{row.studentStatus ?? "-"}</td>
                  <td className="p-2">{row.calculatedBridgingCompleteTerm}</td>
                </tr>
              ))}
          </tbody>
        </CollapsibleSearchResults>
      </div>
    </div>
  );
}
