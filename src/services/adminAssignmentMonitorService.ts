// src/services/adminAssignmentMonitorService.ts

import { supabase } from "../lib/supabase";
import { normalizeStream } from "../lib/utils";
import type { TimetablePlanningModuleRow } from "../types";
import { detectProgrammeIntraStreamCombineCandidates } from "./programmeIntraStreamCombineService";

export type AssignmentMonitorModule = {
  timetable_module_id: string | null;
  planning_module_id: string | null;
  module_code: string | null;
  module_name: string | null;
  module_term: string | null;
  programme_code: string | null;
  stream_code: string | null;
  academic_year: string;
  split_complete: boolean;
  assigned_teacher_names: string[];
  has_tbc_teacher: boolean;
};

export type AssignmentMonitorSummary = {
  academicYear: string;
  totalPlanningModules: number;
  splitCompleteModules: number;
  pendingSplitModules: number;
  splitTimetableInstanceCount: number;
  modulesWithTbcTeacher: number;
  allSplitComplete: boolean;
  canUpdateTeacherLoading: boolean;
};

export type AssignmentMonitorResult = {
  summary: AssignmentMonitorSummary;
  splitCompleteModules: AssignmentMonitorModule[];
  pendingSplitModules: AssignmentMonitorModule[];
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
  split_confirmed: boolean | null;
  planning_module_id: string | null;
};

type PlanningModuleMonitorRow = {
  id: string;
  module_code: string | null;
  module_name: string | null;
  module_term: string | null;
  programme_code: string | null;
  stream_code: string | null;
  academic_year: string;
  split_status: string | null;
};

type TeachingAssignmentMonitorRow = {
  id: string;
  timetable_module_id: string;
  teacher_name: string | null;
  teaching_status: string | null;
  confirmed: boolean | null;
  assignment_version: number | null;
};

function buildLatestMonitorAssignmentMap(
  assignmentRows: TeachingAssignmentMonitorRow[]
) {
  const latestAssignmentByModuleId = new Map<
    string,
    TeachingAssignmentMonitorRow
  >();

  for (const assignment of assignmentRows) {
    const existing = latestAssignmentByModuleId.get(assignment.timetable_module_id);
    const version = Number(assignment.assignment_version ?? 0);
    const existingVersion = Number(existing?.assignment_version ?? 0);

    if (!existing || version >= existingVersion) {
      latestAssignmentByModuleId.set(assignment.timetable_module_id, assignment);
    }
  }

  return latestAssignmentByModuleId;
}

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

  const [
    { data: planningRows, error: planningError },
    { data: modules, error: modulesError },
  ] = await Promise.all([
    supabase
      .from("timetable_planning_modules")
      .select(
        "id, module_code, module_name, module_term, programme_code, stream_code, academic_year, split_status"
      )
      .eq("academic_year", academicYear)
      .order("module_term", { ascending: true })
      .order("module_code", { ascending: true }),
    supabase
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
        assignment_confirmed,
        split_confirmed,
        planning_module_id
      `
      )
      .eq("academic_year", academicYear)
      .eq("split_confirmed", true)
      .order("module_term", { ascending: true })
      .order("base_module_code", { ascending: true }),
  ]);

  if (planningError) throw planningError;
  if (modulesError) throw modulesError;

  const planningModuleRows = (planningRows ?? []) as PlanningModuleMonitorRow[];
  const moduleRows = (modules ?? []) as TimetableModuleMonitorRow[];

  const pendingPlanningRows = planningModuleRows.filter(
    (row) => !row.split_status || row.split_status === "not_started"
  );

  const splitCompletePlanningCount =
    planningModuleRows.length - pendingPlanningRows.length;

  const pendingSplitModules: AssignmentMonitorModule[] = pendingPlanningRows.map(
    (row) => ({
      timetable_module_id: null,
      planning_module_id: row.id,
      module_code: row.module_code,
      module_name: row.module_name,
      module_term: row.module_term,
      programme_code: row.programme_code,
      stream_code: row.stream_code,
      academic_year: row.academic_year,
      split_complete: false,
      assigned_teacher_names: [],
      has_tbc_teacher: true,
    })
  );

  if (moduleRows.length === 0) {
    return {
      summary: {
        academicYear,
        totalPlanningModules: planningModuleRows.length,
        splitCompleteModules: splitCompletePlanningCount,
        pendingSplitModules: pendingPlanningRows.length,
        splitTimetableInstanceCount: 0,
        modulesWithTbcTeacher: 0,
        allSplitComplete:
          planningModuleRows.length > 0 && pendingPlanningRows.length === 0,
        canUpdateTeacherLoading: false,
      },
      splitCompleteModules: [],
      pendingSplitModules,
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
      teaching_status,
      confirmed,
      assignment_version
    `
    )
    .in("timetable_module_id", moduleIds)
    .order("assignment_version", { ascending: false });

  if (assignmentsError) {
    throw assignmentsError;
  }

  const latestAssignmentByModuleId = buildLatestMonitorAssignmentMap(
    (assignments ?? []) as TeachingAssignmentMonitorRow[]
  );

  const splitCompleteModules: AssignmentMonitorModule[] = moduleRows.map(
    (module) => {
      const latestAssignment = latestAssignmentByModuleId.get(module.id);
      const assignedTeacherNames = latestAssignment?.teacher_name
        ? [normalizeTeacherName(latestAssignment.teacher_name)].filter(Boolean)
        : [];

      const hasTbcTeacher =
        assignedTeacherNames.length === 0 ||
        assignedTeacherNames.some((name) => isTbcTeacher(name));

      return {
        timetable_module_id: module.id,
        planning_module_id: module.planning_module_id,
        module_code: module.base_module_code ?? module.module_instance_code,
        module_name: module.module_name,
        module_term: module.module_term,
        programme_code: module.programme_code,
        stream_code: module.stream_code,
        academic_year: module.academic_year,
        split_complete: true,
        assigned_teacher_names: assignedTeacherNames,
        has_tbc_teacher: hasTbcTeacher,
      };
    }
  );

  const modulesWithTbcTeacher = splitCompleteModules.filter(
    (module) => module.has_tbc_teacher
  ).length;

  const dbConfirmedCount = moduleRows.filter(
    (module) => module.assignment_confirmed
  ).length;

  const summary: AssignmentMonitorSummary = {
    academicYear,
    totalPlanningModules: planningModuleRows.length,
    splitCompleteModules: splitCompletePlanningCount,
    pendingSplitModules: pendingPlanningRows.length,
    splitTimetableInstanceCount: splitCompleteModules.length,
    modulesWithTbcTeacher,
    allSplitComplete:
      planningModuleRows.length > 0 && pendingPlanningRows.length === 0,
    canUpdateTeacherLoading:
      moduleRows.length > 0 &&
      pendingPlanningRows.length === 0 &&
      dbConfirmedCount === moduleRows.length &&
      modulesWithTbcTeacher === 0,
  };

  return {
    summary,
    splitCompleteModules,
    pendingSplitModules,
  };
}

