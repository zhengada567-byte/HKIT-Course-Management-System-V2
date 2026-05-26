import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  downloadGraduatingStudentsCsv,
  searchGraduatingStudents,
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
  const [graduateStudyTerm, setGraduateStudyTerm] = useState("");
  const [graduateProgrammeCode, setGraduateProgrammeCode] = useState("");
  const [graduateRows, setGraduateRows] = useState<GraduatingStudentSearchRow[]>(
    []
  );
  const [graduateSearching, setGraduateSearching] = useState(false);
  const [graduateExporting, setGraduateExporting] = useState(false);
  const [graduateMessage, setGraduateMessage] = useState("");

  const sortedProgrammeCodes = useMemo(() => {
    return [...programmeCodes].sort((a, b) => a.localeCompare(b));
  }, [programmeCodes]);

  useEffect(() => {
    void listModuleEnrollmentStudyTerms()
      .then(setStudyTerms)
      .catch(() => setStudyTerms([]));
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

    try {
      const rows = await searchGraduatingStudents({
        studyTerm: graduateStudyTerm,
        programmeCode: graduateProgrammeCode,
      });

      setGraduateRows(rows);

      if (rows.length === 0) {
        setGraduateMessage("沒有符合條件的畢業生。");
      }
    } catch (error) {
      setGraduateRows([]);

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

  const idBusy = loading || idSearching;
  const graduateBusy = loading || graduateSearching || graduateExporting;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">搜寻</h2>
        <p className="text-sm text-muted-foreground">
          按學號或畢業學期搜尋學生，以便快速查閱及更新學習計劃。
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

        {graduateRows.length > 0 && (
          <p className="text-sm text-muted-foreground">
            共{" "}
            <span className="font-medium text-foreground">
              {graduateRows.length}
            </span>{" "}
            位畢業生（{graduateProgrammeCode} · {graduateStudyTerm}）
          </p>
        )}

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

        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
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

              {!graduateSearching && graduateRows.length === 0 && (
                <tr>
                  <td className="p-3" colSpan={6}>
                    請選擇條件後按搜寻。
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
          </table>
        </div>
      </div>
    </div>
  );
}
