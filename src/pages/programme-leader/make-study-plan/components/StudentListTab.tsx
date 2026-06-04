import { useMemo, useState } from "react";

import { TableViewport } from "../../../../components/tables/TableViewport";
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
    if (!selectedProgrammeCode || !selectedProgrammeStream) {
      return [];
    }

    return students.filter((student) => {
      return (
        student.programmeCode === selectedProgrammeCode &&
        normalizeStream(student.programmeStream) === selectedProgrammeStream
      );
    });
  }, [students, selectedProgrammeCode, selectedProgrammeStream]);

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
    if (exportScope === "stream") {
      if (!selectedProgrammeCode || !selectedProgrammeStream) {
        alert("Please select programme code and stream first.");
        return;
      }
    }

    if (exportScope === "programme" && !selectedProgrammeCode) {
      alert("Please select programme code first.");
      return;
    }

    setExporting(true);

    try {
      const result = await downloadStudyPlanCsv({
        scope: exportScope,
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
            Select a programme code and programme stream to view matching
            student study plans.
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
                  : "Select stream"}
              </option>

              {programmeStreams.map((stream) => (
                <option key={stream} value={stream}>
                  {stream}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 text-sm text-muted-foreground">
          {!selectedProgrammeCode && "Please select a programme code first."}

          {selectedProgrammeCode &&
            !selectedProgrammeStream &&
            "Please select a programme stream."}

          {selectedProgrammeCode && selectedProgrammeStream && (
            <>
              Showing{" "}
              <span className="font-medium text-foreground">
                {filteredStudents.length}
              </span>{" "}
              student(s) for{" "}
              <span className="font-medium text-foreground">
                {selectedProgrammeCode}
              </span>{" "}
              /{" "}
              <span className="font-medium text-foreground">
                {selectedProgrammeStream}
              </span>
              .
            </>
          )}
        </div>
      </div>

      <details className="rounded-md border bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Export Study Plan (CSV)
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          One row per student. Bridging module pairs come first, then degree
          programme module pairs, sorted by study term order.
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
              <th className="sticky top-0 z-10 bg-slate-100 p-2 text-left whitespace-nowrap">
                Student ID
              </th>
              <th className="sticky top-0 z-10 bg-slate-100 p-2 text-left whitespace-nowrap">
                Student Name
              </th>
              <th className="sticky top-0 z-10 bg-slate-100 p-2 text-left whitespace-nowrap">
                Programme
              </th>
              <th className="sticky top-0 z-10 bg-slate-100 p-2 text-left whitespace-nowrap">
                Stream
              </th>
              <th className="sticky top-0 z-10 bg-slate-100 p-2 text-left whitespace-nowrap">
                Intake Year
              </th>
              <th className="sticky top-0 z-10 bg-slate-100 p-2 text-left whitespace-nowrap">
                Intake Level
              </th>
              <th className="sticky top-0 z-10 bg-slate-100 p-2 text-left whitespace-nowrap">
                Mode
              </th>
              <th className="sticky top-0 z-10 bg-slate-100 p-2 text-left whitespace-nowrap">
                Intake Term
              </th>
              <th className="sticky top-0 z-10 bg-slate-100 p-2 text-left whitespace-nowrap">
                Graduate Term
              </th>
              <th className="sticky top-0 z-10 bg-slate-100 p-2 text-left whitespace-nowrap">
                Status
              </th>
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

            {!loading && selectedProgrammeCode && !selectedProgrammeStream && (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={11}>
                  Please select a programme stream to view students.
                </td>
              </tr>
            )}

            {!loading &&
              selectedProgrammeCode &&
              selectedProgrammeStream &&
              filteredStudents.length === 0 && (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={11}>
                    No students found for this programme and stream.
                  </td>
                </tr>
              )}

            {!loading &&
              selectedProgrammeCode &&
              selectedProgrammeStream &&
              filteredStudents.map((student) => (
                <tr key={student.id ?? student.studentId} className="border-t">
                  <td className="whitespace-nowrap p-2">{student.studentId}</td>
                  <td className="whitespace-nowrap p-2">{student.studentName}</td>
                  <td className="whitespace-nowrap p-2">{student.programmeCode}</td>
                  <td className="whitespace-nowrap p-2">
                    {normalizeStream(student.programmeStream)}
                  </td>
                  <td className="whitespace-nowrap p-2">{student.intakeYear || "-"}</td>
                  <td className="whitespace-nowrap p-2">{student.intakeLevel || "-"}</td>
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
