import { supabase } from "../lib/supabase";
import type {
  CombineGroupRow,
  ModuleTerm,
  TeachingAssignmentRow,
  TimetableModuleRow,
  TimetablePlanningModuleRow,
} from "../types";
import { resolveBaseModuleCodeForProgramme } from "../lib/combinedModuleCode";
import { dedupeJoinedModuleName } from "../lib/moduleDisplay";
import { getAcademicYearVariants, isTBC, normalizeStream } from "../lib/utils";
import {
  loadCombinedDefaultTeacherForCombineGroup,
  loadPlanningModulesByCombineGroupIds,
} from "./splitClassService";
import { buildModuleIdentityKey } from "./timetableService";
import type { ModuleDefaultAssignmentRow } from "../types";

export type TimetableInstanceSourceType = "planning_module" | "combine_group";

export interface TimetableModuleInstanceRow {
  id: string;
  academic_year: string;
  source_type: TimetableInstanceSourceType;
  source_planning_module_id: string | null;
  source_combine_group_id: string | null;
  module_term: ModuleTerm;
  module_instance_code: string;
  module_code: string;
  module_name: string | null;
  instance_mode: string | null;
  instance_expected_size: number;
  instance_actual_size: number | null;
  instance_teacher_name: string | null;
  split_group_size: number;
  instance_index: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function resolveInstanceTeacherName(params: {
  existing?: string | null;
  fromAssignment?: string | null;
  fromModuleDefault?: string | null;
}) {
  const existing = normalizeText(params.existing);
  const fromAssignment = normalizeText(params.fromAssignment);
  const fromModuleDefault = normalizeText(params.fromModuleDefault);

  if (existing && !isTBC(existing)) return existing;
  if (fromAssignment && !isTBC(fromAssignment)) return fromAssignment;
  if (fromModuleDefault && !isTBC(fromModuleDefault)) return fromModuleDefault;

  return existing || fromAssignment || fromModuleDefault || null;
}

/** Avoid writing TBC over a non-TBC value when Confirm All re-syncs instances. */
function resolveInstanceTeacherNameForUpsert(params: {
  existing?: string | null;
  fromAssignment?: string | null;
  fromModuleDefault?: string | null;
}) {
  const resolved = resolveInstanceTeacherName(params);

  if (resolved && !isTBC(resolved)) {
    return resolved;
  }

  for (const candidate of [
    params.existing,
    params.fromAssignment,
    params.fromModuleDefault,
  ]) {
    const text = normalizeText(candidate);
    if (text && !isTBC(text)) {
      return text;
    }
  }

  return resolved;
}

function buildStudentNumberKey(params: {
  academicYear: string;
  moduleCode: string;
  programmeCode: string;
}) {
  return [
    normalizeText(params.academicYear),
    normalizeText(params.programmeCode).toUpperCase(),
    normalizeText(params.moduleCode).toUpperCase(),
  ].join("|");
}

export function buildInstanceCodes(params: {
  base: string;
  count: number;
}): string[] {
  if (params.count <= 1) return [params.base];

  const width = String(params.count).length;
  const codes: string[] = [];

  for (let index = 1; index <= params.count; index += 1) {
    const suffix = String(index).padStart(width, "0");
    codes.push(`${params.base}_${suffix}`);
  }

  return codes;
}

export async function listTimetableModuleInstances(params: {
  academicYear: string;
  programmeCode?: string;
  streamCode?: string;
}): Promise<TimetableModuleInstanceRow[]> {
  let query = supabase
    .from("timetable_module_instances")
    .select("*")
    .eq("academic_year", params.academicYear)
    .order("module_term")
    .order("module_instance_code");

  // We do NOT filter by programme_code here because instances may be MIXED.
  // Filtering is done by source ids instead.

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []) as TimetableModuleInstanceRow[];
}

import type { UserRole } from "../types/auth";
import { isCrossProgrammeCombineGroupId } from "./manualCombineService";
import {
  assertAdminCanMutateCrossProgrammeGroup,
} from "../lib/crossProgrammeCombine";

