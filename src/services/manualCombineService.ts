import { supabase } from "../lib/supabase";
import type {
  CombineGroupRow,
  ModuleTerm,
  TimetablePlanningModuleRow,
  TimetableStudentNumberRow,
} from "../types";
import type { ModuleEnrollmentRow } from "./moduleEnrollmentService";

export interface ManualCombineGroupDetailRow {
  combine_group_id: string;
  planning_module_id: string;
  module_code: string;
  module_name: string | null;
  programme_code: string;
  stream_code: string;
  module_term: string;
  expected_student_number: number | null;
  actual_student_number: number | null;
}

export interface ManualCombineGroupWithDetails extends CombineGroupRow {
  details: ManualCombineGroupDetailRow[];
}

interface StudentNumberLikeRow {
  academic_year: string;
  module_code: string;
  programme_code: string;
  expected_student_number: number;
  actual_student_number: number | null;
}

interface ProgrammeStreamAbbrRow {
  programme_code: string;
  programme_stream: string | null;
  stream_abbr: string | null;
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function normalizeCodePart(value: string | null | undefined) {
  return normalizeText(value)
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toUpperCase();
}

function normalizeStreamKey(value: string | null | undefined) {
  const text = normalizeText(value).toLowerCase();

  return text === "" ? "nil" : text;
}

function isCommonStream(streamCode: string | null | undefined) {
  const text = normalizeStreamKey(streamCode);

  return text === "nil";
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.map(normalizeCodePart).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b)
  );
}

function isPlanningModuleRelevantToFilter(params: {
  module: TimetablePlanningModuleRow;
  programmeCode?: string;
  streamCode?: string;
}) {
  const programmeCode = normalizeText(params.programmeCode);

  if (!programmeCode) {
    return true;
  }

  if (
    normalizeCodePart(params.module.programme_code) !==
    normalizeCodePart(programmeCode)
  ) {
    return false;
  }

  if (!normalizeText(params.streamCode)) {
    return true;
  }

  const selectedStream = normalizeStreamKey(params.streamCode);
  const moduleStream = normalizeStreamKey(params.module.stream_code);

  return isCommonStream(moduleStream) || moduleStream === selectedStream;
}

function buildStudentNumberKey(params: {
  academicYear: string;
  moduleCode: string;
  programmeCode: string;
}) {
  return [
    normalizeText(params.academicYear),
    normalizeCodePart(params.moduleCode),
    normalizeCodePart(params.programmeCode),
  ].join("|");
}

function buildProgrammeStreamKey(params: {
  programmeCode: string | null | undefined;
  streamCode: string | null | undefined;
}) {
  return [
    normalizeCodePart(params.programmeCode),
    normalizeStreamKey(params.streamCode),
  ].join("|");
}

function buildStudentNumberMap(params: {
  studentNumbers: TimetableStudentNumberRow[];
  moduleEnrollments: ModuleEnrollmentRow[];
}) {
  const map = new Map<string, StudentNumberLikeRow>();

  /*
    Priority:
    1. module_enrollment as fallback/source data
    2. timetable_student_numbers as user-edited final value
  */
  for (const row of params.moduleEnrollments) {
    const key = buildStudentNumberKey({
      academicYear: row.academic_year,
      moduleCode: row.module_code,
      programmeCode: row.programme_code,
    });

    map.set(key, {
      academic_year: row.academic_year,
      module_code: row.module_code,
      programme_code: row.programme_code,
      expected_student_number: row.expected_student_number,
      actual_student_number: row.actual_student_number,
    });
  }

  for (const row of params.studentNumbers) {
    const key = buildStudentNumberKey({
      academicYear: row.academic_year,
      moduleCode: row.module_code,
      programmeCode: row.programme_code,
    });

    map.set(key, {
      academic_year: row.academic_year,
      module_code: row.module_code,
      programme_code: row.programme_code,
      expected_student_number: row.expected_student_number,
      actual_student_number: row.actual_student_number,
    });
  }

  return map;
}

function getStudentNumberForModule(params: {
  module: TimetablePlanningModuleRow;
  studentNumberMap: ReturnType<typeof buildStudentNumberMap>;
}) {
  const key = buildStudentNumberKey({
    academicYear: params.module.academic_year,
    moduleCode: params.module.module_code,
    programmeCode: params.module.programme_code,
  });

  return params.studentNumberMap.get(key) ?? null;
}

