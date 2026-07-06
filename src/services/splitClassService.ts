import {
  findMatchingModuleDefaultAssignment,
  resolveCombinedDefaultTeacherFromPlanningModules,
} from "../lib/combinedDefaultTeacher";
import { resolveBaseModuleCodeForProgramme } from "../lib/combinedModuleCode";
import { joinUniqueModuleNames } from "../lib/moduleDisplay";
import { supabase } from "../lib/supabase";
import type { UserRole } from "../types/auth";
import {
  assertAdminCanMutateCrossProgrammeGroup,
  isCrossProgrammeManualGroup,
} from "../lib/crossProgrammeCombine";
import { isCrossProgrammeCombineGroupId } from "./manualCombineService";
import { getAcademicYearVariants, isTBC } from "../lib/utils";
import type {
  CombineGroupRow,
  ModuleDefaultAssignmentRow,
  TeachingAssignmentRow,
  TimetableModuleRow,
  TimetablePlanningModuleRow,
} from "../types";
import { listPlanningModulesByIdsWithStudentNumbers } from "./timetableService";
import { confirmReadyAssignments } from "./assignmentService";

type DefaultTeachingStatus = "FT" | "PT";
type DefaultTeachingMode = "Day" | "Night" | "Saturday";

/** Minimum expected students before split class is allowed (> this value). */
export const SPLIT_MIN_STUDENT_THRESHOLD = 29;

export function canSplit(expectedStudentNumber: number | null | undefined) {
  return Number(expectedStudentNumber ?? 0) > SPLIT_MIN_STUDENT_THRESHOLD;
}

function normalizeCodePart(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toUpperCase();
}

function normalizeStreamForCode(value: string | null | undefined) {
  const text = normalizeCodePart(value);

  return text || "NIL";
}

function buildSingleModuleInstanceBaseCode(
  planningModule: TimetablePlanningModuleRow
) {
  const programme = normalizeCodePart(planningModule.programme_code) || "PROG";
  const stream = normalizeStreamForCode(planningModule.stream_code);
  const moduleCode = normalizeCodePart(planningModule.module_code) || "MODULE";

  return `${programme}_${stream}_${moduleCode}`;
}

function buildNoSplitModuleInstanceCode(
  planningModule: TimetablePlanningModuleRow
) {
  /*
    For No Split + No Combine, the displayed module instance code should remain
    the original module code.

    Example:
    - Original module_code: UWLBS101
    - No split timetable module_instance_code: UWLBS101

    Split modules may still use generated suffixes.
  */
  return planningModule.module_code;
}

function getPlanningModuleDefaults(planningModule: TimetablePlanningModuleRow) {
  const moduleWithDefaults = planningModule as TimetablePlanningModuleRow & {
    default_teacher_name?: string | null;
    teacher_name?: string | null;
    default_teaching_status?: DefaultTeachingStatus | null;
    default_mode?: DefaultTeachingMode | null;
  };

  return {
    teacherName:
      moduleWithDefaults.default_teacher_name ??
      moduleWithDefaults.teacher_name ??
      "TBC",
    teachingStatus: moduleWithDefaults.default_teaching_status ?? "FT",
    mode: moduleWithDefaults.default_mode ?? "Night",
  };
}

export async function loadCombinedDefaultTeacherForCombineGroup(params: {
  combineGroupId: string;
  academicYear: string;
}) {
  const { data: relations, error: relationError } = await supabase
    .from("combine_group_modules")
    .select("planning_module_id")
    .eq("combine_group_id", params.combineGroupId);

  if (relationError) throw relationError;

  const planningModuleIds = (relations ?? []).map((row) => row.planning_module_id);

  if (planningModuleIds.length === 0) {
    return {
      teacherName: "TBC" as const,
      teachingStatus: "FT" as DefaultTeachingStatus,
      mode: "Night" as DefaultTeachingMode,
    };
  }

  const { data: planningRows, error: planningError } = await supabase
    .from("timetable_planning_modules")
    .select("id, module_code, programme_code, stream_code")
    .in("id", planningModuleIds);

  if (planningError) throw planningError;

  const { data: defaultRows, error: defaultError } = await supabase
    .from("module_default_assignments")
    .select("*")
    .in("academic_year", getAcademicYearVariants(params.academicYear));

  if (defaultError) throw defaultError;

  const mdaRows = (defaultRows ?? []) as ModuleDefaultAssignmentRow[];
  const teacherNames = new Set<string>();
  const statuses = new Set<DefaultTeachingStatus>();
  const modes = new Set<DefaultTeachingMode>();

  for (const tpm of planningRows ?? []) {
    const mda = findMatchingModuleDefaultAssignment({
      academicYear: params.academicYear,
      moduleCode: tpm.module_code,
      programmeCode: tpm.programme_code,
      streamCode: tpm.stream_code,
      rows: mdaRows,
    });

    const teacher = String(mda?.teacher_name ?? "").trim();
    if (teacher && !isTBC(teacher)) {
      teacherNames.add(teacher);
    }

    if (mda?.teaching_status === "FT" || mda?.teaching_status === "PT") {
      statuses.add(mda.teaching_status);
    }

    if (mda?.mode === "Day" || mda?.mode === "Night" || mda?.mode === "Saturday") {
      modes.add(mda.mode);
    }
  }

  const teacherName =
    teacherNames.size > 0
      ? Array.from(teacherNames).sort((a, b) => a.localeCompare(b)).join("; ")
      : "TBC";

  return {
    teacherName,
    teachingStatus: statuses.size === 1 ? [...statuses][0] : "FT",
    mode: modes.size === 1 ? [...modes][0] : "Night",
  };
}