export type PipelineStageStatus = "pending" | "in_progress" | "complete";

export type ProgrammePipelineProgress = {
  programmeCode: string;
  planningModuleCount: number;
  studentNumbersStatus: PipelineStageStatus;
  studentNumbersReadyCount: number;
  combineStatus: PipelineStageStatus;
  combineReadyCount: number;
  splitStatus: PipelineStageStatus;
  splitReadyCount: number;
};

function buildProgrammeNilStudentKey(
  programmeCode: string,
  moduleCode: string | null | undefined
) {
  return [programmeCode, "nil", moduleCode].join("|");
}

function emptyProgrammeProgress(programmeCode: string): ProgrammePipelineProgress {
  return {
    programmeCode,
    planningModuleCount: 0,
    studentNumbersStatus: "pending",
    studentNumbersReadyCount: 0,
    combineStatus: "pending",
    combineReadyCount: 0,
    splitStatus: "pending",
    splitReadyCount: 0,
  };
}

function resolveCombineMetrics(
  planningRows: TimetablePlanningModuleRow[]
): { combineReadyCount: number; combineStatus: PipelineStageStatus } {
  const pendingCombineIds = new Set(
    detectProgrammeIntraStreamCombineCandidates(planningRows).flatMap(
      (candidate) => candidate.modules.map((module) => module.id)
    )
  );

  const combineReadyCount = planningRows.filter(
    (row) => !pendingCombineIds.has(row.id)
  ).length;

  return {
    combineReadyCount,
    combineStatus: stageFromCounts(combineReadyCount, planningRows.length),
  };
}

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
  ] = await Promise.all([
    supabase
      .from("timetable_planning_modules")
      .select(
        "id, programme_code, stream_code, split_status, module_code, module_term, manual_combine_group_id, academic_year"
      )
      .eq("academic_year", academicYear),
    supabase
      .from("timetable_student_numbers")
      .select(
        "module_code, programme_code, programme_stream, study_term, actual_student_number, academic_year"
      )
      .eq("academic_year", academicYear),
  ]);

  if (planningError) throw planningError;
  if (studentNumberError) throw studentNumberError;

  const studentNumberReadyKeys = new Set<string>();

  for (const row of studentNumberRows ?? []) {
    if (row.actual_student_number === null || row.actual_student_number === undefined) {
      continue;
    }

    if (normalizeStream(row.programme_stream) !== "nil") {
      continue;
    }

    studentNumberReadyKeys.add(
      buildProgrammeNilStudentKey(
        String(row.programme_code ?? "").trim(),
        row.module_code
      )
    );
  }

  const planningByProgramme = new Map<string, TimetablePlanningModuleRow[]>();

  for (const planning of (planningRows ?? []) as TimetablePlanningModuleRow[]) {
    const programmeCode = String(planning.programme_code ?? "").trim();

    if (!programmeCode) continue;

    const bucket = planningByProgramme.get(programmeCode) ?? [];
    bucket.push(planning);
    planningByProgramme.set(programmeCode, bucket);
  }

  const grouped = new Map<string, ProgrammePipelineProgress>();

  for (const [programmeCode, programmePlanning] of planningByProgramme) {
    const row = emptyProgrammeProgress(programmeCode);

    row.planningModuleCount = programmePlanning.length;

    for (const planning of programmePlanning) {
      const studentKey = buildProgrammeNilStudentKey(
        programmeCode,
        planning.module_code
      );

      if (studentNumberReadyKeys.has(studentKey)) {
        row.studentNumbersReadyCount += 1;
      }

      if (planning.split_status && planning.split_status !== "not_started") {
        row.splitReadyCount += 1;
      }
    }

    const { combineReadyCount, combineStatus: rawCombineStatus } =
      resolveCombineMetrics(programmePlanning);

    row.combineReadyCount = combineReadyCount;

    const studentNumbersStatus = stageFromCounts(
      row.studentNumbersReadyCount,
      row.planningModuleCount
    );

    row.studentNumbersStatus = studentNumbersStatus;
    row.combineStatus =
      studentNumbersStatus === "complete" ? rawCombineStatus : "pending";
    row.splitStatus = stageFromCounts(
      row.splitReadyCount,
      row.planningModuleCount
    );

    grouped.set(programmeCode, row);
  }

  return Array.from(grouped.values()).sort((a, b) =>
    a.programmeCode.localeCompare(b.programmeCode)
  );
}
