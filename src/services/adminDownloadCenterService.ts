import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

import { normalizeProgrammeYear } from "../lib/programmeYear";
import {
  getModuleTermOrder,
  getModuleYearOrder,
  isTBC,
  normalizeAcademicYear,
  normalizeStream,
  sanitizeAcademicYearForFilename,
} from "../lib/utils";
import type { ModuleTerm, TeachingAssignmentRow, TimetableModuleRow, UserRole } from "../types";
import { listAssignments } from "./assignmentService";
import { loadEnrolledClassSizeByInstanceCode } from "./studyPlanEnrollmentService";
import {
  listClassroomNotAvailableForRooms,
} from "./timetableClassroomService";
import {
  listTimetableClassrooms,
} from "./timetableScheduleService";
import {
  listTimetableModuleInstances,
  type TimetableModuleInstanceRow,
} from "./timetableModuleInstanceService";
import { listTimetableModules } from "./timetableService";

export type AdminOfferingExportRow = {
  academicYear: string;
  programmeCode: string;
  streamCode: string;
  moduleCode: string;
  moduleName: string;
  moduleYear: string;
  moduleTerm: string;
  moduleInstanceCode: string;
  mode: string;
  assignedTeacher: string;
  teachingStatus: string;
  actualClassSize: number | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function excelSheetName(label: string, used: Set<string>) {
  const raw = normalizeText(label) || "Unknown";
  let base = raw.replace(/[\\/?*[\]:]/g, "_").slice(0, 31);
  if (!base) base = "Unknown";

  let name = base;
  let suffix = 2;
  while (used.has(name.toUpperCase())) {
    const tag = `_${suffix}`;
    name = `${base.slice(0, Math.max(1, 31 - tag.length))}${tag}`;
    suffix += 1;
  }
  used.add(name.toUpperCase());
  return name;
}

function pickTeacher(
  instanceTeacher: string | null | undefined,
  assignmentTeacher: string | null | undefined
) {
  const instance = normalizeText(instanceTeacher);
  if (instance && !isTBC(instance)) return instance;
  const assignment = normalizeText(assignmentTeacher);
  if (assignment && !isTBC(assignment)) return assignment;
  return instance || assignment || "TBC";
}

function pickMode(
  instanceMode: string | null | undefined,
  moduleMode: string | null | undefined
) {
  return normalizeText(instanceMode) || normalizeText(moduleMode) || "";
}

function bestAssignmentByModuleId(assignments: TeachingAssignmentRow[]) {
  const best = new Map<string, TeachingAssignmentRow>();

  for (const row of assignments) {
    const moduleId = normalizeText(row.timetable_module_id);
    if (!moduleId) continue;

    const existing = best.get(moduleId);
    if (!existing) {
      best.set(moduleId, row);
      continue;
    }

    const existingConfirmed = Boolean(existing.confirmed);
    const nextConfirmed = Boolean(row.confirmed);
    if (nextConfirmed && !existingConfirmed) {
      best.set(moduleId, row);
      continue;
    }
    if (existingConfirmed && !nextConfirmed) continue;

    const existingVersion = Number(existing.assignment_version ?? 0);
    const nextVersion = Number(row.assignment_version ?? 0);
    if (nextVersion > existingVersion) {
      best.set(moduleId, row);
      continue;
    }
    if (nextVersion < existingVersion) continue;

    if (
      String(row.updated_at ?? "").localeCompare(String(existing.updated_at ?? "")) >
      0
    ) {
      best.set(moduleId, row);
    }
  }

  return best;
}

function offeringToExcelObject(row: AdminOfferingExportRow) {
  return {
    "Academic Year": row.academicYear,
    "Programme Code": row.programmeCode,
    Stream: row.streamCode || "nil",
    "Module Code": row.moduleCode,
    "Module Name": row.moduleName,
    Year: row.moduleYear,
    Term: row.moduleTerm,
    "Class Instance": row.moduleInstanceCode,
    Mode: row.mode,
    "Assigned Teacher": row.assignedTeacher,
    "Teaching Status": row.teachingStatus,
    "Actual Class Size": row.actualClassSize ?? "",
  };
}

function sortOfferings(rows: AdminOfferingExportRow[]) {
  return [...rows].sort((a, b) => {
    const programme = a.programmeCode.localeCompare(b.programmeCode);
    if (programme !== 0) return programme;

    const stream = (a.streamCode || "nil").localeCompare(b.streamCode || "nil");
    if (stream !== 0) return stream;

    const year =
      getModuleYearOrder(a.moduleYear) - getModuleYearOrder(b.moduleYear);
    if (year !== 0) return year;

    const term =
      getModuleTermOrder(a.moduleTerm) - getModuleTermOrder(b.moduleTerm);
    if (term !== 0) return term;

    return a.moduleInstanceCode.localeCompare(b.moduleInstanceCode);
  });
}

export async function buildAdminOfferingExportRows(params: {
  academicYear: string;
  programmeCode?: string;
}): Promise<AdminOfferingExportRow[]> {
  const academicYear = normalizeAcademicYear(params.academicYear);
  const programmeFilter = normalizeText(params.programmeCode).toUpperCase();
  const terms: ModuleTerm[] = ["Sep", "Feb", "Jun"];

  const [instances, modules, assignments, ...enrolledMaps] = await Promise.all([
    listTimetableModuleInstances({ academicYear }),
    listTimetableModules({ academicYear }),
    listAssignments(academicYear),
    ...terms.map((offeredTerm) =>
      loadEnrolledClassSizeByInstanceCode({
        academicYear,
        offeredTerm,
        includeBridging: true,
      })
    ),
  ]);

  /** Live study-plan headcount by enrolled class (same as weekly actual size). */
  const enrolledCountByInstance = new Map<string, number>();
  for (const map of enrolledMaps) {
    for (const [code, count] of map) {
      enrolledCountByInstance.set(
        code,
        Math.max(enrolledCountByInstance.get(code) ?? 0, count)
      );
    }
  }

  const moduleByInstance = new Map<string, TimetableModuleRow>();
  for (const module of modules) {
    const code = normalizeText(module.module_instance_code).toUpperCase();
    if (code) moduleByInstance.set(code, module);
  }

  const assignmentByModuleId = bestAssignmentByModuleId(assignments);

  const rows: AdminOfferingExportRow[] = [];

  for (const instance of instances as TimetableModuleInstanceRow[]) {
    const instanceCode = normalizeText(instance.module_instance_code);
    if (!instanceCode) continue;

    const module = moduleByInstance.get(instanceCode.toUpperCase());
    const programmeCode = normalizeText(module?.programme_code) || "Unknown";

    if (programmeFilter && programmeCode.toUpperCase() !== programmeFilter) {
      continue;
    }

    const assignment = module
      ? assignmentByModuleId.get(module.id)
      : undefined;

    const liveCount = enrolledCountByInstance.get(instanceCode.toUpperCase());
    const actualClassSize =
      liveCount != null && liveCount > 0
        ? liveCount
        : null;

    rows.push({
      academicYear,
      programmeCode,
      streamCode: normalizeStream(module?.stream_code ?? "nil"),
      moduleCode:
        normalizeText(module?.base_module_code) ||
        normalizeText(instance.module_code),
      moduleName:
        normalizeText(module?.module_name) ||
        normalizeText(instance.module_name),
      moduleYear: normalizeProgrammeYear(module?.module_year) ?? "",
      moduleTerm: normalizeText(instance.module_term || module?.module_term),
      moduleInstanceCode: instanceCode,
      mode: pickMode(instance.instance_mode, module?.mode),
      assignedTeacher: pickTeacher(
        instance.instance_teacher_name,
        assignment?.teacher_name
      ),
      teachingStatus: normalizeText(assignment?.teaching_status),
      actualClassSize,
    });
  }

  return sortOfferings(rows);
}

/**
 * Admin-only: class offerings for an academic year.
 * One row per class instance (teacher, mode, instance code, class size).
 * Workbook: Index + one sheet per programme.
 */
export async function downloadAdminModuleOfferingsExcel(params: {
  academicYear: string;
  programmeCode?: string;
  role?: UserRole | null;
}): Promise<{
  programmeCount: number;
  classCount: number;
}> {
  if (params.role !== "admin") {
    throw new Error("Only Admin can download module offerings.");
  }

  const rows = await buildAdminOfferingExportRows({
    academicYear: params.academicYear,
    programmeCode: params.programmeCode,
  });

  if (rows.length === 0) {
    throw new Error(
      "No class instances found for this academic year (and programme filter)."
    );
  }

  const byProgramme = new Map<string, AdminOfferingExportRow[]>();
  for (const row of rows) {
    const list = byProgramme.get(row.programmeCode) ?? [];
    list.push(row);
    byProgramme.set(row.programmeCode, list);
  }

  const programmeCodes = Array.from(byProgramme.keys()).sort((a, b) =>
    a.localeCompare(b)
  );

  const workbook = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      programmeCodes.map((code) => ({
        "Programme Code": code,
        "Class Count": byProgramme.get(code)?.length ?? 0,
      }))
    ),
    excelSheetName("Index", usedSheetNames)
  );

  for (const code of programmeCodes) {
    const list = byProgramme.get(code) ?? [];
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(list.map((row) => offeringToExcelObject(row))),
      excelSheetName(code, usedSheetNames)
    );
  }

  const buffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  });

  const ay = sanitizeAcademicYearForFilename(params.academicYear);
  const programmePart = normalizeText(params.programmeCode) || "ALL";
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  saveAs(
    new Blob([buffer]),
    `HKIT_Module_Offerings_${ay}_${programmePart}_${dateStamp}.xlsx`
  );

  return {
    programmeCount: programmeCodes.length,
    classCount: rows.length,
  };
}

