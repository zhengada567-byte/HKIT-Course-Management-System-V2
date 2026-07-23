import { isTBC } from "../lib/utils";
import type { EmploymentType, ModuleTerm, TeacherRow } from "../types";
import { saveAs } from "file-saver";
import {
  canonicalizeTeacherNameForLoading,
  listTeachers,
  resolveTeacherEmploymentFromCatalog,
} from "./teacherService";
import {
  listTimetableSessions,
  type TimetableSessionRow,
} from "./timetableScheduleService";
import { listTimetableModules } from "./timetableService";

export type TeacherContactHoursTermFilter = "All" | ModuleTerm;

export interface TeacherContactHoursModuleRow {
  timetable_module_id: string;
  module_instance_code: string;
  module_code: string;
  module_name: string | null;
  programme_code: string;
  module_term: ModuleTerm;
  session_count: number;
  total_hours: number;
  lecture_hours: number;
  tutorial_hours: number;
}

export interface TeacherContactHoursRow {
  teacher_name: string;
  teacher_employment_type: EmploymentType | null;
  session_count: number;
  total_hours: number;
  lecture_hours: number;
  tutorial_hours: number;
  modules: TeacherContactHoursModuleRow[];
}

const NUMBERED_LT_LABEL_RE = /^(L|T)\d+$/i;

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function normalizeModuleTerm(value: string | null | undefined): ModuleTerm {
  const text = normalizeText(value).toUpperCase();

  if (text === "FEB" || text === "FEBRUARY" || text === "A") return "Feb";
  if (text === "JUN" || text === "JUNE" || text === "B") return "Jun";
  return "Sep";
}

function parseTimeToMinutes(time: string): number {
  const match = String(time ?? "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);

  if (!match) return Number.NaN;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return Number.NaN;
  }

  return hours * 60 + minutes;
}

/** Duration of a session in hours from start/end clock times. */
export function sessionDurationHours(startTime: string, endTime: string): number {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);

  if (
    !Number.isFinite(startMinutes) ||
    !Number.isFinite(endMinutes) ||
    endMinutes <= startMinutes
  ) {
    return 0;
  }

  return (endMinutes - startMinutes) / 60;
}

export function isNumberedLtSessionLabel(label: string | null | undefined) {
  return NUMBERED_LT_LABEL_RE.test(normalizeText(label));
}

function isLectureLabel(label: string, kind: string | null | undefined) {
  if (normalizeText(kind) === "teaching") return true;
  if (normalizeText(kind) === "tutorial") return false;
  return /^L\d+$/i.test(normalizeText(label));
}

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

/** Display hours with up to 2 decimals, trailing zeros stripped. */
export function formatContactHoursDisplay(value: number) {
  const rounded = roundHours(value);
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/\.?0+$/, "");
}

function matchesEmploymentFilter(
  teacherName: string,
  employmentType: EmploymentType,
  teachers: TeacherRow[]
) {
  const catalogEmployment = resolveTeacherEmploymentFromCatalog(
    teacherName,
    teachers
  );

  return catalogEmployment === employmentType;
}

/**
 * Sum actual session durations for numbered L/T sessions under each teacher.
 * - Cancel / backup (no L|T number) / empty|TBC teacher → excluded
 * - Attribution is per session.teacher_name (no assignment fallback)
 */
