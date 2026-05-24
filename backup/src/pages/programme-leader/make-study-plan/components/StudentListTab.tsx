import { useMemo, useState } from "react";

import type { StudyPlanStudent } from "../types";
import { deleteStudyPlanStudent } from "../../../../services/studyPlanService";

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

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
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

      <div className="rounded-md border bg-white p-4">
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

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-2 text-left">Student ID</th>
              <th className="p-2 text-left">Student Name</th>
              <th className="p-2 text-left">Programme</th>
              <th className="p-2 text-left">Stream</th>
              <th className="p-2 text-left">Intake Year</th>
              <th className="p-2 text-left">Intake Level</th>
              <th className="p-2 text-left">Mode</th>
              <th className="p-2 text-left">Intake Term</th>
              <th className="p-2 text-left">Graduate Term</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Actions</th>
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
                  <td className="p-2">{student.studentId}</td>
                  <td className="p-2">{student.studentName}</td>
                  <td className="p-2">{student.programmeCode}</td>
                  <td className="p-2">
                    {normalizeStream(student.programmeStream)}
                  </td>
                  <td className="p-2">{student.intakeYear || "-"}</td>
                  <td className="p-2">{student.intakeLevel || "-"}</td>
                  <td className="p-2">{student.studyMode}</td>
                  <td className="p-2">{student.intakeTerm || "-"}</td>
                  <td className="p-2">{student.graduateTerm || "-"}</td>
                  <td className="p-2">
                    <span className="rounded-full bg-muted px-2 py-1 text-xs">
                      {student.studentStatus ?? "potential"}
                    </span>
                  </td>
                  <td className="p-2 space-x-2">
                    <button
                      className="px-3 py-1 rounded-md bg-muted text-xs"
                      onClick={() => student.id && onEdit(student.id)}
                      disabled={!student.id}
                    >
                      Edit
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
      </div>
    </div>
  );
}
