import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

import { parseIsoDate } from "../lib/academicCalendar";
import { weekdayLabel } from "../lib/dailyTimetable";
import { dailyEntryLabelSortKey } from "../lib/dailyTimetableEntrySort";
import { dedupeJoinedModuleName } from "../lib/moduleDisplay";
import { buildDayClassStartTimeOptions } from "../lib/timetableStartTimeOptions";
import { isBackupTimetableSession } from "../lib/dailyTimetableSessionLabels";
import { normalizeAcademicYear, sanitizeAcademicYearForFilename } from "../lib/utils";
import type { TimetableModuleRow } from "../types";
import { logExport } from "./exportService";
import { listTimetableModuleInstances } from "./timetableModuleInstanceService";
import {
  buildWeeklyTimetableGridFromSessions,
  collectWeeklyPlacements,
  type WeeklyPlacementRecord,
} from "./timetableManualScheduleService";
import { listTimetableModules } from "./timetableService";
import {
  listTimetableSessions,
  normalizeSessionDate,
  normalizeSessionTime,
  type TimetableScheduleTerm,
  type TimetableSessionRow,
} from "./timetableScheduleService";

const LABELLED_SESSION_RE = /^(L|T)\d+$/i;

const WEEKDAY_LABELS: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

export function isExportableDailyLabelledSession(session: TimetableSessionRow): boolean {
  if (session.status === "cancel") return false;

  if (
    isBackupTimetableSession({
      status: session.status,
      session_label: session.session_label,
    })
  ) {
    return false;
  }

  return LABELLED_SESSION_RE.test(String(session.session_label ?? "").trim());
}

function formatTime(value: string) {
  return normalizeSessionTime(value).slice(0, 5);
}

function sessionWeekdayLabel(sessionDate: string) {
  const parsed = parseIsoDate(normalizeSessionDate(sessionDate));
  return parsed ? weekdayLabel(parsed.getDay()) : "";
}

function compareWeeklyPlacements(a: WeeklyPlacementRecord, b: WeeklyPlacementRecord) {
  if (a.weekday !== b.weekday) return a.weekday - b.weekday;
  if (a.start !== b.start) return a.start.localeCompare(b.start);
  if (a.end !== b.end) return a.end.localeCompare(b.end);

  const programmeCompare = a.programmeCode.localeCompare(b.programmeCode);
  if (programmeCompare !== 0) return programmeCompare;

  const streamCompare = a.streamCode.localeCompare(b.streamCode);
  if (streamCompare !== 0) return streamCompare;

  return a.moduleInstanceCode.localeCompare(b.moduleInstanceCode);
}

function weeklyPlacementToRow(
  placement: WeeklyPlacementRecord,
  academicYear: string,
  term: TimetableScheduleTerm
) {
  return {
    "Academic Year": academicYear,
    Term: term,
    Weekday: WEEKDAY_LABELS[placement.weekday] ?? String(placement.weekday),
    "Start Time": placement.start,
    "End Time": placement.end,
    "Time Slot": `${placement.start}–${placement.end}`,
    Room: placement.roomCode,
    "Programme Code": placement.programmeCode,
    "Stream Code": placement.streamCode,
    "Module Instance Code": placement.moduleInstanceCode,
    "Module Code": placement.moduleCode,
    "Module Name": dedupeJoinedModuleName(placement.moduleName),
    "Module Year": placement.moduleYear,
    Teacher: placement.teacherName || "TBC",
  };
}

function compareModuleInstance(a: TimetableModuleRow, b: TimetableModuleRow) {
  const programmeCompare = String(a.programme_code ?? "").localeCompare(
    String(b.programme_code ?? "")
  );
  if (programmeCompare !== 0) return programmeCompare;

  const streamCompare = String(a.stream_code ?? "").localeCompare(
    String(b.stream_code ?? "")
  );
  if (streamCompare !== 0) return streamCompare;

  return String(a.module_instance_code ?? "").localeCompare(
    String(b.module_instance_code ?? "")
  );
}

function compareDailySessions(
  a: { module: TimetableModuleRow; session: TimetableSessionRow },
  b: { module: TimetableModuleRow; session: TimetableSessionRow }
) {
  const moduleCompare = compareModuleInstance(a.module, b.module);
  if (moduleCompare !== 0) return moduleCompare;

  const labelKeyA = dailyEntryLabelSortKey({
    sessionNumber: a.session.session_number,
    sessionLabel: String(a.session.session_label ?? ""),
    isBackup: false,
    status: a.session.status,
    remark: a.session.remark ?? null,
  });
  const labelKeyB = dailyEntryLabelSortKey({
    sessionNumber: b.session.session_number,
    sessionLabel: String(b.session.session_label ?? ""),
    isBackup: false,
    status: b.session.status,
    remark: b.session.remark ?? null,
  });
  if (labelKeyA !== labelKeyB) return labelKeyA - labelKeyB;

  const dateCompare = normalizeSessionDate(a.session.session_date).localeCompare(
    normalizeSessionDate(b.session.session_date)
  );
  if (dateCompare !== 0) return dateCompare;

  return formatTime(a.session.start_time).localeCompare(
    formatTime(b.session.start_time)
  );
}