export function getCombinedDefaults(
  relatedPlanningModules: TimetablePlanningModuleRow[]
) {
  const teacherName = resolveCombinedDefaultTeacherFromPlanningModules(
    relatedPlanningModules as Array<
      TimetablePlanningModuleRow & {
        default_teacher_name?: string | null;
        teacher_name?: string | null;
      }
    >
  );

  const statuses = Array.from(
    new Set(
      relatedPlanningModules
        .map((module) => {
          const moduleWithDefaults = module as TimetablePlanningModuleRow & {
            default_teaching_status?: DefaultTeachingStatus | null;
          };

          return moduleWithDefaults.default_teaching_status ?? null;
        })
        .filter((value): value is DefaultTeachingStatus => Boolean(value))
    )
  );

  const modes = Array.from(
    new Set(
      relatedPlanningModules
        .map((module) => {
          const moduleWithDefaults = module as TimetablePlanningModuleRow & {
            default_mode?: DefaultTeachingMode | null;
          };

          return moduleWithDefaults.default_mode ?? null;
        })
        .filter((value): value is DefaultTeachingMode => Boolean(value))
    )
  );

  return {
    teacherName,
    teachingStatus: statuses.length === 1 ? statuses[0] : "FT",
    mode: modes.length === 1 ? modes[0] : "Night",
  };
}

/**
 * Split a total across classes: average → round for the first (n-1) classes;
 * the last class gets (total − sum of others). E.g. 127 / 2 => [64, 63].
 */
export function splitStudentNumberConservingTotal(
  value: number | null | undefined,
  numberOfClasses: number
): number[] | null {
  if (value == null) return null;

  const total = Math.max(0, Math.floor(Number(value)));
  const n = Math.max(1, Math.floor(Number(numberOfClasses)));

  if (n === 1) return [total];

  const roundedAverage = Math.round(total / n);
  const sizes: number[] = [];

  for (let index = 0; index < n - 1; index += 1) {
    sizes.push(roundedAverage);
  }

  const sumOthers = roundedAverage * (n - 1);
  sizes.push(Math.max(0, total - sumOthers));

  return sizes;
}

export function generateSplitInstanceCodes(
  baseCode: string,
  numberOfClasses: number
) {
  if (numberOfClasses <= 1) {
    return [baseCode];
  }

  return Array.from({ length: numberOfClasses }, (_, index) => {
    return `${baseCode}_${index + 1}`;
  });
}

export async function hasAssignmentsForAcademicYear(academicYear: string) {
  const { count, error } = await supabase
    .from("teaching_assignments")
    .select("*", {
      count: "exact",
      head: true,
    })
    .eq("academic_year", academicYear);

  if (error) throw error;

  return Number(count ?? 0) > 0;
}

async function deleteAssignmentsForTimetableModules(timetableModuleIds: string[]) {
  if (timetableModuleIds.length === 0) return;

  const { error } = await supabase
    .from("teaching_assignments")
    .delete()
    .in("timetable_module_id", timetableModuleIds);

  if (error) throw error;
}

async function createDefaultTeachingAssignments(params: {
  timetableModules: TimetableModuleRow[];
  teacherName: string;
  teachingStatus: DefaultTeachingStatus;
  mode: DefaultTeachingMode;
  updatedBy: string;
}) {
  if (params.timetableModules.length === 0) return;

  const payload = params.timetableModules.map((module) => ({
    timetable_module_id: module.id,
    academic_year: module.academic_year,
    teacher_name: params.teacherName || "TBC",
    teacher_title: null,
    teacher_family_name: null,
    teacher_other_name: null,
    teacher_employment_type: null,
    teaching_status: params.teachingStatus,
    programme_type: null,
    combined_code: module.combined_code,
    combine_type: module.combine_type,
    module_instance_code: module.module_instance_code,
    module_term: module.module_term,
    assignment_version: 1,
    confirmed: false,
    confirmed_at: null,
    confirmed_by: null,
    updated_by: params.updatedBy,
  }));

  const { error } = await supabase
    .from("teaching_assignments")
    .upsert(payload, {
      onConflict: "timetable_module_id,assignment_version",
    });

  if (error) throw error;

  const { error: moduleError } = await supabase
    .from("timetable_modules")
    .update({
      mode: params.mode,
      assignment_confirmed: false,
    })
    .in(
      "id",
      params.timetableModules.map((module) => module.id)
    );

  if (moduleError) throw moduleError;
}

