// src/services/assignmentService.ts

import { supabase } from "../lib/supabase";
import { buildTeacherName, isTBC, normalizeStream } from "../lib/utils";
import type {
  EmploymentType,
  TeachingAssignmentRow,
  TeachingMode,
  TeachingStatus,
  TimetableModuleRow,
} from "../types";

export interface AssignmentDraft {
  timetable_module_id: string;
  academic_year: string;
  teacher_name: string;
  teacher_title?: string | null;
  teacher_family_name?: string | null;
  teacher_other_name?: string | null;
  teacher_employment_type?: EmploymentType | null;
  teaching_status: TeachingStatus;
  programme_type?: string | null;
  combined_code?: string | null;
  combine_type: "natural_same_module_code" | "manual" | "none";
  module_instance_code: string;
  module_term: "Sep" | "Feb" | "Jun";
  mode: TeachingMode;
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function normalizeStreamKey(value: string | null | undefined) {
  return normalizeText(normalizeStream(value ?? "")).toLowerCase();
}

function isCommonStream(streamCode: string | null | undefined) {
  const text = normalizeStreamKey(streamCode);

  return text === "" || text === "nil";
}

function isModuleForSelectedStream(
  moduleStreamCode: string | null | undefined,
  selectedStreamCode: string | null | undefined
) {
  const selected = normalizeStreamKey(selectedStreamCode);

  if (!selected) {
    return true;
  }

  const moduleStream = normalizeStreamKey(moduleStreamCode);

  return isCommonStream(moduleStream) || moduleStream === selected;
}

export async function listAssignments(academicYear: string) {
  const { data, error } = await supabase
    .from("teaching_assignments")
    .select("*")
    .eq("academic_year", academicYear)
    .order("module_term")
    .order("module_instance_code");

  if (error) throw error;

  return (data ?? []) as TeachingAssignmentRow[];
}

export async function saveAssignmentDraft(params: {
  timetableModule: TimetableModuleRow;
  draft: AssignmentDraft;
  updatedBy: string;
}) {
  if (!params.draft.mode) {
    throw new Error("Mode is required.");
  }

  if (!params.draft.teacher_name) {
    throw new Error("Teacher is required.");
  }

  if (!params.draft.teaching_status) {
    throw new Error("Teaching status is required.");
  }

  const { error: moduleError } = await supabase
    .from("timetable_modules")
    .update({
      mode: params.draft.mode,
      assignment_confirmed: false,
    })
    .eq("id", params.timetableModule.id);

  if (moduleError) throw moduleError;

  const existing = await getLatestAssignmentForModule(params.timetableModule.id);

  const assignmentVersion = existing?.assignment_version ?? 1;

  const payload = {
    timetable_module_id: params.timetableModule.id,
    academic_year: params.draft.academic_year,
    teacher_name: params.draft.teacher_name,
    teacher_title: params.draft.teacher_title ?? null,
    teacher_family_name: params.draft.teacher_family_name ?? null,
    teacher_other_name: params.draft.teacher_other_name ?? null,
    teacher_employment_type: params.draft.teacher_employment_type ?? null,
    teaching_status: params.draft.teaching_status,
    programme_type: params.draft.programme_type ?? null,
    combined_code: params.draft.combined_code ?? null,
    combine_type: params.draft.combine_type,
    module_instance_code: params.draft.module_instance_code,
    module_term: params.draft.module_term,
    assignment_version: assignmentVersion,
    confirmed: false,
    confirmed_at: null,
    confirmed_by: null,
    updated_by: params.updatedBy,
  };

  if (existing) {
    const { data, error } = await supabase
      .from("teaching_assignments")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) throw error;

    return data as TeachingAssignmentRow;
  }

  const { data, error } = await supabase
    .from("teaching_assignments")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;

  return data as TeachingAssignmentRow;
}

