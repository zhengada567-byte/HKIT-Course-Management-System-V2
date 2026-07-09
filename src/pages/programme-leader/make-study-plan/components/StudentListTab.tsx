import { useMemo, useState } from "react";

import { TableViewport } from "../../../../components/tables/TableViewport";
import { getTermIndex } from "../helpers";
import { formatProgrammeYearDisplay } from "../../../../lib/programmeYear";
import type { StudyPlanStudent } from "../types";
import { deleteStudyPlanStudent } from "../../../../services/studyPlanService";
import {
  downloadStudyPlanCsv,
  type StudyPlanExportScope,
} from "../../../../services/studyPlanExportService";

interface Props {
  students: StudyPlanStudent[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onNew: () => void;
  onEdit: (profileId: string) => void;
}

function normalizeStream(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "nil";
}

function displayStream(value: unknown): string {
  const stream = normalizeStream(value);
  return stream === "nil" ? "General" : stream;
}

type StudentSortKey =
  | "studentId"
  | "studentName"
  | "programmeCode"
  | "programmeStream"
  | "intakeYear"
  | "intakeLevel"
  | "studyMode"
  | "intakeTerm"
  | "graduateTerm"
  | "studentStatus";

type SortDirection = "asc" | "desc";

function compareStudents(
  a: StudyPlanStudent,
  b: StudyPlanStudent,
  key: StudentSortKey,
  direction: SortDirection
): number {
  const sign = direction === "asc" ? 1 : -1;

  const text = (left: string | undefined, right: string | undefined) =>
    String(left ?? "").localeCompare(String(right ?? ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });

  let result = 0;

  switch (key) {
    case "studentId":
      result = text(a.studentId, b.studentId);
      break;
    case "studentName":
      result = text(a.studentName, b.studentName);
      break;
    case "programmeCode":
      result = text(a.programmeCode, b.programmeCode);
      break;
    case "programmeStream":
      result = text(
        normalizeStream(a.programmeStream),
        normalizeStream(b.programmeStream)
      );
      break;
    case "intakeYear": {
      const left = Number(a.intakeYear);
      const right = Number(b.intakeYear);
      const leftNum = Number.isFinite(left) ? left : -Infinity;
      const rightNum = Number.isFinite(right) ? right : -Infinity;
      result = leftNum - rightNum || text(a.intakeYear, b.intakeYear);
      break;
    }
    case "intakeLevel":
      result = text(a.intakeLevel, b.intakeLevel);
      break;
    case "studyMode":
      result = text(a.studyMode, b.studyMode);
      break;
    case "intakeTerm":
      result =
        getTermIndex(a.intakeTerm ?? "") - getTermIndex(b.intakeTerm ?? "") ||
        text(a.intakeTerm, b.intakeTerm);
      break;
    case "graduateTerm":
      result =
        getTermIndex(a.graduateTerm ?? "") -
          getTermIndex(b.graduateTerm ?? "") ||
        text(a.graduateTerm, b.graduateTerm);
      break;
    case "studentStatus":
      result = text(a.studentStatus ?? "potential", b.studentStatus ?? "potential");
      break;
  }

  return result * sign;
}

function SortableHeader({
  label,
  sortKey,
  activeSortKey,
  sortDirection,
  onSort,
}: {
  label: string;
  sortKey: StudentSortKey;
  activeSortKey: StudentSortKey;
  sortDirection: SortDirection;
  onSort: (key: StudentSortKey) => void;
}) {
  const isActive = activeSortKey === sortKey;

  return (
    <th className="sticky top-0 z-10 bg-slate-100 p-0 text-left whitespace-nowrap">
      <button
        type="button"
        className="flex w-full items-center gap-1 px-2 py-2 text-left text-sm font-semibold text-slate-900 hover:bg-slate-200/80"
        onClick={() => onSort(sortKey)}
        aria-sort={
          isActive
            ? sortDirection === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
      >
        <span>{label}</span>
        <span
          className={`text-xs ${isActive ? "text-blue-700" : "text-slate-400"}`}
          aria-hidden
        >
          {isActive ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

export default function StudentListTab({
  students,
  loading,
  onRefresh,
  onNew,
  onEdit,
}: Props) {
  const [selectedProgrammeCode, setSelectedProgrammeCode] = useState("");
  const [selectedProgrammeStream, setSelectedProgrammeStream] = useState("");
  const [exportScope, setExportScope] =
    useState<StudyPlanExportScope>("stream");
  const [exportProgrammeType, setExportProgrammeType] = useState("Degree");
  const [exporting, setExporting] = useState(false);
  const [sortKey, setSortKey] = useState<StudentSortKey>("studentId");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  function handleSortColumn(key: StudentSortKey) {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection("asc");
  }

  const programmeCodes = useMemo(() => {
    return Array.from(
      new Set(
        students
          .map((student) => student.programmeCode)
          .filter((code): code is string => Boolean(code))
      )
    ).sort();
  }, [students]);

  const programmeStreams = useMemo(() => {
    if (!selectedProgrammeCode) return [];

    return Array.from(
      new Set(
        students
          .filter((student) => student.programmeCode === selectedProgrammeCode)
          .map((student) => normalizeStream(student.programmeStream))
      )
    ).sort();
  }, [students, selectedProgrammeCode]);

  const filteredStudents = useMemo(() => {
    if (!selectedProgrammeCode) {
      return [];
    }

    return students.filter((student) => {
      if (student.programmeCode !== selectedProgrammeCode) {
        return false;
      }

      if (!selectedProgrammeStream) {
        return true;
      }

      return normalizeStream(student.programmeStream) === selectedProgrammeStream;
    });
  }, [students, selectedProgrammeCode, selectedProgrammeStream]);

  const sortedStudents = useMemo(() => {
    return [...filteredStudents].sort((a, b) =>
      compareStudents(a, b, sortKey, sortDirection)
    );
  }, [filteredStudents, sortKey, sortDirection]);

  async function handleDelete(student: StudyPlanStudent) {
    if (!student.id) return;

    const confirmed = window.confirm(
      `Delete study plan for ${student.studentName}?`
    );

    if (!confirmed) return;

    await deleteStudyPlanStudent(student.id);
    await onRefresh();
  }

  async function handleExportStudent(student: StudyPlanStudent) {
    if (!student.id) return;

    setExporting(true);

    try {
      const result = await downloadStudyPlanCsv({
        scope: "student",
        studentProfileId: student.id,
      });

      alert(`Exported ${result.rowCount} student study plan to ${result.fileName}.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to export study plan.";

      alert(`Export failed:\n\n${message}`);
    } finally {
      setExporting(false);
    }
  }

  async function handleExport() {
    if (exportScope === "stream" && !selectedProgrammeCode) {
      alert("Please select programme code first.");
      return;
    }

    if (exportScope === "programme" && !selectedProgrammeCode) {
      alert("Please select programme code first.");
      return;
    }

    setExporting(true);

    try {
      const effectiveScope =
        exportScope === "stream" && !selectedProgrammeStream
          ? "programme"
          : exportScope;

      const result = await downloadStudyPlanCsv({
        scope: effectiveScope,
        programmeCode: selectedProgrammeCode || undefined,
        programmeStream: selectedProgrammeStream || undefined,
        programmeType:
          exportScope === "programme_type" ? exportProgrammeType : undefined,
      });

      alert(`Exported ${result.rowCount} student study plan(s) to ${result.fileName}.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to export study plan.";

      alert(`Export failed:\n\n${message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex shrink-0 justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold">Student List</h2>
          <p className="text-sm text-muted-foreground">
            Select a programme code to view students. Optionally filter by
            programme stream.
          </p>
        </div>

        <button
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm"
          onClick={onNew}
        >
          Add Student
        </button>
      </div>

      <div className="shrink-0 rounded-md border bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Programme Code
            </label>

            <select
              value={selectedProgrammeCode}
              onChange={(event) => {
                setSelectedProgrammeCode(event.target.value);
                setSelectedProgrammeStream("");
              }}
              disabled={loading}
              className="w-full rounded border px-3 py-2 text-sm"
            >
              <option value="">
                {loading ? "Loading..." : "Select programme"}
              </option>

              {programmeCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Programme Stream
            </label>

            <select
              value={selectedProgrammeStream}
              onChange={(event) =>
                setSelectedProgrammeStream(event.target.value)
              }
              disabled={loading || !selectedProgrammeCode}
              className="w-full rounded border px-3 py-2 text-sm"
            >
              <option value="">
                {!selectedProgrammeCode
                  ? "Select programme first"
                  : "All streams"}
              </option>

              {programmeStreams.map((stream) => (
                <option key={stream} value={stream}>
                  {displayStream(stream)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 text-sm text-muted-foreground">
          {!selectedProgrammeCode && "Please select a programme code first."}

          {selectedProgrammeCode && (
            <>
              Showing{" "}
              <span className="font-medium text-foreground">
                {filteredStudents.length}
              </span>{" "}
              student(s) for{" "}
              <span className="font-medium text-foreground">
                {selectedProgrammeCode}
              </span>
              {selectedProgrammeStream ? (
                <>
                  {" "}
                  /{" "}
                  <span className="font-medium text-foreground">
                    {displayStream(selectedProgrammeStream)}
                  </span>
                </>
              ) : (
                " (all streams)"
              )}
              .
            </>
          )}
        </div>
      </div>

      <details className="rounded-md border border-yellow-400 bg-yellow-100 p-4">
        <summary className="cursor-pointer rounded bg-yellow-200 px-2 py-1 text-sm font-semibold text-yellow-950">
          Export Study Plan (CSV)
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          One row per student. HD programme modules align to the study-plan
          catalogue order. Degree exports show bridging modules first (not
          aligned), then aligned degree modules; unrecognized module codes appear
          at the end. Multiple programmes export as one .xlsx file with a sheet
          per programme.
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Export Scope</label>
            <select
              value={exportScope}
              onChange={(event) =>
                setExportScope(event.target.value as StudyPlanExportScope)
              }
              disabled={exporting}
              className="w-full rounded border px-3 py-2 text-sm"
            >
              <option value="stream">Current programme + stream</option>
              <option value="programme">Current programme code</option>
              <option value="programme_type">Programme type</option>
              <option value="all">All students</option>
            </select>
          </div>

          {exportScope === "programme_type" && (
            <div>
              <label className="mb-1 block text-sm font-medium">
                Programme Type
              </label>
              <select
                value={exportProgrammeType}
                onChange={(event) => setExportProgrammeType(event.target.value)}
                disabled={exporting}
                className="w-full rounded border px-3 py-2 text-sm"
              >
                <option value="Degree">Degree</option>
                <option value="HD">HD</option>
              </select>
            </div>
          )}

          <div className="flex items-end">
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm disabled:opacity-50"
              onClick={handleExport}
              disabled={exporting || loading}
            >
              {exporting ? "Exporting..." : "Export CSV"}
            </button>
          </div>
        </div>
      </details>

      <TableViewport size="studyPlanStudents" className="min-h-[20rem] w-full">
        <table className="data-table min-w-max text-sm">
          <thead>
            <tr>
              <SortableHeader
                label="Student ID"
                sortKey="studentId"
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSortColumn}
              />
              <SortableHeader
                label="Student Name"
                sortKey="studentName"
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSortColumn}
              />
              <SortableHeader
                label="Programme"
                sortKey="programmeCode"
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSortColumn}
              />
              <SortableHeader
                label="Stream"
                sortKey="programmeStream"
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSortColumn}
              />
              <SortableHeader
                label="Intake Year"
                sortKey="intakeYear"
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSortColumn}
              />
              <SortableHeader
                label="Intake Level"
                sortKey="intakeLevel"
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSortColumn}
              />
              <SortableHeader
                label="Mode"
                sortKey="studyMode"
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSortColumn}
              />
              <SortableHeader
                label="Intake Term"
                sortKey="intakeTerm"
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSortColumn}
              />
              <SortableHeader
                label="Graduate Term"
                sortKey="graduateTerm"
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSortColumn}
              />
              <SortableHeader
                label="Status"
                sortKey="studentStatus"
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSortColumn}
              />
              <th className="sticky top-0 z-10 bg-slate-100 p-2 text-left whitespace-nowrap">
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td className="p-3" colSpan={11}>
                  Loading...
                </td>
              </tr>
            )}

            {!loading && !selectedProgrammeCode && (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={11}>
                  Please select a programme code to view students.
                </td>
              </tr>
            )}

            {!loading &&
              selectedProgrammeCode &&
              filteredStudents.length === 0 && (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={11}>
                    No students found for this programme and stream.
                  </td>
                </tr>
              )}

            {!loading &&
              selectedProgrammeCode &&
              sortedStudents.map((student) => (
                <tr key={student.id ?? student.studentId} className="border-t">
                  <td className="whitespace-nowrap p-2">{student.studentId}</td>
                  <td className="whitespace-nowrap p-2">{student.studentName}</td>
                  <td className="whitespace-nowrap p-2">{student.programmeCode}</td>
                  <td className="whitespace-nowrap p-2">
                    {displayStream(student.programmeStream)}
                  </td>
                  <td className="whitespace-nowrap p-2">{student.intakeYear || "-"}</td>
                  <td className="whitespace-nowrap p-2">
                    {formatProgrammeYearDisplay(student.intakeLevel)}
                  </td>
                  <td className="whitespace-nowrap p-2">{student.studyMode}</td>
                  <td className="whitespace-nowrap p-2">{student.intakeTerm || "-"}</td>
                  <td className="whitespace-nowrap p-2">{student.graduateTerm || "-"}</td>
                  <td className="whitespace-nowrap p-2">
                    <span className="rounded-full bg-muted px-2 py-1 text-xs">
                      {student.studentStatus ?? "potential"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap p-2 space-x-2">
                    <button
                      className="px-3 py-1 rounded-md bg-muted text-xs"
                      onClick={() => student.id && onEdit(student.id)}
                      disabled={!student.id}
                    >
                      Edit
                    </button>

                    <button
                      className="px-3 py-1 rounded-md bg-emerald-100 text-emerald-800 text-xs disabled:opacity-50"
                      onClick={() => handleExportStudent(student)}
                      disabled={!student.id || exporting}
                    >
                      Export
                    </button>

                    <button
                      className="px-3 py-1 rounded-md bg-red-100 text-red-700 text-xs"
                      onClick={() => handleDelete(student)}
                      disabled={!student.id}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </TableViewport>
    </div>
  );
}