async function clearExistingTimetableModulesForSources(params: {
  academicYear: string;
  planningModuleIds?: string[];
  combineGroupIds?: string[];
}) {
  if (
    (!params.planningModuleIds || params.planningModuleIds.length === 0) &&
    (!params.combineGroupIds || params.combineGroupIds.length === 0)
  ) {
    return;
  }

  if (params.planningModuleIds && params.planningModuleIds.length > 0) {
    const { data: existingModules, error: fetchError } = await supabase
      .from("timetable_modules")
      .select("id")
      .eq("academic_year", params.academicYear)
      .in("planning_module_id", params.planningModuleIds);

    if (fetchError) throw fetchError;

    const ids = (existingModules ?? []).map((row) => row.id);

    await deleteAssignmentsForTimetableModules(ids);

    const { error } = await supabase
      .from("timetable_modules")
      .delete()
      .eq("academic_year", params.academicYear)
      .in("planning_module_id", params.planningModuleIds);

    if (error) throw error;
  }

  if (params.combineGroupIds && params.combineGroupIds.length > 0) {
    const { data: existingModules, error: fetchError } = await supabase
      .from("timetable_modules")
      .select("id")
      .eq("academic_year", params.academicYear)
      .in("combine_group_id", params.combineGroupIds);

    if (fetchError) throw fetchError;

    const ids = (existingModules ?? []).map((row) => row.id);

    await deleteAssignmentsForTimetableModules(ids);

    const { error } = await supabase
      .from("timetable_modules")
      .delete()
      .eq("academic_year", params.academicYear)
      .in("combine_group_id", params.combineGroupIds);

    if (error) throw error;
  }
}

async function updatePlanningModuleSplitStatus(params: {
  planningModuleIds: string[];
  splitStatus: "split" | "no_split";
}) {
  if (params.planningModuleIds.length === 0) return;

  const { error } = await supabase
    .from("timetable_planning_modules")
    .update({
      split_status: params.splitStatus,
    })
    .in("id", params.planningModuleIds);

  if (error) throw error;
}

async function resetPlanningModuleSplitStatus(planningModuleIds: string[]) {
  if (planningModuleIds.length === 0) return;

  const { error } = await supabase
    .from("timetable_planning_modules")
    .update({
      // DB check: split_status in ('not_started', 'no_split', 'split')
      split_status: "not_started",
      // DB check: assignment_status in ('not_started', 'assigned', 'confirmed')
      assignment_status: "not_started",
    })
    .in("id", planningModuleIds);

  if (error) throw error;
}

export async function createNoSplitSingleModule(params: {
  planningModule: TimetablePlanningModuleRow;
  expectedStudentNumber: number;
  actualStudentNumber: number | null;
  createdBy: string;
}) {
  await clearExistingTimetableModulesForSources({
    academicYear: params.planningModule.academic_year,
    planningModuleIds: [params.planningModule.id],
  });

  const moduleInstanceCode = buildNoSplitModuleInstanceCode(
    params.planningModule
  );

  const defaults = getPlanningModuleDefaults(params.planningModule);

  const { data, error } = await supabase
    .from("timetable_modules")
    .upsert(
      {
        academic_year: params.planningModule.academic_year,
        planning_module_id: params.planningModule.id,
        combine_group_id: null,
        programme_code: params.planningModule.programme_code,
        stream_code: params.planningModule.stream_code,
        base_module_code: params.planningModule.module_code,
        combined_code: null,
        combine_type: "none",
        module_instance_code: moduleInstanceCode,
        module_name: params.planningModule.module_name,
        module_year: params.planningModule.module_year,
        module_term: params.planningModule.module_term,
        mode: defaults.mode,
        expected_student_number: params.expectedStudentNumber,
        actual_student_number: params.actualStudentNumber,
        split_group_size: 1,
        split_confirmed: true,
        assignment_confirmed: false,
        created_by: params.createdBy,
      },
      {
        onConflict: "academic_year,module_instance_code",
      }
    )
    .select("*")
    .single();

  if (error) throw error;

  const timetableModule = data as TimetableModuleRow;

  await createDefaultTeachingAssignments({
    timetableModules: [timetableModule],
    teacherName: defaults.teacherName,
    teachingStatus: defaults.teachingStatus,
    mode: defaults.mode,
    updatedBy: params.createdBy,
  });

  await updatePlanningModuleSplitStatus({
    planningModuleIds: [params.planningModule.id],
    splitStatus: "no_split",
  });

  await confirmReadyAssignments({
    academicYear: params.planningModule.academic_year,
    confirmedBy: params.createdBy,
    timetableModuleIds: [timetableModule.id],
  });

  return timetableModule;
}

