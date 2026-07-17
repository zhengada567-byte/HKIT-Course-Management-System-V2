import { normalizeTeacherNameKey } from "../lib/timetableSchedulingRules";
import { supabase } from "../lib/supabase";
import { fetchAllPaginatedRows } from "../lib/supabasePagination";
import {
  getAcademicYearVariants,
  isTBC,
  normalizeAcademicYear,
  normalizeStream,
} from "../lib/utils";
import type {
  TeachingAssignmentRow,
  TeachingMode,
  TeachingStatus,
  TimetableModuleRow,
  TimetablePlanningModuleRow,
} from "../types";
import { loadCombinedDefaultTeacherForCombineGroup } from "./splitClassService";
import { canonicalizeTeacherNameForAcademicYear } from "./teacherService";
import { buildModuleIdentityKey } from "./timetableService";

export type ModuleDefaultTeacherSyncUpdate = {
  moduleCode: string;
  programmeCode: string;
  streamCode: string;
  teacherName: string;
  teachingStatus?: TeachingStatus | null;
  mode?: TeachingMode | null;
};

export type SyncTeachersFromDefaultsResult = {
  changedModuleCount: number;
  assignmentUpdatedCount: number;
  instanceUpdatedCount: number;
  sessionUpdatedCount: number;
  timetableModuleCount: number;
  skippedInstanceCount: number;
};

