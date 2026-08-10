import { useMemo, useState } from "react";
import { Download, Loader2, Search } from "lucide-react";
import { saveAs } from "file-saver";

import { DataTable } from "../../../components/tables/DataTable";
import { EmptyState } from "../../../components/ui/EmptyState";
import { useLanguage } from "../../../contexts/LanguageContext";
import {
  inspectClassroomsByDate,
  type ClassroomDateConflict,
  type ClassroomDateInspectResult,
  type ClassroomDateRoomOccupancy,
  type ClassroomDateSessionRow,
} from "../../../services/classroomDateInspectService";

type ClassroomDateInspectPanelProps = {
  academicYear: string;
};

export function ClassroomDateInspectPanel({
  academicYear,
}: ClassroomDateInspectPanelProps) {
  const { t } = useLanguage();
  const [sessionDate, setSessionDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ClassroomDateInspectResult | null>(null);
  const [roomFilter, setRoomFilter] = useState("");
  const [showFreeOnly, setShowFreeOnly] = useState(false);

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

  async function handleInspect() {
    if (!sessionDate) {
      setError(t.classroomDateInspectSelectDate);
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);
    setRoomFilter("");
    setShowFreeOnly(false);

    try {
      const inspected = await inspectClassroomsByDate({
        academicYear,
        sessionDate,
      });
      setResult(inspected);
    } catch (inspectError) {
      setError(
        inspectError instanceof Error
          ? inspectError.message
          : t.classroomDateInspectFailed
      );
    } finally {
      setLoading(false);
    }
  }

  const filteredSessions = useMemo(() => {
    const rows = result?.sessions ?? [];
    if (!roomFilter) return rows;
    return rows.filter(
      (row) => row.roomCode.toUpperCase() === roomFilter.toUpperCase()
    );
  }, [result?.sessions, roomFilter]);

  const filteredRooms = useMemo(() => {
    let rows = result?.rooms ?? [];
    if (showFreeOnly) {
      rows = rows.filter((row) => row.isFullyFree);
    }
    if (roomFilter) {
      rows = rows.filter(
        (row) => row.roomCode.toUpperCase() === roomFilter.toUpperCase()
      );
    }
    return rows;
  }, [result?.rooms, roomFilter, showFreeOnly]);

  const roomOptions = useMemo(() => {
    const rooms = new Set(
      (result?.rooms ?? []).map((row) => row.roomCode.trim()).filter(Boolean)
    );
    for (const session of result?.sessions ?? []) {
      if (session.roomCode && session.roomCode !== "—") {
        rooms.add(session.roomCode);
      }
    }
    return Array.from(rooms).sort((a, b) => a.localeCompare(b));
  }, [result?.rooms, result?.sessions]);

  function handleExportCsv() {
    if (!result) return;

    const dateStamp = result.date.replace(/-/g, "");
    const fileName = `classroom_date_inspect_${academicYear}_${dateStamp}.csv`;

    const sessionHeaders = [
      "section",
      "academic_year",
      "date",
      "weekday",
      "start",
      "end",
      "room_code",
      "module_code",
      "instance",
      "programme",
      "teacher",
      "label",
      "delivery_mode",
      "module_name",
    ];
    const sessionRows = filteredSessions.map((row) => [
      "session",
      academicYear,
      result.date,
      result.weekdayLabel,
      row.start,
      row.end,
      row.roomCode,
      row.moduleCode,
      row.moduleInstanceCode,
      row.programmeCode,
      row.teacherName,
      row.sessionLabel,
      row.deliveryMode,
      row.moduleName,
    ]);

    const roomHeaders = [
      "section",
      "room_code",
      "location",
      "room_size",
      "room_type",
      "fully_free",
      "occupied_windows",
    ];
    const roomRows = filteredRooms.map((row) => [
      "room",
      row.roomCode,
      row.location,
      String(row.roomSize || ""),
      row.roomType,
      row.isFullyFree ? "yes" : "no",
      row.occupiedWindows.map((w) => `${w.start}-${w.end}`).join("; "),
    ]);

    const conflictHeaders = [
      "section",
      "room_code",
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
    const conflictRows = (result.conflicts ?? []).map((row) => [
      "conflict",
      row.roomCode,
      row.overlapStart,
      row.overlapEnd,
      row.moduleCodeA,
      row.moduleInstanceCodeA,
      row.programmeCodeA,
      row.teacherNameA,
      row.timeWindowA,
      row.moduleCodeB,
      row.moduleInstanceCodeB,
      row.programmeCodeB,
      row.teacherNameB,
      row.timeWindowB,
    ]);

    const body = [
      rowsToCsv(sessionHeaders, sessionRows),
      "",
      rowsToCsv(roomHeaders, roomRows),
      "",
      rowsToCsv(conflictHeaders, conflictRows),
    ].join("\n");

    saveAs(
      new Blob([body], {
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
            {t.classroomDateInspectStep}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {t.classroomDateInspectStepHint}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="form-label" htmlFor="classroom-date-inspect">
              {t.classroomDateInspectDate}
            </label>
            <input
              id="classroom-date-inspect"
              type="date"
              className="form-input"
              value={sessionDate}
              onChange={(event) => setSessionDate(event.target.value)}
              disabled={loading}
            />
          </div>

          <button
            type="button"
            className="btn btn-primary inline-flex items-center gap-2"
            disabled={loading}
            onClick={() => void handleInspect()}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {loading ? t.loading : t.classroomDateInspectLoad}
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

          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="rounded border-slate-300"
              checked={showFreeOnly}
              onChange={(event) => setShowFreeOnly(event.target.checked)}
              disabled={loading || !result}
            />
            {t.classroomDateInspectFreeOnly}
          </label>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {result && (
          <>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {t.classroomDateInspectSummary
                .replace("{date}", result.date)
                .replace("{weekday}", result.weekdayLabel)
                .replace("{sessions}", String(filteredSessions.length))
                .replace("{freeRooms}", String(result.freeRoomCount))
                .replace("{rooms}", String(result.rooms.length))
                .replace("{conflicts}", String(result.conflicts.length))}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">
                {t.classroomDateInspectSessionsTitle}
              </h3>
              {filteredSessions.length > 0 ? (
                <SessionTable rows={filteredSessions} />
              ) : (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                  {t.classroomDateInspectNoSessions}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">
                {t.classroomDateInspectRoomsTitle}
              </h3>
              {filteredRooms.length > 0 ? (
                <RoomTable rows={filteredRooms} />
              ) : (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                  {t.classroomDateInspectNoRooms}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">
                {t.classroomDateInspectConflictsTitle}
              </h3>
              {result.conflicts.length > 0 ? (
                <ConflictTable rows={result.conflicts} />
              ) : (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  {t.classroomDateInspectNoConflicts}
                </div>
              )}
            </div>
          </>
        )}

        {!loading && !result && !error && (
          <EmptyState message={t.classroomDateInspectEmpty} />
        )}
      </div>
    </section>
  );
}

function SessionTable({ rows }: { rows: ClassroomDateSessionRow[] }) {
  const { t } = useLanguage();

  return (
    <div className="card">
      <div className="card-body">
        <DataTable
          rows={rows}
          rowKey={(row) => row.sessionId}
          columns={[
            {
              key: "time",
              header: t.classroomDateInspectTime,
              render: (row) => `${row.start}–${row.end}`,
            },
            {
              key: "room",
              header: t.room,
              render: (row) => (
                <span className="font-medium text-slate-900">{row.roomCode}</span>
              ),
            },
            {
              key: "module",
              header: t.moduleCode,
              render: (row) => (
                <div className="font-mono text-xs">
                  <div>{row.moduleCode}</div>
                  <div className="text-slate-500">{row.moduleInstanceCode}</div>
                  {row.sessionLabel ? (
                    <div className="text-slate-500">{row.sessionLabel}</div>
                  ) : null}
                </div>
              ),
            },
            {
              key: "programme",
              header: t.programmeCode,
              render: (row) => row.programmeCode || "—",
            },
            {
              key: "teacher",
              header: t.teacherName,
              render: (row) => row.teacherName || "—",
            },
          ]}
        />
      </div>
    </div>
  );
}

function RoomTable({ rows }: { rows: ClassroomDateRoomOccupancy[] }) {
  const { t } = useLanguage();

  return (
    <div className="card">
      <div className="card-body">
        <DataTable
          rows={rows}
          rowKey={(row) => row.roomCode}
          columns={[
            {
              key: "room",
              header: t.room,
              render: (row) => (
                <div>
                  <div className="font-medium text-slate-900">{row.roomCode}</div>
                  {row.location ? (
                    <div className="text-xs text-slate-500">{row.location}</div>
                  ) : null}
                </div>
              ),
            },
            {
              key: "size",
              header: t.classroomDateInspectRoomSize,
              render: (row) => (row.roomSize > 0 ? String(row.roomSize) : "—"),
            },
            {
              key: "type",
              header: t.classroomDateInspectRoomType,
              render: (row) => row.roomType || "—",
            },
            {
              key: "status",
              header: t.classroomDateInspectRoomStatus,
              render: (row) =>
                row.isFullyFree ? (
                  <span className="text-emerald-700">
                    {t.classroomDateInspectFullyFree}
                  </span>
                ) : (
                  <span className="text-amber-700">
                    {t.classroomDateInspectOccupied}
                  </span>
                ),
            },
            {
              key: "windows",
              header: t.classroomDateInspectOccupiedWindows,
              render: (row) =>
                row.occupiedWindows.length > 0 ? (
                  <div className="font-mono text-xs text-slate-700">
                    {row.occupiedWindows
                      .map((window) => `${window.start}–${window.end}`)
                      .join(", ")}
                  </div>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      </div>
    </div>
  );
}

function ConflictTable({ rows }: { rows: ClassroomDateConflict[] }) {
  const { t } = useLanguage();

  return (
    <div className="card">
      <div className="card-body">
        <DataTable
          rows={rows}
          rowKey={(row) =>
            `${row.roomCode}|${row.moduleInstanceCodeA}|${row.moduleInstanceCodeB}|${row.overlapStart}`
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
