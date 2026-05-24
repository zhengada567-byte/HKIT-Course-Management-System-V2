import { supabase } from "../lib/supabase";
import type {
  CombineGroupRow,
  TimetableModuleRow,
  TimetablePlanningModuleRow,
} from "../types";

type DefaultTeachingStatus = "FT" | "PT";
type DefaultTeachingMode = "Day" | "Night" | "Saturday";

export function canSplit(expectedStudentNumber: number | null | undefined) {
  return Number(expectedStudentNumber ?? 0) > 40;
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

function getCombinedDefaults(
  relatedPlanningModules: TimetablePlanningModuleRow[]
) {
  const teacherNames = Array.from(
    new Set(
      relatedPlanningModules
        .map((module) => {
          const moduleWithDefaults = module as TimetablePlanningModuleRow & {
            default_teacher_name?: string | null;
            teacher_name?: string | null;
          };

          return (
            moduleWithDefaults.default_teacher_name ??
            moduleWithDefaults.teacher_name ??
            null
          );
        })
        .filter((value): value is string => Boolean(value))
    )
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
    teacherName: teacherNames.length > 0 ? teacherNames.join("; ") : "TBC",
    teachingStatus: statuses.length === 1 ? statuses[0] : "FT",
    mode: modes.length === 1 ? modes[0] : "Night",
  };
}

function splitStudentNumber(
  value: number | null | undefined,
  numberOfClasses: number
) {
  if (value == null) return null;

  return Math.ceil(Number(value) / numberOfClasses);
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
      split_status: "pending",
      assignment_status: "pending",
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
    throw new Error("Split is allowed only when expected student number > 40.");
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

  const expectedPerClass = splitStudentNumber(
    params.expectedStudentNumber,
    params.numberOfClasses
  );

  const actualPerClass = splitStudentNumber(
    params.actualStudentNumber,
    params.numberOfClasses
  );

  const payload = instanceCodes.map((code) => ({
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
    expected_student_number: expectedPerClass,
    actual_student_number: actualPerClass,
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

  return timetableModules;
}

export async function createCombinedTimetableModules(params: {
  combineGroup: CombineGroupRow;
  relatedPlanningModules: TimetablePlanningModuleRow[];
  numberOfClasses: number;
  createdBy: string;
}) {
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
    throw new Error("Split is allowed only when expected student number > 40.");
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

  const defaults = getCombinedDefaults(params.relatedPlanningModules);

  const expectedPerClass = splitStudentNumber(
    params.combineGroup.total_expected_student_number,
    params.numberOfClasses
  );

  const actualPerClass = splitStudentNumber(
    params.combineGroup.total_actual_student_number,
    params.numberOfClasses
  );

  const payload = instanceCodes.map((code) => ({
    academic_year: params.combineGroup.academic_year,
    planning_module_id: null,
    combine_group_id: params.combineGroup.id,
    programme_code: isMixedProgramme ? "MIXED" : first.programme_code,
    stream_code: isMixedStream ? "MIXED" : first.stream_code,
    base_module_code: first.module_code,
    combined_code: params.combineGroup.combined_code,
    combine_type: params.combineGroup.combine_type,
    module_instance_code: code,
    module_name: params.relatedPlanningModules
      .map((m) => m.module_name || m.module_code)
      .filter(Boolean)
      .join(" / "),
    module_year: first.module_year,
    module_term: params.combineGroup.module_term,
    mode: defaults.mode,
    expected_student_number: expectedPerClass,
    actual_student_number: actualPerClass,
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

  return timetableModules;
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

  const { data, error } = await supabase
    .from("timetable_planning_modules")
    .select("*")
    .in("id", ids)
    .order("module_code");

  if (error) throw error;

  return (data ?? []) as TimetablePlanningModuleRow[];
}

export async function undoTimetableModuleDecision(params: {
  timetableModule: TimetableModuleRow;
}) {
  const module = params.timetableModule;

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