export async function getTeacherContactHoursSummary(params: {
  academicYear: string;
  employmentType: EmploymentType;
  term?: TeacherContactHoursTermFilter;
}): Promise<TeacherContactHoursRow[]> {
  const termFilter = params.term ?? "All";

  const [sessions, modules, teachers] = await Promise.all([
    listTimetableSessions({ academicYear: params.academicYear }),
    listTimetableModules({ academicYear: params.academicYear }),
    listTeachers(params.academicYear),
  ]);

  const moduleById = new Map(
    modules.map((module) => [module.id, module] as const)
  );

  type AccModule = TeacherContactHoursModuleRow;
  type AccTeacher = {
    teacher_name: string;
    teacher_employment_type: EmploymentType | null;
    session_count: number;
    total_hours: number;
    lecture_hours: number;
    tutorial_hours: number;
    modules: Map<string, AccModule>;
  };

  const byTeacher = new Map<string, AccTeacher>();

  for (const session of sessions as TimetableSessionRow[]) {
    if (session.status === "cancel") continue;
    if (!isNumberedLtSessionLabel(session.session_label)) continue;

    const rawTeacher = normalizeText(session.teacher_name);
    if (!rawTeacher || isTBC(rawTeacher)) continue;

    const teacherName = canonicalizeTeacherNameForLoading(rawTeacher, teachers);
    if (!teacherName || isTBC(teacherName)) continue;
    if (!matchesEmploymentFilter(teacherName, params.employmentType, teachers)) {
      continue;
    }

    const module = moduleById.get(session.timetable_module_id);
    const moduleTerm = normalizeModuleTerm(
      module?.module_term ?? null
    );

    if (termFilter !== "All" && moduleTerm !== termFilter) {
      continue;
    }

    const hours = sessionDurationHours(session.start_time, session.end_time);
    if (hours <= 0) continue;

    const isLecture = isLectureLabel(
      String(session.session_label ?? ""),
      session.session_kind
    );

    let teacherAcc = byTeacher.get(teacherName);
    if (!teacherAcc) {
      teacherAcc = {
        teacher_name: teacherName,
        teacher_employment_type: resolveTeacherEmploymentFromCatalog(
          teacherName,
          teachers
        ),
        session_count: 0,
        total_hours: 0,
        lecture_hours: 0,
        tutorial_hours: 0,
        modules: new Map(),
      };
      byTeacher.set(teacherName, teacherAcc);
    }

    teacherAcc.session_count += 1;
    teacherAcc.total_hours += hours;
    if (isLecture) {
      teacherAcc.lecture_hours += hours;
    } else {
      teacherAcc.tutorial_hours += hours;
    }

    const moduleKey = session.timetable_module_id || session.module_instance_code;
    let moduleAcc = teacherAcc.modules.get(moduleKey);

    if (!moduleAcc) {
      moduleAcc = {
        timetable_module_id: session.timetable_module_id,
        module_instance_code:
          normalizeText(module?.module_instance_code) ||
          normalizeText(session.module_instance_code),
        module_code:
          normalizeText(module?.base_module_code) ||
          normalizeText(session.module_code),
        module_name: module?.module_name ?? session.module_name,
        programme_code: normalizeText(module?.programme_code),
        module_term: moduleTerm,
        session_count: 0,
        total_hours: 0,
        lecture_hours: 0,
        tutorial_hours: 0,
      };
      teacherAcc.modules.set(moduleKey, moduleAcc);
    }

    moduleAcc.session_count += 1;
    moduleAcc.total_hours += hours;
    if (isLecture) {
      moduleAcc.lecture_hours += hours;
    } else {
      moduleAcc.tutorial_hours += hours;
    }
  }

  return [...byTeacher.values()]
    .map((teacher) => ({
      teacher_name: teacher.teacher_name,
      teacher_employment_type: teacher.teacher_employment_type,
      session_count: teacher.session_count,
      total_hours: roundHours(teacher.total_hours),
      lecture_hours: roundHours(teacher.lecture_hours),
      tutorial_hours: roundHours(teacher.tutorial_hours),
      modules: [...teacher.modules.values()]
        .map((module) => ({
          ...module,
          total_hours: roundHours(module.total_hours),
          lecture_hours: roundHours(module.lecture_hours),
          tutorial_hours: roundHours(module.tutorial_hours),
        }))
        .sort((a, b) => {
          const termOrder =
            { Sep: 1, Feb: 2, Jun: 3 }[a.module_term] -
            { Sep: 1, Feb: 2, Jun: 3 }[b.module_term];
          if (termOrder !== 0) return termOrder;
          return a.module_instance_code.localeCompare(b.module_instance_code);
        }),
    }))
    .sort((a, b) => a.teacher_name.localeCompare(b.teacher_name));
}

function escapeCsvCell(value: string) {
  const text = String(value ?? "");

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function rowsToCsv(headers: string[], rows: string[][]) {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
}

function sanitizeFilePart(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "export";
}

/** Download contact-hours detail CSV (one row per teacher × module). */
export function downloadTeacherContactHoursCsv(params: {
  rows: TeacherContactHoursRow[];
  academicYear: string;
  employmentType: EmploymentType;
  term: TeacherContactHoursTermFilter;
}) {
  const headers = [
    "Teacher",
    "Employment",
    "Term",
    "Programme",
    "Module Instance",
    "Module Code",
    "Module Name",
    "Sessions",
    "Lecture Hours",
    "Tutorial Hours",
    "Total Hours",
    "Teacher Total Hours",
  ];

  const csvRows: string[][] = [];

  for (const teacher of params.rows) {
    for (const module of teacher.modules) {
      csvRows.push([
        teacher.teacher_name,
        teacher.teacher_employment_type ?? "",
        module.module_term,
        module.programme_code,
        module.module_instance_code,
        module.module_code,
        module.module_name ?? "",
        String(module.session_count),
        formatContactHoursDisplay(module.lecture_hours),
        formatContactHoursDisplay(module.tutorial_hours),
        formatContactHoursDisplay(module.total_hours),
        formatContactHoursDisplay(teacher.total_hours),
      ]);
    }
  }

  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const fileName = [
    "teacher_contact_hours",
    sanitizeFilePart(params.academicYear),
    params.employmentType,
    sanitizeFilePart(params.term),
    dateStamp,
  ].join("_") + ".csv";

  saveAs(
    new Blob(["\uFEFF" + rowsToCsv(headers, csvRows)], {
      type: "text/csv;charset=utf-8;",
    }),
    fileName
  );

  return { fileName, rowCount: csvRows.length };
}