export async function createSplitSingleModule(params: {
  planningModule: TimetablePlanningModuleRow;
  expectedStudentNumber: number;
  actualStudentNumber: number | null;
  numberOfClasses: number;
  createdBy: string;
}) {
  if (!canSplit(params.expectedStudentNumber)) {
    throw new Error(
      `Split is allowed only when expected student number > ${SPLIT_MIN_STUDENT_THRESHOLD}.`
    );
  }

  if (!Number.isFinite(params.numberOfClasses) || params.numberOfClasses < 2) {
    throw new Error("Number of classes must be at least 2.");
  }

  await clearExistingTimetableModulesForSources({
    academicYear: params.planningModule.academic_year,
    planningModuleIds: [params.planningModule.id],
  });

  const baseInstanceCode = buildSingleModuleInstanceBaseCode(
    params.planningModule
  );

  const instanceCodes = generateSplitInstanceCodes(
    baseInstanceCode,
    params.numberOfClasses
  );

  const defaults = getPlanningModuleDefaults(params.planningModule);

  const expectedPerClass = splitStudentNumberConservingTotal(
    params.expectedStudentNumber,
    params.numberOfClasses
  );

  const actualPerClass = splitStudentNumberConservingTotal(
    params.actualStudentNumber,
    params.numberOfClasses
  );

  const payload = instanceCodes.map((code, index) => ({
    academic_year: params.planningModule.academic_year,
    planning_module_id: params.planningModule.id,
    combine_group_id: null,
    programme_code: params.planningModule.programme_code,
    stream_code: params.planningModule.stream_code,
    base_module_code: params.planningModule.module_code,
    combined_code: null,
    combine_type: "none",
    module_instance_code: code,
    module_name: params.planningModule.module_name,
    module_year: params.planningModule.module_year,
    module_term: params.planningModule.module_term,
    mode: defaults.mode,
    expected_student_number: expectedPerClass?.[index] ?? null,
    actual_student_number: actualPerClass?.[index] ?? null,
    split_group_size: params.numberOfClasses,
    split_confirmed: true,
    assignment_confirmed: false,
    created_by: params.createdBy,
  }));

  const { data, error } = await supabase
    .from("timetable_modules")
    .upsert(payload, {
      onConflict: "academic_year,module_instance_code",
    })
    .select("*");

  if (error) throw error;

  const timetableModules = (data ?? []) as TimetableModuleRow[];

  await createDefaultTeachingAssignments({
    timetableModules,
    teacherName: defaults.teacherName,
    teachingStatus: defaults.teachingStatus,
    mode: defaults.mode,
    updatedBy: params.createdBy,
  });

  await updatePlanningModuleSplitStatus({
    planningModuleIds: [params.planningModule.id],
    splitStatus: "split",
  });

  await confirmReadyAssignments({
    academicYear: params.planningModule.academic_year,
    confirmedBy: params.createdBy,
    timetableModuleIds: timetableModules.map((module) => module.id),
  });

  return timetableModules;
}