async function getStreamAbbrMapForModules(
  selectedModules: TimetablePlanningModuleRow[]
) {
  const programmeCodes = [
    ...new Set(
      selectedModules
        .map((module) => normalizeText(module.programme_code))
        .filter(Boolean)
    ),
  ];

  if (programmeCodes.length === 0) {
    return new Map<string, string | null>();
  }

  /*
    stream_abbr is stored in programmes table.

    Current programmes table fields:
    - programme_code
    - programme_stream
    - stream_abbr

    Note:
    programmes table currently does not have academic_year,
    so lookup is by programme_code + programme_stream.
  */
  const { data, error } = await supabase
    .from("programmes")
    .select("programme_code, programme_stream, stream_abbr")
    .in("programme_code", programmeCodes);

  if (error) throw error;

  const map = new Map<string, string | null>();

  for (const row of (data ?? []) as ProgrammeStreamAbbrRow[]) {
    const key = buildProgrammeStreamKey({
      programmeCode: row.programme_code,
      streamCode: row.programme_stream,
    });

    map.set(key, row.stream_abbr ?? null);
  }

  return map;
}

function getStreamAbbrForModule(params: {
  module: TimetablePlanningModuleRow;
  streamAbbrMap: Map<string, string | null>;
}) {
  const key = buildProgrammeStreamKey({
    programmeCode: params.module.programme_code,
    streamCode: params.module.stream_code,
  });

  const streamAbbr = params.streamAbbrMap.get(key);

  /*
    Fallback order:
    1. programmes.stream_abbr
    2. timetable_planning_modules.stream_code
    3. STREAM
  */
  return (
    normalizeCodePart(streamAbbr) ||
    normalizeCodePart(params.module.stream_code) ||
    "STREAM"
  );
}

function generateManualCombinedCodeFromModules(params: {
  selectedModules: TimetablePlanningModuleRow[];
  streamAbbrMap: Map<string, string | null>;
}) {
  const modules = params.selectedModules;

  if (modules.length === 0) {
    return "MANUAL";
  }

  const moduleCodes = uniqueSorted(modules.map((module) => module.module_code));
  const programmeCodes = uniqueSorted(
    modules.map((module) => module.programme_code)
  );

  /*
    Rule 3:
    Different module_code:
    module_code1_module_code2...
    Ignore programme_code and stream.
  */
  if (moduleCodes.length > 1) {
    return moduleCodes.join("_");
  }

  const moduleCode = moduleCodes[0] || "MODULE";

  /*
    Rule 1:
    Same module_code, different programme_code:
    module_code + programme_code1 + programme_code2...
    Ignore stream.
  */
  if (programmeCodes.length > 1) {
    return [moduleCode, ...programmeCodes].join("_");
  }

  const streamAbbrs = uniqueSorted(
    modules.map((module) =>
      getStreamAbbrForModule({
        module,
        streamAbbrMap: params.streamAbbrMap,
      })
    )
  );

  /*
    Rule 2:
    Same module_code, same programme_code, different stream:
    module_code + stream_abbr1 + stream_abbr2...
    Ignore programme.
  */
  if (streamAbbrs.length > 1) {
    return [moduleCode, ...streamAbbrs].join("_");
  }

  /*
    Fallback:
    Same module_code, same programme_code, same stream.
  */
  return moduleCode;
}

export function validateManualCombineSelection(
  selectedModules: TimetablePlanningModuleRow[]
) {
  if (selectedModules.length < 2) {
    return {
      valid: false,
      message: "Please select at least two modules.",
    };
  }

  const academicYears = [
    ...new Set(selectedModules.map((module) => module.academic_year)),
  ];

  if (academicYears.length !== 1) {
    return {
      valid: false,
      message: "Only modules in the same academic year can be manually combined.",
    };
  }

  const terms = [...new Set(selectedModules.map((module) => module.module_term))];

  if (terms.length !== 1) {
    return {
      valid: false,
      message: "Only same-term modules can be manually combined.",
    };
  }

  const alreadyManualCombined = selectedModules.filter((module) =>
    Boolean(module.manual_combine_group_id)
  );

  if (alreadyManualCombined.length > 0) {
    return {
      valid: false,
      message:
        "Already manually combined modules cannot be combined again. Please undo the existing manual combine first.",
    };
  }

  const moduleCodes = uniqueSorted(
    selectedModules.map((module) => module.module_code)
  );
  const programmeCodes = uniqueSorted(
    selectedModules.map((module) => module.programme_code)
  );

  if (moduleCodes.length === 1 && programmeCodes.length === 1) {
    const distinctStreams = new Set(
      selectedModules
        .map((module) => normalizeStreamKey(module.stream_code))
        .filter((stream) => !isCommonStream(stream))
    );

    if (distinctStreams.size > 1) {
      return {
        valid: false,
        message:
          "Same programme and module code across different streams are combined automatically on the combine step.",
      };
    }
  }

  return {
    valid: true,
    message: "",
  };
}

