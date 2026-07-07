import { useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2, Search } from "lucide-react";
import { saveAs } from "file-saver";

import { DataTable } from "../../../components/tables/DataTable";
import { EmptyState } from "../../../components/ui/EmptyState";
import { useLanguage } from "../../../contexts/LanguageContext";
import {
  detectStudentWeeklyTimetableConflicts,
  type StudentWeeklyTimetableConflict,
  type StudentWeeklyTimetableConflictResult,
  type StudentWeeklyTimetableWarning,
} from "../../../services/studentWeeklyTimetableConflictService";
import type { TimetableScheduleTerm } from "../../../services/timetableScheduleService";

type StudentWeeklyConflictPanelProps = {
  academicYear: string;
  term: TimetableScheduleTerm;
  programmeCodes: string[];
};

export function StudentWeeklyConflictPanel({
  academicYear,
  term,
  programmeCodes,
}: StudentWeeklyConflictPanelProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [programmeFilter, setProgrammeFilter] = useState("");
  const [result, setResult] = useState<StudentWeeklyTimetableConflictResult | null>(
    null
  );

  function escapeCsvCell(value: unknown): string {
    const text = String(value ?? "");
    if (/[",\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function rowsToCsv(headers: string[], rows: string[][]): string {
    return [headers, ...rows]
      .map((row) => row.map(escapeCsvCell).join(","))
      .join("\n");
  }

  async function handleDetect() {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const detected = await detectStudentWeeklyTimetableConflicts({
        academicYear,
        term,
      });
      setResult(detected);
    } catch (detectError) {
      setError(
        detectError instanceof Error
          ? detectError.message
          : t.studentWeeklyConflictDetectFailed
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExportCsv() {
    if (!result) return;

    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const programmePart = programmeFilter ? programmeFilter : "ALL";
    const fileName = `student_weekly_clashes_${academicYear}_${term}_${programmePart}_${dateStamp}.csv`;

    const headers = [
      "type",
      "academic_year",
      "term",
      "programme_code",
      "student_id",
      "student_name",
      "stream",
      "weekday",
      "overlap_start",
      "overlap_end",
      "module_a",
      "instance_a",
      "time_a",
      "room_a",
      "module_b",
      "instance_b",
      "time_b",
      "room_b",
      "warning_reason",
      "warning_detail",
    ];

    const rows: string[][] = [];

    for (const clash of filteredConflicts) {
      rows.push([
        "conflict",
        academicYear,
        term,
        clash.programmeCode,
        clash.studentId,
        clash.studentName,
        clash.programmeStream,
        clash.weekdayLabel,
        clash.overlapStart,
        clash.overlapEnd,
        clash.moduleCodeA,
        clash.moduleInstanceCodeA,
        clash.timeWindowA,
        clash.roomCodeA,
        clash.moduleCodeB,
        clash.moduleInstanceCodeB,
        clash.timeWindowB,
        clash.roomCodeB,
        "",
        "",
      ]);
    }

    for (const warning of filteredWarnings) {
      rows.push([
        "warning",
        academicYear,
        term,
        warning.programmeCode,
        warning.studentId,
        warning.studentName,
        "",
        "",
        "",
        "",
        warning.moduleCode,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        warning.reason,
        warning.detail,
      ]);
    }

    const csv = rowsToCsv(headers, rows);

    saveAs(
      new Blob([csv], {
        type: "text/csv;charset=utf-8;",
      }),
      fileName
    );
  }

  const filteredConflicts = useMemo(() => {
    const rows = result?.conflicts ?? [];
    if (!programmeFilter) return rows;
    return rows.filter((row) => row.programmeCode === programmeFilter);
  }, [programmeFilter, result?.conflicts]);

  const filteredWarnings = useMemo(() => {
    const rows = result?.warnings ?? [];
    if (!programmeFilter) return rows;
    return rows.filter((row) => row.programmeCode === programmeFilter);
  }, [programmeFilter, result?.warnings]);

  return (
    <section className="card mb-6">
      <div className="card-body space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {t.studentWeeklyConflictStep}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {t.studentWeeklyConflictStepHint}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-primary inline-flex items-center gap-2"
            disabled={loading}
            onClick={() => void handleDetect()}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {loading ? t.loading : t.studentWeeklyConflictDetect}
          </button>

          <button
            type="button"
            className="btn btn-secondary inline-flex items-center gap-2"
            disabled={loading || !result}
            onClick={handleExportCsv}
          >
            <Download className="h-4 w-4" />
            {t.exportCsv}
          </button>

          <div className="flex items-center gap-2">
            <label className="form-label mb-0">{t.studentWeeklyConflictProgrammeFilter}</label>
            <select
              className="form-select min-w-36"
              value={programmeFilter}
              onChange={(event) => setProgrammeFilter(event.target.value)}
              disabled={loading}
              title={t.studentWeeklyConflictProgrammeFilter}
            >
              <option value="">{t.allProgrammes}</option>
              {programmeCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {result && (
          <>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {t.studentWeeklyConflictSummary
                .replace("{students}", String(result.studentCount))
                .replace("{modules}", String(result.moduleRowCount))
                .replace("{conflicts}", String(filteredConflicts.length))
                .replace("{warnings}", String(filteredWarnings.length))}
            </div>

            {filteredConflicts.length > 0 ? (
              <ConflictTable rows={filteredConflicts} />
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {t.studentWeeklyConflictNone}
              </div>
            )}

            {filteredWarnings.length > 0 && (
              <WarningList rows={filteredWarnings} />
            )}
          </>
        )}

        {!loading && !result && !error && <EmptyState message={t.studentWeeklyConflictEmpty} />}
      </div>
    </section>
  );
}

function ConflictTable({ rows }: { rows: StudentWeeklyTimetableConflict[] }) {
  const { t } = useLanguage();

  return (
    <div className="card">
      <div className="card-body">
        <DataTable
          rows={rows}
          rowKey={(row) =>
            `${row.studentId}|${row.weekday}|${row.moduleInstanceCodeA}|${row.moduleInstanceCodeB}|${row.overlapStart}`
          }
          columns={[
            {
              key: "student",
              header: t.studentId,
              render: (row) => (
                <div>
                  <div className="font-medium text-slate-900">{row.studentId}</div>
                  <div className="text-xs text-slate-500">{row.studentName}</div>
                </div>
              ),
            },
            {
              key: "programme",
              header: t.programmeCode,
              render: (row) => row.programmeCode || "—",
            },
            {
              key: "stream",
              header: t.programmeStream,
              render: (row) => row.programmeStream || "—",
            },
            {
              key: "weekday",
              header: t.weekday,
              render: (row) => row.weekdayLabel,
            },
            {
              key: "overlap",
              header: t.studentWeeklyConflictOverlap,
              render: (row) => `${row.overlapStart}–${row.overlapEnd}`,
            },
            {
              key: "moduleA",
              header: t.studentWeeklyConflictModuleA,
              render: (row) => (
                <div className="font-mono text-xs">
                  <div>{row.moduleCodeA}</div>
                  <div className="text-slate-500">{row.moduleInstanceCodeA}</div>
                  <div>{row.timeWindowA}</div>
                  <div className="text-slate-500">{row.roomCodeA}</div>
                </div>
              ),
            },
            {
              key: "moduleB",
              header: t.studentWeeklyConflictModuleB,
              render: (row) => (
                <div className="font-mono text-xs">
                  <div>{row.moduleCodeB}</div>
                  <div className="text-slate-500">{row.moduleInstanceCodeB}</div>
                  <div>{row.timeWindowB}</div>
                  <div className="text-slate-500">{row.roomCodeB}</div>
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}

function WarningList({ rows }: { rows: StudentWeeklyTimetableWarning[] }) {
  const { t } = useLanguage();

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
      <div className="mb-2 flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4" />
        {t.studentWeeklyConflictWarningsTitle}
      </div>
      <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
        {rows.slice(0, 50).map((row) => (
          <li key={`${row.studentId}|${row.programmeCode}|${row.moduleCode}|${row.reason}`}>
            <span className="font-medium">{row.studentId}</span>
            {row.studentName ? ` (${row.studentName})` : ""}
            {row.programmeCode ? ` · ${row.programmeCode}` : ""}
            {" · "}
            <span className="font-mono">{row.moduleCode}</span>
            {" — "}
            {row.reason === "missing_enrolled_class"
              ? t.studentWeeklyConflictWarnMissingClass
              : t.studentWeeklyConflictWarnMissingPattern}
            {row.detail ? ` (${row.detail})` : ""}
          </li>
        ))}
      </ul>
      {rows.length > 50 && (
        <p className="mt-2 text-xs">
          {t.studentWeeklyConflictWarningsMore.replace("{count}", String(rows.length - 50))}
        </p>
      )}
    </div>
  );
}