export async function createCombinedTimetableModules(params: {
  combineGroup: CombineGroupRow;
  relatedPlanningModules: TimetablePlanningModuleRow[];
  numberOfClasses: number;
  createdBy: string;
  actorRole: UserRole;
  /** When Split UI already shows a default teacher, pass it through to assignments. */
  preferredDefaultTeacher?: string | null;
}) {
  assertAdminCanMutateCrossProgrammeGroup({
    actorRole: params.actorRole,
    isCrossProgramme: isCrossProgrammeManualGroup(params.relatedPlanningModules),
    action: "split a cross-programme manual combine group",
  });

  if (
    params.combineGroup.status !== "auto_confirmed" &&
    params.combineGroup.status !== "confirmed"
  ) {
    throw new Error("Combine group must be confirmed before split.");
  }

  if (params.relatedPlanningModules.length === 0) {
    throw new Error("No planning modules found for this combine group.");
  }

  const expected = params.combineGroup.total_expected_student_number ?? 0;

  if (params.numberOfClasses > 1 && !canSplit(expected)) {
    throw new Error(
      `Split is allowed only when expected student number > ${SPLIT_MIN_STUDENT_THRESHOLD}.`
    );
  }

  if (!Number.isFinite(params.numberOfClasses) || params.numberOfClasses < 1) {
    throw new Error("Number of classes must be at least 1.");
  }

  await clearExistingTimetableModulesForSources({
    academicYear: params.combineGroup.academic_year,
    combineGroupIds: [params.combineGroup.id],
  });

  const baseInstanceCode =
    normalizeCodePart(params.combineGroup.combined_code) || "COMBINED";

  const instanceCodes = generateSplitInstanceCodes(
    baseInstanceCode,
    params.numberOfClasses
  );

  const isMixedProgramme =
    new Set(params.relatedPlanningModules.map((m) => m.programme_code)).size > 1;

  const isMixedStream =
    new Set(params.relatedPlanningModules.map((m) => m.stream_code)).size > 1;

  const first = params.relatedPlanningModules[0];

  const defaultsFromModules = getCombinedDefaults(params.relatedPlanningModules);
  const defaultsFromDb = await loadCombinedDefaultTeacherForCombineGroup({
    combineGroupId: params.combineGroup.id,
    academicYear: params.combineGroup.academic_year,
  });

  const preferred = String(params.preferredDefaultTeacher ?? "").trim();
  const defaults = {
    teacherName:
      preferred && !isTBC(preferred)
        ? preferred
        : defaultsFromDb.teacherName !== "TBC"
          ? defaultsFromDb.teacherName
          : defaultsFromModules.teacherName,
    teachingStatus:
      defaultsFromDb.teacherName !== "TBC"
        ? defaultsFromDb.teachingStatus
        : defaultsFromModules.teachingStatus,
    mode:
      defaultsFromDb.teacherName !== "TBC"
        ? defaultsFromDb.mode
        : defaultsFromModules.mode,
  };

  const expectedPerClass = splitStudentNumberConservingTotal(
    params.combineGroup.total_expected_student_number,
    params.numberOfClasses
  );

  const actualPerClass = splitStudentNumberConservingTotal(
    params.combineGroup.total_actual_student_number,
    params.numberOfClasses
  );

  const payload = instanceCodes.map((code, index) => ({
    academic_year: params.combineGroup.academic_year,
    planning_module_id: null,
    combine_group_id: params.combineGroup.id,
    programme_code: isMixedProgramme ? "MIXED" : first.programme_code,
    stream_code: isMixedStream ? "MIXED" : first.stream_code,
    base_module_code: resolveBaseModuleCodeForProgramme({
      members: params.relatedPlanningModules,
      programmeCode: isMixedProgramme ? undefined : first.programme_code,
    }),
    combined_code: params.combineGroup.combined_code,
    combine_type: params.combineGroup.combine_type,
    module_instance_code: code,
    module_name: joinUniqueModuleNames(
      params.relatedPlanningModules.map((m) => m.module_name || m.module_code)
    ),
    module_year: first.module_year,
    module_term: params.combineGroup.module_term,
    mode: defaults.mode,
    expected_student_number: expectedPerClass?.[index] ?? null,
    actual_student_number: actualPerClass?.[index] ?? null,
    split_group_size: params.numberOfClasses,
    split_confirmed: true,
    assignment_confirmed: false,
    created_by: params.createdBy,
  }));

  const { data, error } = await supabase
    .from("timetable_modules")
    .upsert(payload, {
      onConflict: "academic_year,module_instance_code",
    })
    .select("*");

  if (error) throw error;

  const timetableModules = (data ?? []) as TimetableModuleRow[];

  await createDefaultTeachingAssignments({
    timetableModules,
    teacherName: defaults.teacherName,
    teachingStatus: defaults.teachingStatus,
    mode: defaults.mode,
    updatedBy: params.createdBy,
  });

  const splitStatus = params.numberOfClasses > 1 ? "split" : "no_split";

  await updatePlanningModuleSplitStatus({
    planningModuleIds: params.relatedPlanningModules.map((module) => module.id),
    splitStatus,
  });

  await confirmReadyAssignments({
    academicYear: params.combineGroup.academic_year,
    confirmedBy: params.createdBy,
    timetableModuleIds: timetableModules.map((module) => module.id),
  });

  return timetableModules;
}

/**
 * Backfill teaching_assignments.teacher_name from upload defaults when still TBC.
 * Call before ensureInstancesForTimetableModules (e.g. Confirm All Split).
 */