function calculateManualCombineTotals(params: {
  selectedModules: TimetablePlanningModuleRow[];
  studentNumbers: TimetableStudentNumberRow[];
  moduleEnrollments: ModuleEnrollmentRow[];
}) {
  const studentNumberMap = buildStudentNumberMap({
    studentNumbers: params.studentNumbers,
    moduleEnrollments: params.moduleEnrollments,
  });

  const seenStudentNumberKeys = new Set<string>();
  const relatedStudentNumbers: StudentNumberLikeRow[] = [];

  for (const module of params.selectedModules) {
    const studentNumber = getStudentNumberForModule({
      module,
      studentNumberMap,
    });

    if (!studentNumber) continue;

    const dedupeKey = buildStudentNumberKey({
      academicYear: studentNumber.academic_year,
      moduleCode: studentNumber.module_code,
      programmeCode: studentNumber.programme_code,
    });

    if (seenStudentNumberKeys.has(dedupeKey)) continue;

    seenStudentNumberKeys.add(dedupeKey);
    relatedStudentNumbers.push(studentNumber);
  }

  const totalExpected = relatedStudentNumbers.reduce(
    (sum, row) => sum + Number(row.expected_student_number ?? 0),
    0
  );

  const allActualComplete =
    relatedStudentNumbers.length > 0 &&
    relatedStudentNumbers.every((row) => row.actual_student_number !== null);

  const totalActual = allActualComplete
    ? relatedStudentNumbers.reduce(
        (sum, row) => sum + Number(row.actual_student_number ?? 0),
        0
      )
    : null;

  return {
    totalExpected,
    totalActual,
    actualStatus: allActualComplete ? "complete" : "incomplete",
  } as const;
}

