// src/services/adminAssignmentMonitorService.ts

import { supabase } from "../lib/supabase";
import { normalizeStream } from "../lib/utils";

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
  base_module_code: string | null;
  module_instance_code: string;
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
      base_module_code,
      module_instance_code,
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
    .order("base_module_code", { ascending: true });

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
      module_code: module.base_module_code ?? module.module_instance_code,
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

export type PipelineStageStatus = "pending" | "in_progress" | "complete";

export type ProgrammePipelineProgress = {
  programmeCode: string;
  streamCode: string;
  planningModuleCount: number;
  studentNumbersStatus: PipelineStageStatus;
  studentNumbersReadyCount: number;
  combineStatus: PipelineStageStatus;
  splitStatus: PipelineStageStatus;
  splitReadyCount: number;
  assignmentStatus: PipelineStageStatus;
  timetableModuleCount: number;
  confirmedAssignmentCount: number;
};

function stageFromCounts(ready: number, total: number): PipelineStageStatus {
  if (total === 0) return "pending";
  if (ready >= total) return "complete";
  if (ready > 0) return "in_progress";

  return "pending";
}

export async function getProgrammePipelineProgress(
  academicYear: string
): Promise<ProgrammePipelineProgress[]> {
  if (!academicYear) {
    throw new Error("Academic year is required.");
  }

  const [
    { data: planningRows, error: planningError },
    { data: studentNumberRows, error: studentNumberError },
    { data: timetableRows, error: timetableError },
  ] = await Promise.all([
    supabase
      .from("timetable_planning_modules")
      .select("id, programme_code, stream_code, split_status, module_code, module_term")
      .eq("academic_year", academicYear),
    supabase
      .from("timetable_student_numbers")
      .select(
        "module_code, programme_code, programme_stream, study_term, actual_student_number, academic_year"
      )
      .eq("academic_year", academicYear),
    supabase
      .from("timetable_modules")
      .select("id, programme_code, stream_code, assignment_confirmed, planning_module_id")
      .eq("academic_year", academicYear),
  ]);

  if (planningError) throw planningError;
  if (studentNumberError) throw studentNumberError;
  if (timetableError) throw timetableError;

  const studentNumberReadyKeys = new Set<string>();

  for (const row of studentNumberRows ?? []) {
    if (row.actual_student_number === null || row.actual_student_number === undefined) {
      continue;
    }

    studentNumberReadyKeys.add(
      [
        row.programme_code,
        normalizeStream(row.programme_stream),
        row.module_code,
      ].join("|")
    );
  }

  const grouped = new Map<string, ProgrammePipelineProgress>();

  for (const planning of planningRows ?? []) {
    const programmeCode = String(planning.programme_code ?? "").trim();
    const streamCode = String(planning.stream_code ?? "nil").trim() || "nil";
    const groupKey = `${programmeCode}|${streamCode}`;

    const existing = grouped.get(groupKey) ?? {
      programmeCode,
      streamCode,
      planningModuleCount: 0,
      studentNumbersStatus: "pending" as PipelineStageStatus,
      studentNumbersReadyCount: 0,
      combineStatus: "pending" as PipelineStageStatus,
      splitStatus: "pending" as PipelineStageStatus,
      splitReadyCount: 0,
      assignmentStatus: "pending" as PipelineStageStatus,
      timetableModuleCount: 0,
      confirmedAssignmentCount: 0,
    };

    existing.planningModuleCount += 1;

    const studentKey = [
      programmeCode,
      normalizeStream(streamCode),
      planning.module_code,
    ].join("|");

    if (studentNumberReadyKeys.has(studentKey)) {
      existing.studentNumbersReadyCount += 1;
    }

    if (planning.split_status && planning.split_status !== "not_started") {
      existing.splitReadyCount += 1;
    }

    grouped.set(groupKey, existing);
  }

  for (const timetable of timetableRows ?? []) {
    const programmeCode = String(timetable.programme_code ?? "").trim();
    const streamCode = String(timetable.stream_code ?? "nil").trim() || "nil";
    const groupKey = `${programmeCode}|${streamCode}`;

    const existing = grouped.get(groupKey) ?? {
      programmeCode,
      streamCode,
      planningModuleCount: 0,
      studentNumbersStatus: "pending" as PipelineStageStatus,
      studentNumbersReadyCount: 0,
      combineStatus: "pending" as PipelineStageStatus,
      splitStatus: "pending" as PipelineStageStatus,
      splitReadyCount: 0,
      assignmentStatus: "pending" as PipelineStageStatus,
      timetableModuleCount: 0,
      confirmedAssignmentCount: 0,
    };

    existing.timetableModuleCount += 1;

    if (timetable.assignment_confirmed) {
      existing.confirmedAssignmentCount += 1;
    }

    grouped.set(groupKey, existing);
  }

  return Array.from(grouped.values())
    .map((row) => {
      const studentNumbersStatus = stageFromCounts(
        row.studentNumbersReadyCount,
        row.planningModuleCount
      );

      const combineStatus: PipelineStageStatus =
        row.timetableModuleCount > 0
          ? "complete"
          : studentNumbersStatus === "complete"
            ? "in_progress"
            : "pending";

      const splitStatus = stageFromCounts(
        row.splitReadyCount,
        row.planningModuleCount
      );

      const assignmentStatus = stageFromCounts(
        row.confirmedAssignmentCount,
        row.timetableModuleCount
      );

      return {
        ...row,
        studentNumbersStatus,
        combineStatus,
        splitStatus,
        assignmentStatus,
      };
    })
    .sort((a, b) => {
      const codeDiff = a.programmeCode.localeCompare(b.programmeCode);

      if (codeDiff !== 0) return codeDiff;

      return a.streamCode.localeCompare(b.streamCode);
    });
}