export async function syncAssignmentTeachersForTimetableModules(params: {
  academicYear: string;
  timetableModules: TimetableModuleRow[];
  updatedBy: string;
}) {
  if (params.timetableModules.length === 0) {
    return { updatedCount: 0 };
  }

  const timetableModuleIds = params.timetableModules.map((module) => module.id);

  const [{ data: assignmentRows, error: assignmentError }, { data: defaultRows, error: defaultError }] =
    await Promise.all([
      supabase
        .from("teaching_assignments")
        .select("*")
        .in("timetable_module_id", timetableModuleIds),
      supabase
        .from("module_default_assignments")
        .select("*")
        .in("academic_year", getAcademicYearVariants(params.academicYear)),
    ]);

  if (assignmentError) throw assignmentError;
  if (defaultError) throw defaultError;

  const assignmentByTimetableId = new Map<string, TeachingAssignmentRow>();
  for (const row of (assignmentRows ?? []) as TeachingAssignmentRow[]) {
    const existing = assignmentByTimetableId.get(row.timetable_module_id);
    if (!existing || row.assignment_version >= existing.assignment_version) {
      assignmentByTimetableId.set(row.timetable_module_id, row);
    }
  }

  const mdaRows = (defaultRows ?? []) as ModuleDefaultAssignmentRow[];

  const planningModuleIds = Array.from(
    new Set(
      params.timetableModules
        .map((module) => module.planning_module_id)
        .filter((id): id is string => Boolean(id))
    )
  );

  const planningById = new Map(
    (
      planningModuleIds.length > 0
        ? await listPlanningModulesByIdsWithStudentNumbers({
            academicYear: params.academicYear,
            planningModuleIds,
          })
        : []
    ).map((module) => [module.id, module])
  );

  const combineGroupIds = Array.from(
    new Set(
      params.timetableModules
        .map((module) => module.combine_group_id)
        .filter((id): id is string => Boolean(id))
    )
  );

  const combinedDefaultsByGroupId = new Map<
    string,
    Awaited<ReturnType<typeof loadCombinedDefaultTeacherForCombineGroup>>
  >();

  await Promise.all(
    combineGroupIds.map(async (groupId) => {
      const resolved = await loadCombinedDefaultTeacherForCombineGroup({
        combineGroupId: groupId,
        academicYear: params.academicYear,
      });
      combinedDefaultsByGroupId.set(groupId, resolved);
    })
  );

  let updatedCount = 0;

  for (const tm of params.timetableModules) {
    const existing = assignmentByTimetableId.get(tm.id);
    const existingTeacher = String(existing?.teacher_name ?? "").trim();

    if (existingTeacher && !isTBC(existingTeacher)) {
      continue;
    }

    let teacherName = "TBC";
    let teachingStatus: DefaultTeachingStatus = "FT";
    let mode: DefaultTeachingMode = "Night";

    if (tm.combine_group_id) {
      const combined = combinedDefaultsByGroupId.get(tm.combine_group_id);
      if (combined) {
        teacherName = combined.teacherName;
        teachingStatus = combined.teachingStatus;
        mode = combined.mode;
      }
    } else if (tm.planning_module_id) {
      const planning = planningById.get(tm.planning_module_id);
      if (planning) {
        const resolved = getPlanningModuleDefaults(
          planning as TimetablePlanningModuleRow
        );
        teacherName = resolved.teacherName;
        teachingStatus = resolved.teachingStatus;
        mode = resolved.mode;
      }
    } else if (
      normalizeCodePart(tm.programme_code) !== "MIXED" &&
      normalizeCodePart(tm.stream_code) !== "MIXED"
    ) {
      const mda = findMatchingModuleDefaultAssignment({
        academicYear: params.academicYear,
        moduleCode: tm.base_module_code ?? tm.module_instance_code,
        programmeCode: tm.programme_code,
        streamCode: tm.stream_code,
        rows: mdaRows,
      });
      if (mda?.teacher_name && !isTBC(mda.teacher_name)) {
        teacherName = mda.teacher_name.trim();
      }
      if (mda?.teaching_status === "FT" || mda?.teaching_status === "PT") {
        teachingStatus = mda.teaching_status;
      }
      if (mda?.mode === "Day" || mda?.mode === "Night" || mda?.mode === "Saturday") {
        mode = mda.mode;
      }
    }

    if (!teacherName || isTBC(teacherName)) {
      continue;
    }

    if (existing) {
      const { error } = await supabase
        .from("teaching_assignments")
        .update({
          teacher_name: teacherName,
          teaching_status: teachingStatus,
          updated_by: params.updatedBy,
        })
        .eq("id", existing.id);

      if (error) throw error;
    } else {
      await createDefaultTeachingAssignments({
        timetableModules: [tm],
        teacherName,
        teachingStatus,
        mode,
        updatedBy: params.updatedBy,
      });
    }

    updatedCount += 1;
  }

  await confirmReadyAssignments({
    academicYear: params.academicYear,
    confirmedBy: params.updatedBy,
    timetableModuleIds: params.timetableModules.map((module) => module.id),
  });

  return { updatedCount };
}

