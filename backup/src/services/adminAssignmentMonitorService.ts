// src/services/adminAssignmentMonitorService.ts

import { supabase } from "../lib/supabase";

export type AssignmentMonitorModule = {
  timetable_module_id: string;
  module_code: string | null;
  module_name: string | null;
  module_term: string | null;
  programme_code: string | null;
  stream_code: string | null;
  academic_year: string;
  assignment_confirmed: boolean;
  assigned_teacher_names: string[];
  has_tbc_teacher: boolean;
  assignment_count: number;
};

export type AssignmentMonitorSummary = {
  academicYear: string;
  totalModules: number;
  confirmedModules: number;
  pendingModules: number;
  modulesWithTbcTeacher: number;
  allConfirmed: boolean;
  canUpdateTeacherLoading: boolean;
};

export type AssignmentMonitorResult = {
  summary: AssignmentMonitorSummary;
  confirmedModules: AssignmentMonitorModule[];
  pendingModules: AssignmentMonitorModule[];
};

type TimetableModuleMonitorRow = {
  id: string;
  module_code: string | null;
  module_name: string | null;
  module_term: string | null;
  programme_code: string | null;
  stream_code: string | null;
  academic_year: string;
  assignment_confirmed: boolean | null;
};

type TeachingAssignmentMonitorRow = {
  id: string;
  timetable_module_id: string;
  teacher_name: string | null;
  confirmed: boolean | null;
  assignment_version: number | null;
};

function normalizeTeacherName(name: string | null | undefined): string {
  return (name ?? "").trim();
}

function isTbcTeacher(name: string | null | undefined): boolean {
  const normalized = normalizeTeacherName(name).toUpperCase();

  return normalized === "" || normalized === "TBC";
}

export async function getAssignmentConfirmationMonitor(
  academicYear: string
): Promise<AssignmentMonitorResult> {
  if (!academicYear) {
    throw new Error("Academic year is required.");
  }

  const { data: modules, error: modulesError } = await supabase
    .from("timetable_modules")
    .select(
      `
      id,
      module_code,
      module_name,
      module_term,
      programme_code,
      stream_code,
      academic_year,
      assignment_confirmed
    `
    )
    .eq("academic_year", academicYear)
    .order("module_term", { ascending: true })
    .order("module_code", { ascending: true });

  if (modulesError) {
    throw modulesError;
  }

  const moduleRows = (modules ?? []) as TimetableModuleMonitorRow[];

  if (moduleRows.length === 0) {
    return {
      summary: {
        academicYear,
        totalModules: 0,
        confirmedModules: 0,
        pendingModules: 0,
        modulesWithTbcTeacher: 0,
        allConfirmed: false,
        canUpdateTeacherLoading: false,
      },
      confirmedModules: [],
      pendingModules: [],
    };
  }

  const moduleIds = moduleRows.map((module) => module.id);

  const { data: assignments, error: assignmentsError } = await supabase
    .from("teaching_assignments")
    .select(
      `
      id,
      timetable_module_id,
      teacher_name,
      confirmed,
      assignment_version
    `
    )
    .in("timetable_module_id", moduleIds)
    .eq("confirmed", true);

  if (assignmentsError) {
    throw assignmentsError;
  }

  const assignmentRows =
    (assignments ?? []) as TeachingAssignmentMonitorRow[];

  const assignmentsByModuleId = new Map<
    string,
    TeachingAssignmentMonitorRow[]
  >();

  for (const assignment of assignmentRows) {
    const current =
      assignmentsByModuleId.get(assignment.timetable_module_id) ?? [];

    current.push(assignment);
    assignmentsByModuleId.set(assignment.timetable_module_id, current);
  }

  const monitorModules: AssignmentMonitorModule[] = moduleRows.map((module) => {
    const moduleAssignments = assignmentsByModuleId.get(module.id) ?? [];

    const assignedTeacherNames = Array.from(
      new Set(
        moduleAssignments
          .map((assignment) => normalizeTeacherName(assignment.teacher_name))
          .filter(Boolean)
      )
    );

    const hasTbcTeacher =
      moduleAssignments.length === 0 ||
      moduleAssignments.some((assignment) =>
        isTbcTeacher(assignment.teacher_name)
      );

    return {
      timetable_module_id: module.id,
      module_code: module.module_code,
      module_name: module.module_name,
      module_term: module.module_term,
      programme_code: module.programme_code,
      stream_code: module.stream_code,
      academic_year: module.academic_year,
      assignment_confirmed: Boolean(module.assignment_confirmed),
      assigned_teacher_names: assignedTeacherNames,
      has_tbc_teacher: hasTbcTeacher,
      assignment_count: moduleAssignments.length,
    };
  });

  const confirmedModules = monitorModules.filter(
    (module) => module.assignment_confirmed
  );

  const pendingModules = monitorModules.filter(
    (module) => !module.assignment_confirmed
  );

  const modulesWithTbcTeacher = confirmedModules.filter(
    (module) => module.has_tbc_teacher
  ).length;

  const summary: AssignmentMonitorSummary = {
    academicYear,
    totalModules: monitorModules.length,
    confirmedModules: confirmedModules.length,
    pendingModules: pendingModules.length,
    modulesWithTbcTeacher,
    allConfirmed: monitorModules.length > 0 && pendingModules.length === 0,
    canUpdateTeacherLoading:
      monitorModules.length > 0 &&
      pendingModules.length === 0 &&
      modulesWithTbcTeacher === 0,
  };

  return {
    summary,
    confirmedModules,
    pendingModules,
  };
}