export async function upsertTimetableModuleInstances(
  rows: Array<Partial<TimetableModuleInstanceRow> & { id: string }>,
  options?: { actorRole?: UserRole }
) {
  if (rows.length === 0) return;

  if (options?.actorRole && options.actorRole !== "admin") {
    const { data: instanceRows, error: instanceError } = await supabase
      .from("timetable_module_instances")
      .select("id, source_combine_group_id")
      .in(
        "id",
        rows.map((row) => row.id)
      );

    if (instanceError) throw instanceError;

    for (const instance of instanceRows ?? []) {
      const combineGroupId = String(instance.source_combine_group_id ?? "").trim();
      if (!combineGroupId) continue;

      const isCrossProgramme = await isCrossProgrammeCombineGroupId(combineGroupId);

      assertAdminCanMutateCrossProgrammeGroup({
        actorRole: options.actorRole,
        isCrossProgramme,
        action: "edit instances for a cross-programme manual combine group",
      });
    }
  }

  // Use UPDATE-only to avoid accidental INSERT with missing required columns.
  // (Upsert by id would attempt insert if the id doesn't exist yet.)
  const updates = rows.map(async (row) => {
    const patch: Partial<TimetableModuleInstanceRow> & { updated_at: string } = {
      updated_at: new Date().toISOString(),
    };

    if (row.instance_expected_size !== undefined) {
      patch.instance_expected_size = row.instance_expected_size;
    }

    if (row.instance_actual_size !== undefined) {
      patch.instance_actual_size = row.instance_actual_size;
    }

    if (row.instance_teacher_name !== undefined) {
      patch.instance_teacher_name = row.instance_teacher_name;
    }

    if (row.instance_mode !== undefined) {
      patch.instance_mode = row.instance_mode;
    }

    const { error } = await supabase
      .from("timetable_module_instances")
      .update(patch)
      .eq("id", row.id);

    if (error) throw error;
  });

  await Promise.all(updates);
}

export async function ensureInstancesForAllSources(params: {
  academicYear: string;
  planningModules: TimetablePlanningModuleRow[];
  manualGroups: CombineGroupRow[];
  timetableModules: TimetableModuleRow[]; // existing generated modules (used for default teacher)
  assignments: TeachingAssignmentRow[];
  studentNumbers: Array<{
    academic_year: string;
    module_code: string;
    programme_code: string;
    programme_stream?: string;
    expected_student_number: number;
    actual_student_number: number | null;
  }>;
  selectedStreamCode?: string;
  createdBy: string;
}) {
  const {
    academicYear,
    planningModules,
    manualGroups,
    timetableModules,
    assignments,
    studentNumbers,
    selectedStreamCode,
  } = params;

  const streamKey = normalizeStream(selectedStreamCode ?? "");

  const assignmentByTimetableId = new Map<string, TeachingAssignmentRow>();
  for (const a of assignments) assignmentByTimetableId.set(a.timetable_module_id, a);

  const studentNumberMap = new Map<string, (typeof params.studentNumbers)[number]>();
  for (const row of studentNumbers) {
    const programmeStream = normalizeStream(row.programme_stream ?? "");
    if (streamKey && programmeStream !== "nil" && programmeStream !== streamKey) {
      continue;
    }
    const key = buildStudentNumberKey({
      academicYear: row.academic_year,
      programmeCode: row.programme_code,
      moduleCode: row.module_code,
    });
    studentNumberMap.set(key, row);
  }

  // Existing instances, so we only create missing module_instance_code rows.
  const { data: existing, error: existingError } = await supabase
    .from("timetable_module_instances")
    .select("module_instance_code, source_type, source_planning_module_id, source_combine_group_id")
    .eq("academic_year", academicYear);

  if (existingError) throw existingError;

  const existingInstanceCodes = new Set<string>();
  const existingPlanning = new Set<string>();
  const existingCombine = new Set<string>();

  for (const row of (existing ?? []) as any[]) {
    if (row.module_instance_code) {
      existingInstanceCodes.add(String(row.module_instance_code));
    }
    if (row.source_type === "planning_module" && row.source_planning_module_id) {
      existingPlanning.add(String(row.source_planning_module_id));
    }
    if (row.source_type === "combine_group" && row.source_combine_group_id) {
      existingCombine.add(String(row.source_combine_group_id));
    }
  }

  const payload: any[] = [];

  // 0) Prefer using generated timetable_modules as instances when present.
  // This guarantees split results are visible immediately and keeps instance codes consistent.
  for (const tm of timetableModules) {
    const instanceCode = normalizeText(tm.module_instance_code);
    if (!instanceCode) continue;
    if (existingInstanceCodes.has(instanceCode)) continue;

    const teacher = assignmentByTimetableId.get(tm.id)?.teacher_name ?? null;
    const sourceType: TimetableInstanceSourceType = tm.combine_group_id
      ? "combine_group"
      : "planning_module";

    payload.push({
      academic_year: academicYear,
      source_type: sourceType,
      source_planning_module_id: tm.planning_module_id ?? null,
      source_combine_group_id: tm.combine_group_id ?? null,
      module_term: tm.module_term,
      module_instance_code: instanceCode,
      module_code: tm.base_module_code ?? instanceCode,
      module_name: dedupeJoinedModuleName(tm.module_name) || tm.module_name,
      instance_mode: tm.mode ?? null,
      instance_expected_size: tm.expected_student_number ?? 0,
      instance_actual_size: tm.actual_student_number ?? null,
      instance_teacher_name: teacher,
      split_group_size: tm.split_group_size ?? 1,
      instance_index: 1,
      created_by: params.createdBy,
      updated_at: new Date().toISOString(),
    });
  }

  // Default teacher for combined instances: from existing timetable_modules assignments when present.
  const timetableByCombineGroup = new Map<string, TimetableModuleRow[]>();
  for (const m of timetableModules) {
    if (!m.combine_group_id) continue;
    const list = timetableByCombineGroup.get(m.combine_group_id) ?? [];
    list.push(m);
    timetableByCombineGroup.set(m.combine_group_id, list);
  }

  for (const group of manualGroups) {
    if (existingCombine.has(group.id)) continue;

    const expected = group.total_expected_student_number ?? 0;
    const actual = group.total_actual_student_number ?? null;

    const existingModulesForGroup = timetableByCombineGroup.get(group.id) ?? [];
    const firstTimetable = existingModulesForGroup[0];
    const teacher =
      firstTimetable ? assignmentByTimetableId.get(firstTimetable.id)?.teacher_name : null;

    payload.push({
      academic_year: academicYear,
      source_type: "combine_group",
      source_planning_module_id: null,
      source_combine_group_id: group.id,
      module_term: group.module_term,
      module_instance_code: group.combined_code,
      module_code: group.combined_code,
      module_name: group.combined_code,
      instance_expected_size: expected,
      instance_actual_size: actual,
      instance_teacher_name: teacher ?? null,
      split_group_size: 1,
      instance_index: 1,
      created_by: params.createdBy,
      updated_at: new Date().toISOString(),
    });
  }

  for (const pm of planningModules) {
    if (existingPlanning.has(pm.id)) continue;

    const key = buildStudentNumberKey({
      academicYear: pm.academic_year,
      programmeCode: pm.programme_code,
      moduleCode: pm.module_code,
    });
    const sn = studentNumberMap.get(key);
    const expected = sn?.expected_student_number ?? 0;
    const actual = sn?.actual_student_number ?? null;

    payload.push({
      academic_year: academicYear,
      source_type: "planning_module",
      source_planning_module_id: pm.id,
      source_combine_group_id: null,
      module_term: pm.module_term,
      module_instance_code: pm.module_code,
      module_code: pm.module_code,
      module_name: pm.module_name,
      instance_expected_size: expected,
      instance_actual_size: actual,
      instance_teacher_name: (pm as any).default_teacher_name ?? null,
      split_group_size: 1,
      instance_index: 1,
      created_by: params.createdBy,
      updated_at: new Date().toISOString(),
    });
  }

  if (payload.length === 0) {
    return { createdCount: 0 };
  }

  const { error } = await supabase
    .from("timetable_module_instances")
    .insert(payload);

  if (error) throw error;

  return { createdCount: payload.length };
}

