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
import type { TeachingAssignmentRow, TimetableModuleRow, UserRole } from "../types";
import { listAssignments } from "./assignmentService";
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
  expectedClassSize: number | null;
  actualClassSize: number | null;
  combineType: string;
  combinedCode: string;
  splitGroupSize: number | null;
  instanceIndex: number | null;
  assignmentConfirmed: boolean;
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
    "Expected Class Size": row.expectedClassSize ?? "",
    "Actual Class Size": row.actualClassSize ?? "",
    "Combine Type": row.combineType,
    "Combined Code": row.combinedCode,
    "Split Group Size": row.splitGroupSize ?? "",
    "Instance Index": row.instanceIndex ?? "",
    "Assignment Confirmed": row.assignmentConfirmed ? "Yes" : "No",
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

  const [instances, modules, assignments] = await Promise.all([
    listTimetableModuleInstances({ academicYear }),
    listTimetableModules({ academicYear }),
    listAssignments(academicYear),
  ]);

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

    const expectedSize =
      instance.instance_expected_size != null
        ? Number(instance.instance_expected_size)
        : module?.expected_student_number != null
          ? Number(module.expected_student_number)
          : null;

    const actualSize =
      instance.instance_actual_size != null
        ? Number(instance.instance_actual_size)
        : module?.actual_student_number != null
          ? Number(module.actual_student_number)
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
      expectedClassSize: Number.isFinite(expectedSize as number)
        ? (expectedSize as number)
        : null,
      actualClassSize: Number.isFinite(actualSize as number)
        ? (actualSize as number)
        : null,
      combineType: normalizeText(module?.combine_type) || "none",
      combinedCode: normalizeText(module?.combined_code),
      splitGroupSize:
        instance.split_group_size != null
          ? Number(instance.split_group_size)
          : null,
      instanceIndex:
        instance.instance_index != null
          ? Number(instance.instance_index)
          : null,
      assignmentConfirmed: Boolean(
        module?.assignment_confirmed || assignment?.confirmed
      ),
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