const CLASSROOM_AVAILABILITY_PERIODS = ["AM", "PM", "EVENING"] as const;
const CLASSROOM_AVAILABILITY_WEEKDAYS: Array<{
  id: 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
}> = [
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
];

/**
 * Admin-only: classroom master list + weekly availability (Not Available grid).
 * Same source as Make Timetable → Classroom Management.
 */
export async function downloadAdminClassroomAvailabilityExcel(params: {
  academicYear: string;
  role?: UserRole | null;
}): Promise<{ roomCount: number; notAvailableCount: number }> {
  if (params.role !== "admin") {
    throw new Error("Only Admin can download classroom availability.");
  }

  const academicYear = normalizeAcademicYear(params.academicYear);
  const classrooms = await listTimetableClassrooms();
  const rooms = [...classrooms].sort((a, b) =>
    a.room_code.localeCompare(b.room_code)
  );

  if (rooms.length === 0) {
    throw new Error("No classrooms found.");
  }

  const naRows = await listClassroomNotAvailableForRooms({
    academicYear,
    roomCodes: rooms.map((room) => room.room_code),
  });

  const naKeySet = new Set(
    naRows.map(
      (row) =>
        `${normalizeText(row.room_code).toUpperCase()}|${row.weekday}|${row.period}`
    )
  );

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      rooms.map((room) => ({
        "Room Code": room.room_code,
        Location: room.location,
        "Room Number": room.room_number,
        "Room Size": room.room_size,
        "Room Type": room.room_type,
      }))
    ),
    "Rooms"
  );

  const matrixRows = rooms.map((room) => {
    const row: Record<string, string | number> = {
      "Room Code": room.room_code,
      Location: room.location,
      "Room Size": room.room_size,
      "Room Type": room.room_type,
    };

    for (const day of CLASSROOM_AVAILABILITY_WEEKDAYS) {
      for (const period of CLASSROOM_AVAILABILITY_PERIODS) {
        const key = `${room.room_code.toUpperCase()}|${day.id}|${period}`;
        row[`${day.label} ${period}`] = naKeySet.has(key)
          ? "Not Available"
          : "Available";
      }
    }

    return row;
  });

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(matrixRows),
    "Weekly Availability"
  );

  const naList = naRows
    .map((row) => {
      const day =
        CLASSROOM_AVAILABILITY_WEEKDAYS.find((item) => item.id === row.weekday)
          ?.label ?? String(row.weekday);
      return {
        "Academic Year": academicYear,
        "Room Code": row.room_code,
        Weekday: day,
        Period: row.period,
        Status: "Not Available",
      };
    })
    .sort((a, b) => {
      const room = String(a["Room Code"]).localeCompare(String(b["Room Code"]));
      if (room !== 0) return room;
      return String(a.Weekday).localeCompare(String(b.Weekday));
    });

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      naList.length > 0
        ? naList
        : [
            {
              "Academic Year": academicYear,
              "Room Code": "",
              Weekday: "",
              Period: "",
              Status: "No Not Available slots recorded",
            },
          ]
    ),
    "Not Available List"
  );

  const buffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  });

  const ay = sanitizeAcademicYearForFilename(academicYear);
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  saveAs(
    new Blob([buffer]),
    `HKIT_Classroom_Availability_${ay}_${dateStamp}.xlsx`
  );

  return {
    roomCount: rooms.length,
    notAvailableCount: naRows.length,
  };
}