export async function getLatestAssignmentForModule(timetableModuleId: string) {
  const { data, error } = await supabase
    .from("teaching_assignments")
    .select("*")
    .eq("timetable_module_id", timetableModuleId)
    .order("assignment_version", {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return data as TeachingAssignmentRow | null;
}

function normalizeTeachingMode(value: string | null | undefined): TeachingMode {
  if (value === "Day" || value === "Night" || value === "Saturday") {
    return value;
  }

  return "Night";
}

function normalizeTeachingStatus(
  value: string | null | undefined
): TeachingStatus {
  if (value === "FT" || value === "PT") {
    return value;
  }

  return "FT";
}

async function listSplitConfirmedTimetableModulesForAssignment(params: {
  academicYear: string;
  programmeCode?: string;
  streamCode?: string;
}) {
  let query = supabase
    .from("timetable_modules")
    .select("*")
    .eq("academic_year", params.academicYear)
    .eq("split_confirmed", true)
    .order("programme_code")
    .order("stream_code")
    .order("module_term")
    .order("module_instance_code");

  if (params.programmeCode) {
    query = query.eq("programme_code", params.programmeCode);
  }

  const { data, error } = await query;

  if (error) throw error;

  const rows = (data ?? []) as TimetableModuleRow[];

  if (!params.streamCode) {
    return rows;
  }

  return rows.filter((module) =>
    isModuleForSelectedStream(module.stream_code, params.streamCode)
  );
}

/**
 * Ensures every split-confirmed timetable module has at least one assignment draft.
 *
 * Important:
 * - Supports programme / stream filtering.
 * - Does not create assignment drafts for unrelated programmes.
 */
export async function ensureAssignmentsForAllTimetableModules(params: {
  academicYear: string;
  updatedBy: string;
  programmeCode?: string;
  streamCode?: string;
}) {
  const timetableModules = await listSplitConfirmedTimetableModulesForAssignment(
    {
      academicYear: params.academicYear,
      programmeCode: params.programmeCode,
      streamCode: params.streamCode,
    }
  );

  if (timetableModules.length === 0) {
    return {
      createdCount: 0,
      createdModuleCodes: [] as string[],
    };
  }

  const timetableModuleIds = timetableModules.map((module) => module.id);

  const { data: assignments, error: assignmentError } = await supabase
    .from("teaching_assignments")
    .select("*")
    .eq("academic_year", params.academicYear)
    .in("timetable_module_id", timetableModuleIds);

  if (assignmentError) throw assignmentError;

  const assignmentRows = (assignments ?? []) as TeachingAssignmentRow[];

  const existingAssignmentModuleIds = new Set(
    assignmentRows.map((assignment) => assignment.timetable_module_id)
  );

  const missingModules = timetableModules.filter(
    (module) => !existingAssignmentModuleIds.has(module.id)
  );

  const createdModuleCodes: string[] = [];

  for (const module of missingModules) {
    const draft = buildAssignmentDraftFromTeacher({
      timetableModule: module,
      teacher: null,
      useTBC: true,
      teachingStatus: normalizeTeachingStatus(
        (
          module as TimetableModuleRow & {
            default_teaching_status?: string | null;
          }
        ).default_teaching_status
      ),
      mode: normalizeTeachingMode(module.mode),
      programmeType:
        (
          module as TimetableModuleRow & {
            programme_type?: string | null;
          }
        ).programme_type ?? null,
    });

    await saveAssignmentDraft({
      timetableModule: module,
      draft,
      updatedBy: params.updatedBy,
    });

    createdModuleCodes.push(module.module_instance_code ?? module.id);
  }

  return {
    createdCount: createdModuleCodes.length,
    createdModuleCodes,
  };
}

export function hasValidTeacherAssignment(
  assignment:
    | {
        teacher_name?: string | null;
        teaching_status?: string | null;
      }
    | undefined
) {
  const teacherName = normalizeText(assignment?.teacher_name);

  return Boolean(teacherName) && !isTBC(teacherName) && Boolean(assignment?.teaching_status);
}

export function buildLatestAssignmentByModuleId(
  assignmentRows: TeachingAssignmentRow[]
) {
  const latestAssignmentByModule = new Map<string, TeachingAssignmentRow>();

  for (const assignment of assignmentRows) {
    const existing = latestAssignmentByModule.get(assignment.timetable_module_id);

    if (
      !existing ||
      assignment.assignment_version > existing.assignment_version
    ) {
      latestAssignmentByModule.set(assignment.timetable_module_id, assignment);
    }
  }

  return latestAssignmentByModule;
}

async function confirmAssignmentsForTimetableModules(params: {
  timetableModules: TimetableModuleRow[];
  latestAssignments: TeachingAssignmentRow[];
  confirmedBy: string;
}) {
  if (params.timetableModules.length === 0) {
    return { confirmedVersion: 0 };
  }

  const timetableModuleIds = params.timetableModules.map((module) => module.id);

  const nextVersion =
    Math.max(
      0,
      ...params.timetableModules.map((module) =>
        Number(module.confirmed_version ?? 0)
      )
    ) + 1;

  const now = new Date().toISOString();
  const assignmentIds = params.latestAssignments.map((assignment) => assignment.id);

  const { error: resetError } = await supabase
    .from("teaching_assignments")
    .update({
      confirmed: false,
    })
    .in("timetable_module_id", timetableModuleIds);

  if (resetError) throw resetError;

  const { error: confirmAssignmentError } = await supabase
    .from("teaching_assignments")
    .update({
      assignment_version: nextVersion,
      confirmed: true,
      confirmed_at: now,
      confirmed_by: params.confirmedBy,
      updated_by: params.confirmedBy,
    })
    .in("id", assignmentIds);

  if (confirmAssignmentError) throw confirmAssignmentError;

  const { error: moduleUpdateError } = await supabase
    .from("timetable_modules")
    .update({
      assignment_confirmed: true,
      confirmed_version: nextVersion,
    })
    .in("id", timetableModuleIds);

  if (moduleUpdateError) throw moduleUpdateError;

  const planningModuleIds = params.timetableModules
    .map((module) => module.planning_module_id)
    .filter((id): id is string => Boolean(id));

  if (planningModuleIds.length > 0) {
    const { error: planningUpdateError } = await supabase
      .from("timetable_planning_modules")
      .update({
        assignment_status: "confirmed",
      })
      .in("id", planningModuleIds);

    if (planningUpdateError) throw planningUpdateError;
  }

  return {
    confirmedVersion: nextVersion,
  };
}

/**
 * Confirms only split-confirmed modules that already have a real (non-TBC) teacher.
 * Used after Confirm All Split / teacher sync so Admin monitor matches PL workflow.
 */
export async function confirmReadyAssignments(params: {
  academicYear: string;
  confirmedBy: string;
  programmeCode?: string;
  streamCode?: string;
  timetableModuleIds?: string[];
}) {
  let timetableModules = await listSplitConfirmedTimetableModulesForAssignment({
    academicYear: params.academicYear,
    programmeCode: params.programmeCode,
    streamCode: params.streamCode,
  });

  if (params.timetableModuleIds?.length) {
    const idSet = new Set(params.timetableModuleIds);

    timetableModules = timetableModules.filter((module) => idSet.has(module.id));
  }

  timetableModules = timetableModules.filter((module) => !module.assignment_confirmed);

  if (timetableModules.length === 0) {
    return { confirmedCount: 0, skippedCount: 0 };
  }

  const timetableModuleIds = timetableModules.map((module) => module.id);

  const { data: assignments, error: assignmentError } = await supabase
    .from("teaching_assignments")
    .select("*")
    .eq("academic_year", params.academicYear)
    .in("timetable_module_id", timetableModuleIds)
    .order("assignment_version", { ascending: false });

  if (assignmentError) throw assignmentError;

  const latestAssignmentByModule = buildLatestAssignmentByModuleId(
    (assignments ?? []) as TeachingAssignmentRow[]
  );

  const readyModules = timetableModules.filter((module) =>
    hasValidTeacherAssignment(latestAssignmentByModule.get(module.id))
  );

  if (readyModules.length === 0) {
    return {
      confirmedCount: 0,
      skippedCount: timetableModules.length,
    };
  }

  const latestAssignments = readyModules.map(
    (module) => latestAssignmentByModule.get(module.id)!
  );

  await confirmAssignmentsForTimetableModules({
    timetableModules: readyModules,
    latestAssignments,
    confirmedBy: params.confirmedBy,
  });

  return {
    confirmedCount: readyModules.length,
    skippedCount: timetableModules.length - readyModules.length,
  };
}

/**
 * Programme Leader confirms assignments.
 *
 * Important:
 * - This function must NOT generate teacher_actual_loading.
 * - Teacher loading generation belongs to Admin Update Teacher Loading flow.
 * - Supports programme / stream filtering so one Programme Leader does not confirm
 *   unrelated programmes accidentally.
 */
export async function confirmAssignments(params: {
  academicYear: string;
  confirmedBy: string;
  programmeCode?: string;
  streamCode?: string;
}) {
  await ensureAssignmentsForAllTimetableModules({
    academicYear: params.academicYear,
    updatedBy: params.confirmedBy,
    programmeCode: params.programmeCode,
    streamCode: params.streamCode,
  });

  const timetableModules = await listSplitConfirmedTimetableModulesForAssignment(
    {
      academicYear: params.academicYear,
      programmeCode: params.programmeCode,
      streamCode: params.streamCode,
    }
  );

  if (timetableModules.length === 0) {
    throw new Error("No split-confirmed timetable modules found.");
  }

  const timetableModuleIds = timetableModules.map((module) => module.id);

  const { data: assignments, error: assignmentError } = await supabase
    .from("teaching_assignments")
    .select("*")
    .eq("academic_year", params.academicYear)
    .in("timetable_module_id", timetableModuleIds)
    .order("assignment_version", {
      ascending: false,
    });

  if (assignmentError) throw assignmentError;

  const latestAssignmentByModule = buildLatestAssignmentByModuleId(
    (assignments ?? []) as TeachingAssignmentRow[]
  );

  const missing = timetableModules.filter(
    (module) => !latestAssignmentByModule.has(module.id)
  );

  if (missing.length > 0) {
    throw new Error(
      `Assignment missing for: ${missing
        .map((module) => module.module_instance_code)
        .join(", ")}`
    );
  }

  const latestAssignments = timetableModules.map((module) => {
    return latestAssignmentByModule.get(module.id)!;
  });

  const missingRequired = latestAssignments.filter(
    (assignment) => !hasValidTeacherAssignment(assignment)
  );

  if (missingRequired.length > 0) {
    throw new Error("Some assignments are missing required fields.");
  }

  return confirmAssignmentsForTimetableModules({
    timetableModules,
    latestAssignments,
    confirmedBy: params.confirmedBy,
  });
}

export function buildAssignmentDraftFromTeacher(params: {
  timetableModule: TimetableModuleRow;
  teacher?: {
    title?: string | null;
    family_name?: string | null;
    other_name?: string | null;
    teacher_name?: string | null;
    employment_type?: EmploymentType | null;
  } | null;
  useTBC?: boolean;
  teachingStatus: TeachingStatus;
  mode: TeachingMode;
  programmeType?: string | null;
}): AssignmentDraft {
  const teacherName = params.useTBC
    ? "TBC"
    : params.teacher?.teacher_name ||
      buildTeacherName(
        params.teacher?.title,
        params.teacher?.family_name,
        params.teacher?.other_name
      );

  if (!teacherName) {
    throw new Error("Teacher is required.");
  }

  if (isTBC(teacherName)) {
    return {
      timetable_module_id: params.timetableModule.id,
      academic_year: params.timetableModule.academic_year,
      teacher_name: "TBC",
      teacher_title: null,
      teacher_family_name: null,
      teacher_other_name: null,
      teacher_employment_type: null,
      teaching_status: params.teachingStatus,
      programme_type: params.programmeType ?? null,
      combined_code: params.timetableModule.combined_code,
      combine_type: params.timetableModule.combine_type,
      module_instance_code: params.timetableModule.module_instance_code,
      module_term: params.timetableModule.module_term,
      mode: params.mode,
    };
  }

  return {
    timetable_module_id: params.timetableModule.id,
    academic_year: params.timetableModule.academic_year,
    teacher_name: teacherName,
    teacher_title: params.teacher?.title ?? null,
    teacher_family_name: params.teacher?.family_name ?? null,
    teacher_other_name: params.teacher?.other_name ?? null,
    teacher_employment_type: params.teacher?.employment_type ?? null,
    teaching_status: params.teachingStatus,
    programme_type: params.programmeType ?? null,
    combined_code: params.timetableModule.combined_code,
    combine_type: params.timetableModule.combine_type,
    module_instance_code: params.timetableModule.module_instance_code,
    module_term: params.timetableModule.module_term,
    mode: params.mode,
  };
}

export async function deleteAssignment(id: string) {
  const { error } = await supabase
    .from("teaching_assignments")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

export async function deleteAssignmentsForTimetableModule(
  timetableModuleId: string
) {
  const { error } = await supabase
    .from("teaching_assignments")
    .delete()
    .eq("timetable_module_id", timetableModuleId);

  if (error) throw error;

  const { error: moduleError } = await supabase
    .from("timetable_modules")
    .update({
      assignment_confirmed: false,
    })
    .eq("id", timetableModuleId);

  if (moduleError) throw moduleError;
}
