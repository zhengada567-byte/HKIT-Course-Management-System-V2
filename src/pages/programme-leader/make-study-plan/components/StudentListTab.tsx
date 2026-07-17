import { useEffect, useMemo, useState } from "react";

import { TableViewport } from "../../../../components/tables/TableViewport";
import { useLanguage } from "../../../../contexts/LanguageContext";
import { getTermIndex } from "../helpers";
import { formatProgrammeYearDisplay } from "../../../../lib/programmeYear";
import type { StudyPlanStudent } from "../types";
import {
  getAutoGenerateEligibility,
  type AutoGenerateEligibilityStatus,
} from "../studyPlanAutoGenerate";
import {
  batchAutoGenerateStudyPlans,
  deleteStudyPlanStudent,
  getProgrammeTypeByCode,
  listProfileIdsWithProgrammePlan,
} from "../../../../services/studyPlanService";
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

function eligibilityLabel(
  status: AutoGenerateEligibilityStatus,
  t: ReturnType<typeof useLanguage>["t"]
) {
  if (status === "ready") return t.studyPlanAutoGenerateStatusReady;
  if (status === "has_programme_plan") {
    return t.studyPlanAutoGenerateStatusHasPlan;
  }
  if (status === "incomplete_profile") {
    return t.studyPlanAutoGenerateStatusIncomplete;
  }
  return t.studyPlanAutoGenerateStatusIneligible;
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
  const { t } = useLanguage();
  const [selectedProgrammeCode, setSelectedProgrammeCode] = useState("");
  const [selectedProgrammeStream, setSelectedProgrammeStream] = useState("");
  const [exportScope, setExportScope] =
    useState<StudyPlanExportScope>("stream");
  const [exportProgrammeType, setExportProgrammeType] = useState("Degree");
  const [exporting, setExporting] = useState(false);
  const [sortKey, setSortKey] = useState<StudentSortKey>("studentId");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [scanLoading, setScanLoading] = useState(false);
  const [programmeType, setProgrammeType] = useState<string | null>(null);
  const [profilesWithProgrammePlan, setProfilesWithProgrammePlan] = useState<
    Set<string>
  >(() => new Set());
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(
    () => new Set()
  );
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [rescanToken, setRescanToken] = useState(0);

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

  const filteredProfileIds = useMemo(
    () =>
      filteredStudents
        .map((student) => student.id)
        .filter((id): id is string => Boolean(id)),
    [filteredStudents]
  );

  useEffect(() => {
    let cancelled = false;

    async function scanEligibleStudents() {
      if (!selectedProgrammeCode) {
        setProgrammeType(null);
        setProfilesWithProgrammePlan(new Set());
        setSelectedProfileIds(new Set());
        return;
      }

      setScanLoading(true);

      try {
        const type = await getProgrammeTypeByCode(selectedProgrammeCode);

        if (cancelled) {
          return;
        }

        setProgrammeType(type ?? null);

        const withPlan = await listProfileIdsWithProgrammePlan(filteredProfileIds);

        if (cancelled) {
          return;
        }

        setProfilesWithProgrammePlan(withPlan);

        const autoSelected = new Set<string>();

        for (const student of filteredStudents) {
          if (!student.id) {
            continue;
          }

          const status = getAutoGenerateEligibility({
            student,
            programmeType: type,
            hasProgrammeModules: withPlan.has(student.id),
          });

          if (status === "ready") {
            autoSelected.add(student.id);
          }
        }

        setSelectedProfileIds(autoSelected);
      } finally {
        if (!cancelled) {
          setScanLoading(false);
        }
      }
    }

    void scanEligibleStudents();

    return () => {
      cancelled = true;
    };
  }, [
    selectedProgrammeCode,
    selectedProgrammeStream,
    filteredStudents,
    filteredProfileIds,
    rescanToken,
  ]);

  const studentEligibilityById = useMemo(() => {
    const map = new Map<string, AutoGenerateEligibilityStatus>();

    for (const student of filteredStudents) {
      if (!student.id) {
        continue;
      }

      map.set(
        student.id,
        getAutoGenerateEligibility({
          student,
          programmeType,
          hasProgrammeModules: profilesWithProgrammePlan.has(student.id),
        })
      );
    }

    return map;
  }, [filteredStudents, programmeType, profilesWithProgrammePlan]);

  const readyStudents = useMemo(
    () =>
      filteredStudents.filter(
        (student) => student.id && studentEligibilityById.get(student.id) === "ready"
      ),
    [filteredStudents, studentEligibilityById]
  );

  const selectedReadyCount = useMemo(() => {
    let count = 0;

    for (const profileId of selectedProfileIds) {
      if (studentEligibilityById.get(profileId) === "ready") {
        count += 1;
      }
    }

    return count;
  }, [selectedProfileIds, studentEligibilityById]);

  const allReadySelected =
    readyStudents.length > 0 &&
    readyStudents.every((student) => selectedProfileIds.has(student.id!));

  const someReadySelected =
    readyStudents.some((student) => selectedProfileIds.has(student.id!)) &&
    !allReadySelected;

  function toggleProfileSelection(profileId: string, checked: boolean) {
    setSelectedProfileIds((current) => {
      const next = new Set(current);

      if (checked) {
        next.add(profileId);
      } else {
        next.delete(profileId);
      }

      return next;
    });
  }

  function toggleSelectAllReady(checked: boolean) {
    setSelectedProfileIds((current) => {
      const next = new Set(current);

      for (const student of readyStudents) {
        if (!student.id) {
          continue;
        }

        if (checked) {
          next.add(student.id);
        } else {
          next.delete(student.id);
        }
      }

      return next;
    });
  }

  async function handleBatchAutoGenerate() {
    if (!selectedProgrammeCode) {
      alert(t.studyPlanAutoGenerateSelectProgramme);
      return;
    }

    const profileIds = Array.from(selectedProfileIds).filter(
      (profileId) => studentEligibilityById.get(profileId) === "ready"
    );

    if (profileIds.length === 0) {
      alert(t.studyPlanAutoGenerateNoSelection);
      return;
    }

    const confirmed = window.confirm(
      t.studyPlanAutoGenerateConfirm.replace("{count}", String(profileIds.length))
    );

    if (!confirmed) {
      return;
    }

    setBatchGenerating(true);

    try {
      const studentsByProfileId = new Map(
        filteredStudents
          .filter((student) => student.id)
          .map((student) => [student.id!, student])
      );

      const result = await batchAutoGenerateStudyPlans({
        profileIds,
        programmeCode: selectedProgrammeCode,
        studentsByProfileId,
      });

      const lines = [
        t.studyPlanAutoGenerateDoneSummary
          .replace("{success}", String(result.successCount))
          .replace("{failed}", String(result.failedCount)),
      ];

      const failures = result.results.filter((row) => !row.success);

      if (failures.length > 0) {
        lines.push("");
        lines.push(t.studyPlanAutoGenerateFailures);

        for (const row of failures.slice(0, 12)) {
          const label = row.studentId
            ? `${row.studentId} ${row.studentName}`.trim()
            : t.studyPlanAutoGenerateSyncFailed;
          lines.push(`• ${label}: ${row.message ?? "Failed"}`);
        }

        if (failures.length > 12) {
          lines.push(`… +${failures.length - 12} more`);
        }
      }

      alert(lines.join("\n"));
      setRescanToken((token) => token + 1);
      await onRefresh();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t.studyPlanAutoGenerateBatchFailed;

      alert(`${t.studyPlanAutoGenerateBatchFailed}\n\n${message}`);
    } finally {
      setBatchGenerating(false);
    }
  }

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

      <div className="shrink-0 rounded-md border border-blue-200 bg-blue-50/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-slate-900">
              {t.studyPlanAutoGenerateTitle}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t.studyPlanAutoGenerateDescription}
            </p>
            {selectedProgrammeCode ? (
              <p className="text-xs text-slate-700">
                {scanLoading
                  ? t.studyPlanAutoGenerateScanning
                  : t.studyPlanAutoGenerateSelectedSummary
                      .replace("{selected}", String(selectedReadyCount))
                      .replace("{ready}", String(readyStudents.length))}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border bg-white px-3 py-2 text-sm disabled:opacity-50"
              disabled={!selectedProgrammeCode || scanLoading || batchGenerating}
              onClick={() => setRescanToken((token) => token + 1)}
            >
              {t.studyPlanAutoGenerateRescan}
            </button>
            <button
              type="button"
              className="rounded-md bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={
                !selectedProgrammeCode ||
                scanLoading ||
                batchGenerating ||
                selectedReadyCount === 0
              }
              onClick={() => void handleBatchAutoGenerate()}
            >
              {batchGenerating
                ? t.studyPlanAutoGenerateRunning
                : t.studyPlanAutoGenerateRun.replace(
                    "{count}",
                    String(selectedReadyCount)
                  )}
            </button>
          </div>
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
              <th className="sticky top-0 z-10 w-10 bg-slate-100 p-2 text-center">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={allReadySelected}
                  disabled={
                    !selectedProgrammeCode ||
                    scanLoading ||
                    readyStudents.length === 0
                  }
                  ref={(element) => {
                    if (element) {
                      element.indeterminate = someReadySelected;
                    }
                  }}
                  aria-label={t.studyPlanAutoGenerateSelectAllReady}
                  title={t.studyPlanAutoGenerateSelectAllReady}
                  onChange={(event) =>
                    toggleSelectAllReady(event.target.checked)
                  }
                />
              </th>
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
              <th className="sticky top-0 z-10 bg-slate-100 p-2 text-left text-sm font-semibold whitespace-nowrap">
                {t.studyPlanAutoGeneratePlanColumn}
              </th>
              <th className="sticky top-0 z-10 bg-slate-100 p-2 text-left whitespace-nowrap">
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td className="p-3" colSpan={13}>
                  Loading...
                </td>
              </tr>
            )}

            {!loading && !selectedProgrammeCode && (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={13}>
                  Please select a programme code to view students.
                </td>
              </tr>
            )}

            {!loading &&
              selectedProgrammeCode &&
              filteredStudents.length === 0 && (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={13}>
                    No students found for this programme and stream.
                  </td>
                </tr>
              )}

            {!loading &&
              selectedProgrammeCode &&
              sortedStudents.map((student) => {
                const eligibility = student.id
                  ? studentEligibilityById.get(student.id) ?? "ineligible"
                  : "ineligible";
                const canSelect = eligibility === "ready" && Boolean(student.id);

                return (
                <tr key={student.id ?? student.studentId} className="border-t">
                  <td className="p-2 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={Boolean(
                        student.id && selectedProfileIds.has(student.id)
                      )}
                      disabled={!canSelect || scanLoading || batchGenerating}
                      aria-label={`${t.studyPlanAutoGenerateSelectStudent} ${student.studentId}`}
                      onChange={(event) => {
                        if (!student.id) {
                          return;
                        }

                        toggleProfileSelection(student.id, event.target.checked);
                      }}
                    />
                  </td>
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
                  <td className="whitespace-nowrap p-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${
                        eligibility === "ready"
                          ? "bg-emerald-100 text-emerald-900"
                          : eligibility === "has_programme_plan"
                            ? "bg-slate-100 text-slate-700"
                            : eligibility === "incomplete_profile"
                              ? "bg-amber-100 text-amber-900"
                              : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {eligibilityLabel(eligibility, t)}
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
                );
              })}
          </tbody>
        </table>
      </TableViewport>
    </div>
  );
}