export async function loadPlanningModulesByCombineGroupIds(params: {
  academicYear: string;
  combineGroupIds: string[];
}): Promise<Map<string, TimetablePlanningModuleRow[]>> {
  const groupIds = Array.from(
    new Set(params.combineGroupIds.map((id) => String(id ?? "").trim()).filter(Boolean))
  );
  const result = new Map<string, TimetablePlanningModuleRow[]>();
  if (groupIds.length === 0) return result;

  const { data: relations, error: relationError } = await supabase
    .from("combine_group_modules")
    .select("combine_group_id, planning_module_id")
    .in("combine_group_id", groupIds);

  if (relationError) throw relationError;

  const idsByGroup = new Map<string, string[]>();
  const allIds = new Set<string>();
  for (const row of relations ?? []) {
    const groupId = String(row.combine_group_id ?? "").trim();
    const planningId = String(row.planning_module_id ?? "").trim();
    if (!groupId || !planningId) continue;
    const list = idsByGroup.get(groupId) ?? [];
    list.push(planningId);
    idsByGroup.set(groupId, list);
    allIds.add(planningId);
  }

  if (allIds.size === 0) return result;

  const modules = await listPlanningModulesByIdsWithStudentNumbers({
    academicYear: params.academicYear,
    planningModuleIds: Array.from(allIds),
  });
  const moduleById = new Map(modules.map((m) => [m.id, m]));

  for (const groupId of groupIds) {
    const ids = idsByGroup.get(groupId) ?? [];
    result.set(
      groupId,
      ids
        .map((id) => moduleById.get(id))
        .filter((m): m is TimetablePlanningModuleRow => Boolean(m))
    );
  }

  return result;
}

export async function getPlanningModulesForCombineGroup(groupId: string) {
  const { data: relations, error: relationError } = await supabase
    .from("combine_group_modules")
    .select("planning_module_id")
    .eq("combine_group_id", groupId);

  if (relationError) throw relationError;

  const ids = (relations ?? []).map((row) => row.planning_module_id);

  if (ids.length === 0) {
    return [];
  }

  const { data: group, error: groupError } = await supabase
    .from("combine_groups")
    .select("academic_year")
    .eq("id", groupId)
    .single();

  if (groupError) throw groupError;

  // IMPORTANT: include uploaded default teacher/mode/status (module_default_assignments)
  // so combined split can carry Proposed Teacher.
  const enriched = await listPlanningModulesByIdsWithStudentNumbers({
    academicYear: group.academic_year,
    planningModuleIds: ids,
  });

  return enriched as TimetablePlanningModuleRow[];
}

export async function undoTimetableModuleDecision(params: {
  timetableModule: TimetableModuleRow;
  actorRole?: UserRole;
}) {
  const module = params.timetableModule;

  if (module.combine_group_id && params.actorRole) {
    const isCrossProgramme = await isCrossProgrammeCombineGroupId(
      module.combine_group_id
    );

    assertAdminCanMutateCrossProgrammeGroup({
      actorRole: params.actorRole,
      isCrossProgramme,
      action: "undo split for a cross-programme manual combine group",
    });
  }

  let query = supabase
    .from("timetable_modules")
    .select("id, planning_module_id, combine_group_id")
    .eq("academic_year", module.academic_year);

  if (module.planning_module_id) {
    query = query.eq("planning_module_id", module.planning_module_id);
  } else if (module.combine_group_id) {
    query = query.eq("combine_group_id", module.combine_group_id);
  } else {
    query = query.eq("id", module.id);
  }

  const { data: modulesToDelete, error: fetchError } = await query;

  if (fetchError) throw fetchError;

  const timetableModuleIds = (modulesToDelete ?? []).map((row) => row.id);

  await deleteAssignmentsForTimetableModules(timetableModuleIds);

  // Also remove module instances so the Split step can "go back".
  // Keep it tolerant in case migration 014 isn't applied yet.
  try {
    if (module.planning_module_id) {
      await supabase
        .from("timetable_module_instances")
        .delete()
        .eq("academic_year", module.academic_year)
        .eq("source_type", "planning_module")
        .eq("source_planning_module_id", module.planning_module_id);
    } else if (module.combine_group_id) {
      await supabase
        .from("timetable_module_instances")
        .delete()
        .eq("academic_year", module.academic_year)
        .eq("source_type", "combine_group")
        .eq("source_combine_group_id", module.combine_group_id);
    } else {
      await supabase
        .from("timetable_module_instances")
        .delete()
        .eq("academic_year", module.academic_year)
        .eq("module_instance_code", module.module_instance_code);
    }
  } catch {
    // ignore
  }

  if (module.planning_module_id) {
    const { error: deleteError } = await supabase
      .from("timetable_modules")
      .delete()
      .eq("academic_year", module.academic_year)
      .eq("planning_module_id", module.planning_module_id);

    if (deleteError) throw deleteError;

    await resetPlanningModuleSplitStatus([module.planning_module_id]);

    return;
  }

  if (module.combine_group_id) {
    const { error: deleteError } = await supabase
      .from("timetable_modules")
      .delete()
      .eq("academic_year", module.academic_year)
      .eq("combine_group_id", module.combine_group_id);

    if (deleteError) throw deleteError;

    const { data: relations, error: relationError } = await supabase
      .from("combine_group_modules")
      .select("planning_module_id")
      .eq("combine_group_id", module.combine_group_id);

    if (relationError) throw relationError;

    const planningModuleIds = (relations ?? []).map(
      (row) => row.planning_module_id
    );

    await resetPlanningModuleSplitStatus(planningModuleIds);

    return;
  }

  const { error: deleteError } = await supabase
    .from("timetable_modules")
    .delete()
    .eq("id", module.id);

  if (deleteError) throw deleteError;
}