export async function ensureInstancesForTimetableModules(params: {
  academicYear: string;
  timetableModules: TimetableModuleRow[];
  assignments: TeachingAssignmentRow[];
  createdBy: string;
  /** Programme page scope — picks correct member code for combined groups (e.g. HDC → HD408). */
  programmeCode?: string;
}) {
  if (params.timetableModules.length === 0) return { createdCount: 0 };

  const assignmentByTimetableId = new Map<string, TeachingAssignmentRow>();
  for (const a of params.assignments) {
    assignmentByTimetableId.set(a.timetable_module_id, a);
  }

  const { data: defaultRows, error: defaultError } = await supabase
    .from("module_default_assignments")
    .select("*")
    .in("academic_year", getAcademicYearVariants(params.academicYear));

  if (defaultError) throw defaultError;

  const defaultByIdentity = new Map<string, ModuleDefaultAssignmentRow>();
  for (const row of (defaultRows ?? []) as ModuleDefaultAssignmentRow[]) {
    const key = buildModuleIdentityKey({
      academicYear: row.academic_year,
      moduleCode: row.module_code,
      programmeCode: row.programme_code,
      programmeStream: row.stream_code,
    });
    defaultByIdentity.set(key, row);
  }

  const combineGroupIds = Array.from(
    new Set(
      params.timetableModules
        .map((m) => m.combine_group_id)
        .filter((id): id is string => Boolean(id))
    )
  );

  const combinedDefaultTeacherByGroupId = new Map<string, string>();

  const membersByCombineGroupId = await loadPlanningModulesByCombineGroupIds({
    academicYear: params.academicYear,
    combineGroupIds,
  });

  if (combineGroupIds.length > 0) {
    await Promise.all(
      combineGroupIds.map(async (groupId) => {
        const resolved = await loadCombinedDefaultTeacherForCombineGroup({
          combineGroupId: groupId,
          academicYear: params.academicYear,
        });
        combinedDefaultTeacherByGroupId.set(groupId, resolved.teacherName);
      })
    );
  }

  const instanceCodes = Array.from(
    new Set(
      params.timetableModules
        .map((m) => normalizeText(m.module_instance_code))
        .filter(Boolean)
    )
  );

  const existingByCode = new Map<
    string,
    { instance_teacher_name: string | null; instance_mode: string | null }
  >();

  if (instanceCodes.length > 0) {
    const { data: existing, error: existingError } = await supabase
      .from("timetable_module_instances")
      .select("module_instance_code, instance_teacher_name, instance_mode")
      .eq("academic_year", params.academicYear)
      .in("module_instance_code", instanceCodes);

    if (existingError) throw existingError;

    for (const row of (existing ?? []) as any[]) {
      const code = normalizeText(row.module_instance_code);
      if (!code) continue;
      existingByCode.set(code, {
        instance_teacher_name:
          row.instance_teacher_name !== undefined ? row.instance_teacher_name : null,
        instance_mode: row.instance_mode !== undefined ? row.instance_mode : null,
      });
    }
  }

  const payload: any[] = [];

  for (const tm of params.timetableModules) {
    const instanceCode = normalizeText(tm.module_instance_code);
    if (!instanceCode) continue;

    const teacherFromAssignment =
      assignmentByTimetableId.get(tm.id)?.teacher_name ?? null;

    const combineMembers = tm.combine_group_id
      ? membersByCombineGroupId.get(tm.combine_group_id) ?? []
      : [];
    const resolvedModuleCode =
      combineMembers.length > 0
        ? resolveBaseModuleCodeForProgramme({
            members: combineMembers,
            programmeCode: params.programmeCode,
          })
        : "";
    const moduleCodeForDefault =
      resolvedModuleCode ||
      normalizeText(tm.base_module_code) ||
      normalizeText(tm.module_instance_code);

    const defaultTeacher =
      (tm.combine_group_id
        ? combinedDefaultTeacherByGroupId.get(tm.combine_group_id)
        : null) ??
      defaultByIdentity.get(
        buildModuleIdentityKey({
          academicYear: params.academicYear,
          moduleCode: moduleCodeForDefault,
          programmeCode: tm.programme_code,
          programmeStream: tm.stream_code,
        })
      )?.teacher_name ??
      null;

    const sourceType: TimetableInstanceSourceType = tm.combine_group_id
      ? "combine_group"
      : "planning_module";

    const existing = existingByCode.get(instanceCode);
    const existingMode = normalizeText(existing?.instance_mode);
    const fallbackMode = normalizeText(tm.mode);
    const resolvedTeacher = resolveInstanceTeacherNameForUpsert({
      existing: existing?.instance_teacher_name,
      fromAssignment: teacherFromAssignment,
      fromModuleDefault: defaultTeacher,
    });

    payload.push({
      academic_year: params.academicYear,
      source_type: sourceType,
      source_planning_module_id: tm.planning_module_id ?? null,
      source_combine_group_id: tm.combine_group_id ?? null,
      module_term: tm.module_term,
      module_instance_code: instanceCode,
      module_code: moduleCodeForDefault,
      module_name: dedupeJoinedModuleName(tm.module_name) || tm.module_name,
      // Do not overwrite PL-edited fields once set.
      // But if an existing field is empty, backfill from timetable_modules / assignments.
      instance_mode: existingMode ? existing!.instance_mode : (fallbackMode ? tm.mode : null),
      instance_expected_size: tm.expected_student_number ?? 0,
      instance_actual_size: tm.actual_student_number ?? null,
      instance_teacher_name: resolvedTeacher,
      split_group_size: tm.split_group_size ?? 1,
      instance_index: 1,
      created_by: params.createdBy,
      updated_at: new Date().toISOString(),
    });
  }

  if (payload.length === 0) return { createdCount: 0 };

  const { error } = await supabase
    .from("timetable_module_instances")
    // Use upsert so re-splitting can refresh sizes/mode/teacher.
    .upsert(payload, { onConflict: "academic_year,module_instance_code" });
  if (error) throw error;

  return { createdCount: payload.length };
}