export async function createManualCombineGroup(params: {
  selectedModules: TimetablePlanningModuleRow[];
  createdBy: string;
  /**
   * Programme intra-stream auto combine: combined_code = module code only
   * (no stream/programme suffix, no term suffix). Term stays in module_term column.
   */
  combinedCodeBase?: string;
}) {
  const validation = validateManualCombineSelection(params.selectedModules);

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const first = params.selectedModules[0];

  /*
    New manual combine naming mechanism:

    1. Same module_code + different programme_code
       => module_code + programme_code1 + programme_code2

    2. Same module_code + same programme_code + different stream
       => module_code + stream_abbr1 + stream_abbr2

    3. Different module_code
       => module_code1 + module_code2

    Term is appended at the end.
  */
  const combinedCode = params.combinedCodeBase
    ? normalizeCodePart(params.combinedCodeBase)
    : `${generateManualCombinedCodeFromModules({
        selectedModules: params.selectedModules,
        streamAbbrMap: await getStreamAbbrMapForModules(params.selectedModules),
      })}_${normalizeCodePart(first.module_term)}`;

  const selectedPlanningModuleIds = params.selectedModules.map(
    (module) => module.id
  );

  const [
    { data: studentData, error: studentError },
    { data: enrollmentData, error: enrollmentError },
  ] = await Promise.all([
    supabase
      .from("timetable_student_numbers")
      .select("*")
      .eq("academic_year", first.academic_year),
    supabase
      .from("module_enrollment")
      .select("*")
      .eq("academic_year", first.academic_year),
  ]);

  if (studentError) throw studentError;
  if (enrollmentError) throw enrollmentError;

  const studentNumbers = (studentData ?? []) as TimetableStudentNumberRow[];
  const moduleEnrollments = (enrollmentData ?? []) as ModuleEnrollmentRow[];

  const totals = calculateManualCombineTotals({
    selectedModules: params.selectedModules,
    studentNumbers,
    moduleEnrollments,
  });

  /*
    Prevent duplicate unique constraint error.

    If the same academic_year + combined_code + module_term already exists,
    repair/sync the existing group instead of inserting a duplicate row.
  */
  const { data: existingGroupData, error: existingGroupError } = await supabase
    .from("combine_groups")
    .select("*")
    .eq("academic_year", first.academic_year)
    .eq("combined_code", combinedCode)
    .eq("module_term", first.module_term)
    .maybeSingle();

  if (existingGroupError) throw existingGroupError;

  if (existingGroupData) {
    const existingGroup = existingGroupData as CombineGroupRow;

    const { error: updateExistingGroupError } = await supabase
      .from("combine_groups")
      .update({
        combine_type: "manual",
        total_expected_student_number: totals.totalExpected,
        total_actual_student_number: totals.totalActual,
        actual_student_number_status: totals.actualStatus,
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", existingGroup.id);

    if (updateExistingGroupError) throw updateExistingGroupError;

    const { data: existingRelationsData, error: existingRelationsError } =
      await supabase
        .from("combine_group_modules")
        .select("planning_module_id")
        .eq("combine_group_id", existingGroup.id);

    if (existingRelationsError) throw existingRelationsError;

    const existingPlanningModuleIdSet = new Set(
      (existingRelationsData ?? []).map(
        (relation) => relation.planning_module_id
      )
    );

    const missingRelationPayload = params.selectedModules
      .filter((module) => !existingPlanningModuleIdSet.has(module.id))
      .map((module) => ({
        combine_group_id: existingGroup.id,
        planning_module_id: module.id,
      }));

    if (missingRelationPayload.length > 0) {
      const { error: insertMissingRelationError } = await supabase
        .from("combine_group_modules")
        .insert(missingRelationPayload);

      if (insertMissingRelationError) throw insertMissingRelationError;
    }

    /*
      Manual combine owns these modules.

      natural_combine_code is explicitly cleared because natural combine is
      now deprecated.
    */
    const { error: syncPlanningError } = await supabase
      .from("timetable_planning_modules")
      .update({
        manual_combine_group_id: existingGroup.id,
        natural_combine_code: null,
      })
      .in("id", selectedPlanningModuleIds);

    if (syncPlanningError) throw syncPlanningError;

    return existingGroup;
  }

  const { data: group, error: groupError } = await supabase
    .from("combine_groups")
    .insert({
      academic_year: first.academic_year,
      combined_code: combinedCode,
      combine_type: "manual",
      module_term: first.module_term,
      total_expected_student_number: totals.totalExpected,
      total_actual_student_number: totals.totalActual,
      actual_student_number_status: totals.actualStatus,
      status: "confirmed",
      created_by: params.createdBy,
      confirmed_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (groupError) throw groupError;

  const groupRow = group as CombineGroupRow;

  try {
    const relationPayload = params.selectedModules.map((module) => ({
      combine_group_id: groupRow.id,
      planning_module_id: module.id,
    }));

    const { error: relationError } = await supabase
      .from("combine_group_modules")
      .insert(relationPayload);

    if (relationError) throw relationError;

    const { error: planningError } = await supabase
      .from("timetable_planning_modules")
      .update({
        manual_combine_group_id: groupRow.id,
        natural_combine_code: null,
      })
      .in("id", selectedPlanningModuleIds);

    if (planningError) throw planningError;

    return groupRow;
  } catch (error) {
    /*
      Best-effort cleanup.

      If relation insert or planning module update fails, remove the newly
      created manual group to avoid orphan records in combine_groups.
    */
    await supabase
      .from("combine_group_modules")
      .delete()
      .eq("combine_group_id", groupRow.id);

    await supabase
      .from("combine_groups")
      .delete()
      .eq("id", groupRow.id)
      .eq("combine_type", "manual");

    throw error;
  }
}

export async function listManualCombineGroups(params: {
  academicYear: string;
  programmeCode?: string;
  streamCode?: string;
  moduleTerm?: ModuleTerm;
}) {
  const [
    { data: groupData, error: groupError },
    { data: relationData, error: relationError },
    { data: planningData, error: planningError },
    { data: studentData, error: studentError },
    { data: enrollmentData, error: enrollmentError },
  ] = await Promise.all([
    supabase
      .from("combine_groups")
      .select("*")
      .eq("academic_year", params.academicYear)
      .eq("combine_type", "manual")
      .order("combined_code")
      .order("module_term"),
    supabase.from("combine_group_modules").select("*"),
    supabase
      .from("timetable_planning_modules")
      .select("*")
      .eq("academic_year", params.academicYear),
    supabase
      .from("timetable_student_numbers")
      .select("*")
      .eq("academic_year", params.academicYear),
    supabase
      .from("module_enrollment")
      .select("*")
      .eq("academic_year", params.academicYear),
  ]);

  if (groupError) throw groupError;
  if (relationError) throw relationError;
  if (planningError) throw planningError;
  if (studentError) throw studentError;
  if (enrollmentError) throw enrollmentError;

  const groups = (groupData ?? []) as CombineGroupRow[];

  const relations = (relationData ?? []) as Array<{
    combine_group_id: string;
    planning_module_id: string;
  }>;

  const planningModules = (planningData ?? []) as TimetablePlanningModuleRow[];
  const studentNumbers = (studentData ?? []) as TimetableStudentNumberRow[];
  const moduleEnrollments = (enrollmentData ?? []) as ModuleEnrollmentRow[];

  const planningModuleMap = new Map(
    planningModules.map((module) => [module.id, module])
  );

  const studentNumberMap = buildStudentNumberMap({
    studentNumbers,
    moduleEnrollments,
  });

  const results: ManualCombineGroupWithDetails[] = [];

  for (const group of groups) {
    if (params.moduleTerm && group.module_term !== params.moduleTerm) {
      continue;
    }

    const groupRelations = relations.filter(
      (relation) => relation.combine_group_id === group.id
    );

    const originalModules = groupRelations
      .map((relation) => planningModuleMap.get(relation.planning_module_id))
      .filter(Boolean) as TimetablePlanningModuleRow[];

    if (originalModules.length === 0) {
      continue;
    }

    /*
      Manual combine group is global.

      It should be shown when ANY original module inside the group
      belongs to the currently selected programme / stream.
    */
    const isRelevant = originalModules.some((module) =>
      isPlanningModuleRelevantToFilter({
        module,
        programmeCode: params.programmeCode,
        streamCode: params.streamCode,
      })
    );

    if (!isRelevant) {
      continue;
    }

    const details = originalModules
      .map<ManualCombineGroupDetailRow>((module) => {
        const studentNumber = getStudentNumberForModule({
          module,
          studentNumberMap,
        });

        return {
          combine_group_id: group.id,
          planning_module_id: module.id,
          module_code: module.module_code,
          module_name: module.module_name ?? null,
          programme_code: module.programme_code,
          stream_code: module.stream_code,
          module_term: module.module_term,
          expected_student_number:
            studentNumber?.expected_student_number ?? null,
          actual_student_number: studentNumber?.actual_student_number ?? null,
        };
      })
      .sort((a, b) => {
        const programmeDiff = a.programme_code.localeCompare(b.programme_code);

        if (programmeDiff !== 0) return programmeDiff;

        const streamDiff = a.stream_code.localeCompare(b.stream_code);

        if (streamDiff !== 0) return streamDiff;

        return a.module_code.localeCompare(b.module_code);
      });

    results.push({
      ...group,
      details,
    });
  }

  return results;
}

export async function deleteManualCombineGroup(groupId: string) {
  const { data: relations, error: relationFetchError } = await supabase
    .from("combine_group_modules")
    .select("planning_module_id")
    .eq("combine_group_id", groupId);

  if (relationFetchError) throw relationFetchError;

  const planningModuleIds = (relations ?? []).map(
    (relation) => relation.planning_module_id
  );

  if (planningModuleIds.length > 0) {
    const { error: planningError } = await supabase
      .from("timetable_planning_modules")
      .update({
        manual_combine_group_id: null,
        natural_combine_code: null,
      })
      .in("id", planningModuleIds);

    if (planningError) throw planningError;
  }

  const { error: relationDeleteError } = await supabase
    .from("combine_group_modules")
    .delete()
    .eq("combine_group_id", groupId);

  if (relationDeleteError) throw relationDeleteError;

  const { error: groupDeleteError } = await supabase
    .from("combine_groups")
    .delete()
    .eq("id", groupId)
    .eq("combine_type", "manual");

  if (groupDeleteError) throw groupDeleteError;
}