/**
 * Clears weekly/daily timetable sessions, split results, assignments, and
 * module instances for a manual combine group so it can be re-merged.
 */
export async function resetCombineGroupDownstream(params: {
  academicYear: string;
  combineGroupId: string;
}) {
  const { data: modules, error: fetchError } = await supabase
    .from("timetable_modules")
    .select("id")
    .eq("academic_year", params.academicYear)
    .eq("combine_group_id", params.combineGroupId);

  if (fetchError) throw fetchError;

  const timetableModuleIds = (modules ?? []).map((row) => row.id);

  if (timetableModuleIds.length > 0) {
    const { error: sessionError } = await supabase
      .from("timetable_sessions")
      .delete()
      .in("timetable_module_id", timetableModuleIds);

    if (sessionError) throw sessionError;
  }

  await undoTimetableDecisionsForSources({
    academicYear: params.academicYear,
    planningModuleIds: [],
    combineGroupIds: [params.combineGroupId],
  });
}

export async function undoTimetableDecisionsForSources(params: {
  academicYear: string;
  planningModuleIds: string[];
  combineGroupIds: string[];
}) {
  const planningIds = params.planningModuleIds ?? [];
  const combineIds = params.combineGroupIds ?? [];

  if (planningIds.length === 0 && combineIds.length === 0) {
    return { undoneModules: 0 };
  }

  // Fetch affected timetable_modules ids for assignment deletion.
  const ids: string[] = [];

  if (planningIds.length > 0) {
    const { data, error } = await supabase
      .from("timetable_modules")
      .select("id")
      .eq("academic_year", params.academicYear)
      .in("planning_module_id", planningIds);
    if (error) throw error;
    ids.push(...(data ?? []).map((r: any) => r.id));
  }

  if (combineIds.length > 0) {
    const { data, error } = await supabase
      .from("timetable_modules")
      .select("id")
      .eq("academic_year", params.academicYear)
      .in("combine_group_id", combineIds);
    if (error) throw error;
    ids.push(...(data ?? []).map((r: any) => r.id));
  }

  await deleteAssignmentsForTimetableModules(ids);

  // Delete module_instances for these sources (tolerant if migration not applied).
  try {
    if (planningIds.length > 0) {
      await supabase
        .from("timetable_module_instances")
        .delete()
        .eq("academic_year", params.academicYear)
        .eq("source_type", "planning_module")
        .in("source_planning_module_id", planningIds);
    }
    if (combineIds.length > 0) {
      await supabase
        .from("timetable_module_instances")
        .delete()
        .eq("academic_year", params.academicYear)
        .eq("source_type", "combine_group")
        .in("source_combine_group_id", combineIds);
    }
  } catch {
    // ignore
  }

  if (planningIds.length > 0) {
    const { error } = await supabase
      .from("timetable_modules")
      .delete()
      .eq("academic_year", params.academicYear)
      .in("planning_module_id", planningIds);
    if (error) throw error;
    await resetPlanningModuleSplitStatus(planningIds);
  }

  if (combineIds.length > 0) {
    const { error } = await supabase
      .from("timetable_modules")
      .delete()
      .eq("academic_year", params.academicYear)
      .in("combine_group_id", combineIds);
    if (error) throw error;

    // Reset split_status for planning modules in these combine groups
    const { data: relations, error: relationError } = await supabase
      .from("combine_group_modules")
      .select("planning_module_id, combine_group_id")
      .in("combine_group_id", combineIds);
    if (relationError) throw relationError;
    const planningModuleIds = Array.from(
      new Set((relations ?? []).map((r: any) => r.planning_module_id))
    );
    await resetPlanningModuleSplitStatus(planningModuleIds);
  }

  return { undoneModules: ids.length };
}