export function instanceTeacherDiffersFromSyncProposal(
  currentTeacher: string | null | undefined,
  proposedTeacher: string
): boolean {
  const current = normalizeText(currentTeacher);

  if (!current || isTBC(current)) {
    return false;
  }

  const proposed = normalizeText(proposedTeacher) || "TBC";

  return (
    normalizeTeacherNameKey(current) !== normalizeTeacherNameKey(proposed)
  );
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function identityKey(params: {
  academicYear: string;
  moduleCode: string;
  programmeCode: string;
  streamCode: string;
}) {
  return buildModuleIdentityKey({
    academicYear: params.academicYear,
    moduleCode: params.moduleCode,
    programmeCode: params.programmeCode,
    programmeStream: params.streamCode,
  });
}

function resolveTeachingStatus(
  value: TeachingStatus | null | undefined,
  fallback: TeachingStatus = "PT"
): TeachingStatus {
  return value === "FT" || value === "PT" ? value : fallback;
}

function resolveMode(
  value: TeachingMode | null | undefined,
  fallback: TeachingMode = "Night"
): TeachingMode {
  return value === "Day" || value === "Night" || value === "Saturday"
    ? value
    : fallback;
}

async function listTimetableModulesForYear(academicYear: string) {
  const { data, error } = await supabase
    .from("timetable_modules")
    .select("*")
    .in("academic_year", getAcademicYearVariants(academicYear));

  if (error) throw error;

  return (data ?? []) as TimetableModuleRow[];
}

async function listPlanningModulesByIds(ids: string[]) {
  const unique = Array.from(new Set(ids.map((id) => normalizeText(id)).filter(Boolean)));
  if (unique.length === 0) return [] as TimetablePlanningModuleRow[];

  const { data, error } = await supabase
    .from("timetable_planning_modules")
    .select("*")
    .in("id", unique);

  if (error) throw error;

  return (data ?? []) as TimetablePlanningModuleRow[];
}

async function listCombineMembersByGroupIds(groupIds: string[]) {
  const unique = Array.from(
    new Set(groupIds.map((id) => normalizeText(id)).filter(Boolean))
  );
  const result = new Map<string, string[]>();

  if (unique.length === 0) return result;

  const { data, error } = await supabase
    .from("combine_group_modules")
    .select("combine_group_id, planning_module_id")
    .in("combine_group_id", unique);

  if (error) throw error;

  for (const row of data ?? []) {
    const groupId = normalizeText(row.combine_group_id);
    const planningId = normalizeText(row.planning_module_id);
    if (!groupId || !planningId) continue;
    const bucket = result.get(groupId) ?? [];
    bucket.push(planningId);
    result.set(groupId, bucket);
  }

  return result;
}

async function listAssignmentsForTimetableModuleIds(ids: string[]) {
  const unique = Array.from(new Set(ids.map((id) => normalizeText(id)).filter(Boolean)));
  if (unique.length === 0) return [] as TeachingAssignmentRow[];

  const { data, error } = await supabase
    .from("teaching_assignments")
    .select("*")
    .in("timetable_module_id", unique);

  if (error) throw error;

  const latestByModuleId = new Map<string, TeachingAssignmentRow>();
  for (const row of (data ?? []) as TeachingAssignmentRow[]) {
    const existing = latestByModuleId.get(row.timetable_module_id);
    if (!existing || row.assignment_version >= existing.assignment_version) {
      latestByModuleId.set(row.timetable_module_id, row);
    }
  }

  return Array.from(latestByModuleId.values());
}

type TimetableTeacherApplyTarget = {
  timetableModule: TimetableModuleRow;
  teacherName: string;
  teachingStatus: TeachingStatus;
  mode: TeachingMode;
};

export async function applyTeacherToTimetableModuleInstance(params: {
  academicYear: string;
  target: TimetableTeacherApplyTarget;
  existingAssignment?: TeachingAssignmentRow | null;
  updatedBy?: string | null;
  updatedAt?: string;
}): Promise<{
  assignmentUpdated: boolean;
  instanceUpdatedCount: number;
  sessionUpdatedCount: number;
}> {
  const academicYear = normalizeAcademicYear(params.academicYear);
  const yearVariants = getAcademicYearVariants(academicYear);
  const now = params.updatedAt ?? new Date().toISOString();
  const teacherName =
    (await canonicalizeTeacherNameForAcademicYear({
      academicYear,
      teacherName: normalizeText(params.target.teacherName) || "TBC",
    })) ?? (normalizeText(params.target.teacherName) || "TBC");

  const existing = params.existingAssignment ?? null;

  if (existing) {
    const { error } = await supabase
      .from("teaching_assignments")
      .update({
        teacher_name: teacherName,
        teaching_status: params.target.teachingStatus,
        updated_by: params.updatedBy ?? null,
        updated_at: now,
      })
      .eq("id", existing.id);

    if (error) throw error;
  } else {
    const { error } = await supabase.from("teaching_assignments").upsert(
      {
        timetable_module_id: params.target.timetableModule.id,
        academic_year: params.target.timetableModule.academic_year,
        teacher_name: teacherName,
        teacher_title: null,
        teacher_family_name: null,
        teacher_other_name: null,
        teacher_employment_type: null,
        teaching_status: params.target.teachingStatus,
        programme_type: null,
        combined_code: params.target.timetableModule.combined_code,
        combine_type: params.target.timetableModule.combine_type,
        module_instance_code: params.target.timetableModule.module_instance_code,
        module_term: params.target.timetableModule.module_term,
        assignment_version: 1,
        confirmed: false,
        confirmed_at: null,
        confirmed_by: null,
        updated_by: params.updatedBy ?? null,
      },
      {
        onConflict: "timetable_module_id,assignment_version",
      }
    );

    if (error) throw error;
  }

  const { error: modeError } = await supabase
    .from("timetable_modules")
    .update({
      mode: params.target.mode,
      updated_at: now,
    })
    .eq("id", params.target.timetableModule.id);

  if (modeError) throw modeError;

  const instanceCode = normalizeText(
    params.target.timetableModule.module_instance_code
  );

  let instanceUpdatedCount = 0;

  if (instanceCode) {
    const { data, error } = await supabase
      .from("timetable_module_instances")
      .update({
        instance_teacher_name: teacherName,
        instance_mode: params.target.mode,
        updated_at: now,
      })
      .in("academic_year", yearVariants)
      .eq("module_instance_code", instanceCode)
      .select("id");

    if (error) throw error;
    instanceUpdatedCount = data?.length ?? 0;
  }

  const sessionIds = await fetchAllPaginatedRows<{ id: string }>({
    fetchPage: ({ from, to }) =>
      supabase
        .from("timetable_sessions")
        .select("id")
        .eq("timetable_module_id", params.target.timetableModule.id)
        .order("id", { ascending: true })
        .range(from, to),
  });

  let sessionUpdatedCount = 0;

  if (sessionIds.length > 0) {
    sessionUpdatedCount = await updateSessionsTeacherName({
      sessionIds: sessionIds.map((row) => row.id),
      teacherName,
      updatedAt: now,
    });
  } else if (instanceCode) {
    const byCode = await fetchAllPaginatedRows<{ id: string }>({
      fetchPage: ({ from, to }) =>
        supabase
          .from("timetable_sessions")
          .select("id")
          .in("academic_year", yearVariants)
          .eq("module_instance_code", instanceCode)
          .order("id", { ascending: true })
          .range(from, to),
    });

    sessionUpdatedCount = await updateSessionsTeacherName({
      sessionIds: byCode.map((row) => row.id),
      teacherName,
      updatedAt: now,
    });
  }

  return {
    assignmentUpdated: true,
    instanceUpdatedCount,
    sessionUpdatedCount,
  };
}

async function updateSessionsTeacherName(params: {
  sessionIds: string[];
  teacherName: string;
  updatedAt: string;
}) {
  let updated = 0;

  for (let index = 0; index < params.sessionIds.length; index += 100) {
    const chunk = params.sessionIds.slice(index, index + 100);
    const { error } = await supabase
      .from("timetable_sessions")
      .update({
        teacher_name: params.teacherName,
        updated_at: params.updatedAt,
      })
      .in("id", chunk);

    if (error) throw error;
    updated += chunk.length;
  }

  return updated;
}

/**
 * After module basic settings save: push teacher (and mode/status) to
 * teaching_assignments → timetable_module_instances → timetable_sessions.
 */
export async function syncTeachersFromModuleDefaultsToTimetable(params: {
  academicYear: string;
  updates: ModuleDefaultTeacherSyncUpdate[];
  updatedBy?: string | null;
}): Promise<SyncTeachersFromDefaultsResult> {
  const academicYear = normalizeAcademicYear(params.academicYear);
  const updates = params.updates.filter(
    (row) => normalizeText(row.moduleCode) && normalizeText(row.programmeCode)
  );

  const empty: SyncTeachersFromDefaultsResult = {
    changedModuleCount: updates.length,
    assignmentUpdatedCount: 0,
    instanceUpdatedCount: 0,
    sessionUpdatedCount: 0,
    timetableModuleCount: 0,
    skippedInstanceCount: 0,
  };

  if (updates.length === 0) {
    return { ...empty, changedModuleCount: 0 };
  }

  const updateByIdentity = new Map<string, ModuleDefaultTeacherSyncUpdate>();
  for (const update of updates) {
    updateByIdentity.set(
      identityKey({
        academicYear,
        moduleCode: update.moduleCode,
        programmeCode: update.programmeCode,
        streamCode: update.streamCode,
      }),
      update
    );
  }

  const changedIdentityKeys = new Set(updateByIdentity.keys());
  const timetableModules = await listTimetableModulesForYear(academicYear);

  if (timetableModules.length === 0) {
    return empty;
  }

  const planningIds = timetableModules
    .map((row) => normalizeText(row.planning_module_id))
    .filter(Boolean);
  const combineIds = timetableModules
    .map((row) => normalizeText(row.combine_group_id))
    .filter(Boolean);

  const [planningModules, combineMembers] = await Promise.all([
    listPlanningModulesByIds(planningIds),
    listCombineMembersByGroupIds(combineIds),
  ]);

  const planningById = new Map(
    planningModules.map((row) => [row.id, row] as const)
  );

  const missingPlanningIds = Array.from(
    new Set(Array.from(combineMembers.values()).flat())
  ).filter((id) => !planningById.has(id));

  if (missingPlanningIds.length > 0) {
    for (const row of await listPlanningModulesByIds(missingPlanningIds)) {
      planningById.set(row.id, row);
    }
  }

  type Target = {
    timetableModule: TimetableModuleRow;
    teacherName: string;
    teachingStatus: TeachingStatus;
    mode: TeachingMode;
  };

  const targets: Target[] = [];
  const touchedCombineGroupIds = Array.from(
    new Set(
      timetableModules
        .map((tm) => normalizeText(tm.combine_group_id))
        .filter((groupId) => {
          if (!groupId) return false;
          const memberIds = combineMembers.get(groupId) ?? [];
          return memberIds.some((id) => {
            const planning = planningById.get(id);
            if (!planning) return false;
            return changedIdentityKeys.has(
              identityKey({
                academicYear,
                moduleCode: planning.module_code,
                programmeCode: planning.programme_code,
                streamCode: planning.stream_code,
              })
            );
          });
        })
    )
  );

  const combinedDefaultsByGroupId = new Map<
    string,
    Awaited<ReturnType<typeof loadCombinedDefaultTeacherForCombineGroup>>
  >();

  await Promise.all(
    touchedCombineGroupIds.map(async (groupId) => {
      const resolved = await loadCombinedDefaultTeacherForCombineGroup({
        combineGroupId: groupId,
        academicYear,
      });
      combinedDefaultsByGroupId.set(groupId, resolved);
    })
  );

  for (const tm of timetableModules) {
    const groupId = normalizeText(tm.combine_group_id);
    const planningId = normalizeText(tm.planning_module_id);

    if (groupId) {
      const combined = combinedDefaultsByGroupId.get(groupId);
      if (!combined) continue;

      targets.push({
        timetableModule: tm,
        teacherName: combined.teacherName,
        teachingStatus: combined.teachingStatus,
        mode: combined.mode,
      });
      continue;
    }

    if (planningId) {
      const planning = planningById.get(planningId);
      if (!planning) continue;

      const update = updateByIdentity.get(
        identityKey({
          academicYear,
          moduleCode: planning.module_code,
          programmeCode: planning.programme_code,
          streamCode: planning.stream_code,
        })
      );
      if (!update) continue;

      targets.push({
        timetableModule: tm,
        teacherName: normalizeText(update.teacherName) || "TBC",
        teachingStatus: resolveTeachingStatus(update.teachingStatus),
        mode: resolveMode(update.mode, tm.mode ?? "Night"),
      });
      continue;
    }

    const baseCode =
      normalizeText(tm.base_module_code) || normalizeText(tm.module_instance_code);
    const update = updateByIdentity.get(
      identityKey({
        academicYear,
        moduleCode: baseCode,
        programmeCode: tm.programme_code,
        streamCode: tm.stream_code,
      })
    );
    if (!update) continue;

    targets.push({
      timetableModule: tm,
      teacherName: normalizeText(update.teacherName) || "TBC",
      teachingStatus: resolveTeachingStatus(update.teachingStatus),
      mode: resolveMode(update.mode, tm.mode ?? "Night"),
    });
  }

  if (targets.length === 0) {
    return empty;
  }

  const existingAssignments = await listAssignmentsForTimetableModuleIds(
    targets.map((row) => row.timetableModule.id)
  );
  const assignmentByModuleId = new Map(
    existingAssignments.map((row) => [row.timetable_module_id, row] as const)
  );

  const now = new Date().toISOString();
  const yearVariants = getAcademicYearVariants(academicYear);

  const teacherNameCache = new Map<string, string>();
  async function resolveTeacherName(raw: string) {
    const key = normalizeText(raw) || "TBC";
    const cached = teacherNameCache.get(key);
    if (cached) return cached;

    const resolved =
      (await canonicalizeTeacherNameForAcademicYear({
        academicYear,
        teacherName: key,
      })) ?? key;
    teacherNameCache.set(key, resolved);
    return resolved;
  }

  const instanceCodes = Array.from(
    new Set(
      targets
        .map((target) =>
          normalizeText(target.timetableModule.module_instance_code).toUpperCase()
        )
        .filter(Boolean)
    )
  );

  const instanceTeacherByCode = new Map<string, string>();

  if (instanceCodes.length > 0) {
    const instanceRows = await fetchAllPaginatedRows<{
      module_instance_code: string;
      instance_teacher_name: string | null;
    }>({
      fetchPage: ({ from, to }) =>
        supabase
          .from("timetable_module_instances")
          .select("module_instance_code, instance_teacher_name")
          .in("academic_year", yearVariants)
          .in("module_instance_code", instanceCodes)
          .order("module_instance_code", { ascending: true })
          .range(from, to),
    });

    for (const row of instanceRows) {
      const code = normalizeText(row.module_instance_code).toUpperCase();
      if (!code) continue;
      instanceTeacherByCode.set(
        code,
        normalizeText(row.instance_teacher_name)
      );
    }
  }

  let assignmentUpdatedCount = 0;
  let instanceUpdatedCount = 0;
  let sessionUpdatedCount = 0;
  let skippedInstanceCount = 0;

  for (const target of targets) {
    const teacherName = await resolveTeacherName(target.teacherName);
    const instanceCode = normalizeText(
      target.timetableModule.module_instance_code
    ).toUpperCase();
    const currentTeacher = instanceCode
      ? instanceTeacherByCode.get(instanceCode)
      : undefined;

    if (instanceTeacherDiffersFromSyncProposal(currentTeacher, teacherName)) {
      skippedInstanceCount += 1;
      continue;
    }

    const applied = await applyTeacherToTimetableModuleInstance({
      academicYear,
      target,
      existingAssignment: assignmentByModuleId.get(target.timetableModule.id),
      updatedBy: params.updatedBy ?? null,
      updatedAt: now,
    });

    if (applied.assignmentUpdated) {
      assignmentUpdatedCount += 1;
    }

    instanceUpdatedCount += applied.instanceUpdatedCount;
    sessionUpdatedCount += applied.sessionUpdatedCount;
  }

  return {
    changedModuleCount: updates.length,
    assignmentUpdatedCount,
    instanceUpdatedCount,
    sessionUpdatedCount,
    timetableModuleCount: targets.length,
    skippedInstanceCount,
  };
}

/** Build sync updates only for rows whose teacher (or mode/status) changed. */
export function buildTeacherSyncUpdatesFromDrafts(params: {
  rows: Array<{
    module: {
      module_code: string;
      programme_code: string;
      stream_code: string;
    };
    previousTeacherName: string;
    previousTeachingStatus?: TeachingStatus | null;
    previousMode?: TeachingMode | null;
    nextTeacherName: string;
    nextTeachingStatus?: TeachingStatus | null;
    nextMode?: TeachingMode | null;
  }>;
}): ModuleDefaultTeacherSyncUpdate[] {
  const updates: ModuleDefaultTeacherSyncUpdate[] = [];

  for (const row of params.rows) {
    const prevTeacher = normalizeText(row.previousTeacherName) || "TBC";
    const nextTeacher = normalizeText(row.nextTeacherName) || "TBC";
    const prevStatus = row.previousTeachingStatus ?? null;
    const nextStatus = row.nextTeachingStatus ?? null;
    const prevMode = row.previousMode ?? null;
    const nextMode = row.nextMode ?? null;

    if (
      prevTeacher === nextTeacher &&
      prevStatus === nextStatus &&
      prevMode === nextMode
    ) {
      continue;
    }

    updates.push({
      moduleCode: row.module.module_code,
      programmeCode: row.module.programme_code,
      streamCode: normalizeStream(row.module.stream_code),
      teacherName: nextTeacher,
      teachingStatus: nextStatus,
      mode: nextMode,
    });
  }

  return updates;
}