function buildDailyTimetableSheetRows(
  dailyRows: Array<{ module: TimetableModuleRow; session: TimetableSessionRow }>,
  academicYear: string,
  term: TimetableScheduleTerm
) {
  const header = [
    "Academic Year",
    "Term",
    "Programme Code",
    "Stream Code",
    "Module Instance Code",
    "Module Code",
    "Module Name",
    "Session Label",
    "Session Kind",
    "Weekday",
    "Session Date",
    "Start Time",
    "End Time",
    "Room",
    "Teacher",
    "Status",
    "Remark",
  ];

  const rows: Array<Array<string | number>> = [header];
  let lastModuleId: string | null = null;

  for (const { module, session } of dailyRows) {
    if (lastModuleId && lastModuleId !== module.id) {
      rows.push([]);
    }
    lastModuleId = module.id;

    const isoDate = normalizeSessionDate(session.session_date);

    rows.push([
      academicYear,
      term,
      module.programme_code,
      module.stream_code,
      module.module_instance_code,
      session.module_code || module.base_module_code || "",
      dedupeJoinedModuleName(session.module_name ?? module.module_name) || "",
      session.session_label ?? "",
      session.session_kind ?? "",
      sessionWeekdayLabel(isoDate),
      isoDate,
      formatTime(session.start_time),
      formatTime(session.end_time),
      session.room_code,
      session.teacher_name ?? "",
      session.status,
      session.remark ?? "",
    ]);
  }

  return rows;
}

export async function downloadWeeklyDailyTimetableExcel(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  /** app_users.id when available */
  exportedByUserId?: string | null;
  exportedByLabel?: string | null;
}) {
  const academicYear = normalizeAcademicYear(params.academicYear);
  const startTimeOptions = buildDayClassStartTimeOptions();

  const [timetableModules, sessions, instances] = await Promise.all([
    listTimetableModules({ academicYear }),
    listTimetableSessions({ academicYear }),
    listTimetableModuleInstances({ academicYear }),
  ]);

  const modulesForTerm = timetableModules.filter(
    (row) => row.module_term === params.term
  );
  const moduleById = new Map(modulesForTerm.map((row) => [row.id, row] as const));
  const moduleByInstanceCode = new Map(
    modulesForTerm.map((row) => [
      String(row.module_instance_code ?? "").trim(),
      row,
    ] as const)
  );

  const instancesForTerm = instances.filter(
    (row) => row.module_term === params.term
  );

  const weeklyGrid = buildWeeklyTimetableGridFromSessions({
    term: params.term,
    sessions,
    moduleByInstanceCode,
    timetableInstances: instancesForTerm,
    preferredStartByCode: {},
    startTimeOptions,
  });

  const weeklyPlacements = collectWeeklyPlacements(weeklyGrid).sort(
    compareWeeklyPlacements
  );
  const weeklyPlacementCount = weeklyPlacements.length;

  const dailyRows: Array<{
    module: TimetableModuleRow;
    session: TimetableSessionRow;
  }> = [];

  for (const session of sessions) {
    const module = moduleById.get(session.timetable_module_id);
    if (!module) continue;

    if (isExportableDailyLabelledSession(session)) {
      dailyRows.push({ module, session });
    }
  }

  dailyRows.sort(compareDailySessions);

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      {
        "Academic Year": academicYear,
        Term: params.term,
        "Exported By": params.exportedByLabel ?? params.exportedByUserId ?? "",
        "Exported At": new Date().toISOString(),
        "Modules In Term": modulesForTerm.length,
        "Weekly Placements": weeklyPlacementCount,
        "Daily Sessions (L/T)": dailyRows.length,
      },
    ]),
    "Summary"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      weeklyPlacements.map((placement) =>
        weeklyPlacementToRow(placement, academicYear, params.term)
      )
    ),
    "Weekly Timetable"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(
      buildDailyTimetableSheetRows(dailyRows, academicYear, params.term)
    ),
    "Daily Timetable"
  );

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const fileName = `HKIT_Weekly_Daily_Timetable_${sanitizeAcademicYearForFilename(
    academicYear
  )}_${params.term}.xlsx`;

  saveAs(new Blob([buffer]), fileName);

  await logExport({
    exportType: "timetable_excel",
    academicYear,
    exportedBy: params.exportedByUserId ?? null,
    exportedByLabel: params.exportedByLabel ?? null,
    metadata: {
      kind: "weekly_daily_timetable",
      term: params.term,
      weeklyPlacementCount,
      dailySessionCount: dailyRows.length,
    },
  });
}
