import { useMemo, useState } from "react";
import { Download, Loader2, Search } from "lucide-react";
import { saveAs } from "file-saver";

import { DataTable } from "../../../components/tables/DataTable";
import { EmptyState } from "../../../components/ui/EmptyState";
import { useLanguage } from "../../../contexts/LanguageContext";
import {
  detectClassroomWeeklyConflicts,
  type ClassroomWeeklyConflict,
  type ClassroomWeeklyConflictResult,
} from "../../../services/classroomWeeklyConflictService";
import type { TimetableScheduleTerm } from "../../../services/timetableScheduleService";

type ClassroomWeeklyConflictPanelProps = {
  academicYear: string;
  term: TimetableScheduleTerm;
};

export function ClassroomWeeklyConflictPanel({
  academicYear,
  term,
}: ClassroomWeeklyConflictPanelProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [result, setResult] = useState<ClassroomWeeklyConflictResult | null>(
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
    setRoomFilter("");

    try {
      const detected = await detectClassroomWeeklyConflicts({
        academicYear,
        term,
      });
      setResult(detected);
    } catch (detectError) {
      setError(
        detectError instanceof Error
          ? detectError.message
          : t.classroomWeeklyConflictDetectFailed
      );
    } finally {
      setLoading(false);
    }
  }

  const filteredConflicts = useMemo(() => {
    const rows = result?.conflicts ?? [];
    if (!roomFilter) return rows;
    return rows.filter(
      (row) => row.roomCode.toUpperCase() === roomFilter.toUpperCase()
    );
  }, [result?.conflicts, roomFilter]);

  const roomOptions = useMemo(() => {
    const rooms = new Set(
      (result?.conflicts ?? []).map((row) => row.roomCode.trim()).filter(Boolean)
    );
    return Array.from(rooms).sort((a, b) => a.localeCompare(b));
  }, [result?.conflicts]);

  function handleExportCsv() {
    if (!result) return;

    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const roomPart = roomFilter || "ALL";
    const fileName = `classroom_weekly_clashes_${academicYear}_${term}_${roomPart}_${dateStamp}.csv`;

    const headers = [
      "academic_year",
      "term",
      "room_code",
      "weekday",
      "overlap_start",
      "overlap_end",
      "module_a",
      "instance_a",
      "programme_a",
      "teacher_a",
      "time_a",
      "module_b",
      "instance_b",
      "programme_b",
      "teacher_b",
      "time_b",
    ];

    const rows = filteredConflicts.map((clash) => [
      academicYear,
      term,
      clash.roomCode,
      clash.weekdayLabel,
      clash.overlapStart,
      clash.overlapEnd,
      clash.moduleCodeA,
      clash.moduleInstanceCodeA,
      clash.programmeCodeA,
      clash.teacherNameA,
      clash.timeWindowA,
      clash.moduleCodeB,
      clash.moduleInstanceCodeB,
      clash.programmeCodeB,
      clash.teacherNameB,
      clash.timeWindowB,
    ]);

    saveAs(
      new Blob([rowsToCsv(headers, rows)], {
        type: "text/csv;charset=utf-8;",
      }),
      fileName
    );
  }

  return (
    <section className="card mb-6">
      <div className="card-body space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {t.classroomWeeklyConflictStep}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {t.classroomWeeklyConflictStepHint}
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
            {loading ? t.loading : t.classroomWeeklyConflictDetect}
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
            <label className="form-label mb-0">
              {t.classroomWeeklyConflictRoomFilter}
            </label>
            <select
              className="form-select min-w-36"
              value={roomFilter}
              onChange={(event) => setRoomFilter(event.target.value)}
              disabled={loading || !result}
            >
              <option value="">{t.allRooms}</option>
              {roomOptions.map((room) => (
                <option key={room} value={room}>
                  {room}
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
              {t.classroomWeeklyConflictSummary
                .replace("{modules}", String(result.moduleCount))
                .replace("{rooms}", String(result.roomCount))
                .replace("{conflicts}", String(filteredConflicts.length))}
            </div>

            {filteredConflicts.length > 0 ? (
              <ConflictTable rows={filteredConflicts} />
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {t.classroomWeeklyConflictNone}
              </div>
            )}
          </>
        )}

        {!loading && !result && !error && (
          <EmptyState message={t.classroomWeeklyConflictEmpty} />
        )}
      </div>
    </section>
  );
}

function ConflictTable({ rows }: { rows: ClassroomWeeklyConflict[] }) {
  const { t } = useLanguage();

  return (
    <div className="card">
      <div className="card-body">
        <DataTable
          rows={rows}
          rowKey={(row) =>
            `${row.roomCode}|${row.weekday}|${row.moduleInstanceCodeA}|${row.moduleInstanceCodeB}|${row.overlapStart}`
          }
          columns={[
            {
              key: "room",
              header: t.room,
              render: (row) => (
                <span className="font-medium text-slate-900">{row.roomCode}</span>
              ),
            },
            {
              key: "weekday",
              header: t.weekday,
              render: (row) => row.weekdayLabel,
            },
            {
              key: "overlap",
              header: t.classroomWeeklyConflictOverlap,
              render: (row) => `${row.overlapStart}–${row.overlapEnd}`,
            },
            {
              key: "moduleA",
              header: t.classroomWeeklyConflictModuleA,
              render: (row) => (
                <div className="font-mono text-xs">
                  <div>{row.moduleCodeA}</div>
                  <div className="text-slate-500">{row.moduleInstanceCodeA}</div>
                  <div>{row.timeWindowA}</div>
                  <div className="text-slate-500">
                    {row.programmeCodeA || "—"}
                  </div>
                  <div className="text-slate-600">
                    {row.teacherNameA || "—"}
                  </div>
                </div>
              ),
            },
            {
              key: "moduleB",
              header: t.classroomWeeklyConflictModuleB,
              render: (row) => (
                <div className="font-mono text-xs">
                  <div>{row.moduleCodeB}</div>
                  <div className="text-slate-500">{row.moduleInstanceCodeB}</div>
                  <div>{row.timeWindowB}</div>
                  <div className="text-slate-500">
                    {row.programmeCodeB || "—"}
                  </div>
                  <div className="text-slate-600">
                    {row.teacherNameB || "—"}
                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
