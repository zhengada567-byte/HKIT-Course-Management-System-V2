import { supabase } from "../lib/supabase";
import { filterActivePlanningModules } from "../lib/timetablePlanningOffering";
import type {
  CombineGroupRow,
  ModuleEnrollmentRow,
  ModuleTerm,
  TimetablePlanningModuleRow,
  TimetableStudentNumberRow,
} from "../types";

interface NaturalCombineCandidate {
  academic_year: string;
  module_code: string;
  module_term: ModuleTerm;
  combined_code: string;
  rows: TimetablePlanningModuleRow[];
}

interface StudentNumberLikeRow {
  academic_year: string;
  module_code: string;
  module_term?: ModuleTerm | string | null;
  programme_code: string;
  stream_code?: string | null;
  expected_student_number: number;
  actual_student_number: number | null;
}

export interface NaturalCombineGroupDetailRow {
  combine_group_id: string;
  planning_module_id: string;
  module_code: string;
  module_name: string | null;
  programme_code: string;
  stream_code: string;
  expected_student_number: number | null;
  actual_student_number: number | null;
}

export interface NaturalCombineGroupWithDetails extends CombineGroupRow {
  details: NaturalCombineGroupDetailRow[];
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

function generateNaturalCombineCodeWithTerm(
  moduleCode: string,
  moduleTerm: string
) {
  return `AUTO_${normalizeCodePart(moduleCode)}_${normalizeCodePart(
    moduleTerm
  )}`;
}

function buildNaturalCombineDetectionKey(row: TimetablePlanningModuleRow) {
  return [
    row.academic_year,
    normalizeCodePart(row.module_code),
    normalizeCodePart(row.module_term),
  ].join("|");
}

function buildOfferingIdentity(row: TimetablePlanningModuleRow) {
  return [
    normalizeCodePart(row.programme_code),
    normalizeStreamKey(row.stream_code),
  ].join("|");
}

function isPlanningModuleRelevantToFilter(params: {
  module: TimetablePlanningModuleRow;
  programmeCode?: string;
  streamCode?: string;
}) {
  const programmeCode = normalizeText(params.programmeCode);
  const streamCode = normalizeStreamKey(params.streamCode);

  if (!programmeCode) {
    return true;
  }

  if (params.module.programme_code !== programmeCode) {
    return false;
  }

  if (!normalizeText(params.streamCode)) {
    return true;
  }

  const moduleStream = normalizeStreamKey(params.module.stream_code);

  return isCommonStream(moduleStream) || moduleStream === streamCode;
}

export function detectNaturalCombineGroups(
  planningModules: TimetablePlanningModuleRow[]
) {
  const map = new Map<string, TimetablePlanningModuleRow[]>();

  for (const module of planningModules) {
    if (!module.module_code || !module.module_term) continue;

    const key = buildNaturalCombineDetectionKey(module);

    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key)!.push(module);
  }

  const candidates: NaturalCombineCandidate[] = [];

  for (const [, rows] of map) {
    if (rows.length <= 1) continue;

    const offeringIdentities = new Set(rows.map(buildOfferingIdentity));

    /*
      Natural combine happens when the same module code + term appears
      in more than one offering context.

      Offering context = programme_code + stream_code.

      Supported:
      - different programmes
      - same programme but different streams
      - mixed programme / stream cases
    */
    if (offeringIdentities.size <= 1) continue;

    const first = rows[0];

    candidates.push({
      academic_year: first.academic_year,
      module_code: first.module_code,
      module_term: first.module_term,
      combined_code: generateNaturalCombineCodeWithTerm(
        first.module_code,
        first.module_term
      ),
      rows,
    });
  }

  return candidates;
}

function buildStudentNumberKey(params: {
  academicYear: string;
  moduleCode: string;
  programmeCode: string;
  streamCode?: string | null;
  moduleTerm?: string | null;
}) {
  return [
    normalizeText(params.academicYear),
    normalizeCodePart(params.moduleCode),
    normalizeCodePart(params.programmeCode),
    normalizeStreamKey(params.streamCode),
    normalizeCodePart(params.moduleTerm),
  ].join("|");
}

function buildStudentNumberFallbackKey(params: {
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

function buildStudentNumberMap(params: {
  studentNumbers: TimetableStudentNumberRow[];
  moduleEnrollments: ModuleEnrollmentRow[];
}) {
  const exactMap = new Map<string, StudentNumberLikeRow>();
  const fallbackMap = new Map<string, StudentNumberLikeRow>();

  /*
    Excel uploaded defaults first.
  */
  for (const row of params.moduleEnrollments) {
    const studentRow = row as StudentNumberLikeRow;

    const exactKey = buildStudentNumberKey({
      academicYear: studentRow.academic_year,
      moduleCode: studentRow.module_code,
      programmeCode: studentRow.programme_code,
      streamCode: studentRow.stream_code,
      moduleTerm: studentRow.module_term,
    });

    const fallbackKey = buildStudentNumberFallbackKey({
      academicYear: studentRow.academic_year,
      moduleCode: studentRow.module_code,
      programmeCode: studentRow.programme_code,
    });

    exactMap.set(exactKey, studentRow);
    fallbackMap.set(fallbackKey, studentRow);
  }

  /*
    Programme Leader saved values override uploaded defaults.
  */
  for (const row of params.studentNumbers) {
    const studentRow = row as StudentNumberLikeRow;

    const exactKey = buildStudentNumberKey({
      academicYear: studentRow.academic_year,
      moduleCode: studentRow.module_code,
      programmeCode: studentRow.programme_code,
      streamCode: studentRow.stream_code,
      moduleTerm: studentRow.module_term,
    });

    const fallbackKey = buildStudentNumberFallbackKey({
      academicYear: studentRow.academic_year,
      moduleCode: studentRow.module_code,
      programmeCode: studentRow.programme_code,
    });

    exactMap.set(exactKey, studentRow);
    fallbackMap.set(fallbackKey, studentRow);
  }

  return {
    exactMap,
    fallbackMap,
  };
}

function findStudentNumberForPlanningModule(params: {
  module: TimetablePlanningModuleRow;
  studentNumberMap: ReturnType<typeof buildStudentNumberMap>;
}) {
  const exactKey = buildStudentNumberKey({
    academicYear: params.module.academic_year,
    moduleCode: params.module.module_code,
    programmeCode: params.module.programme_code,
    streamCode: params.module.stream_code,
    moduleTerm: params.module.module_term,
  });

  const fallbackKey = buildStudentNumberFallbackKey({
    academicYear: params.module.academic_year,
    moduleCode: params.module.module_code,
    programmeCode: params.module.programme_code,
  });

  return (
    params.studentNumberMap.exactMap.get(exactKey) ??
    params.studentNumberMap.fallbackMap.get(fallbackKey) ??
    null
  );
}

export function calculateNaturalCombineStudentTotals(params: {
  candidate: NaturalCombineCandidate;
  studentNumbers: TimetableStudentNumberRow[];
  moduleEnrollments?: ModuleEnrollmentRow[];
}) {
  const studentNumberMap = buildStudentNumberMap({
    studentNumbers: params.studentNumbers,
    moduleEnrollments: params.moduleEnrollments ?? [],
  });

  const relatedStudentNumbers = params.candidate.rows
    .map((module) =>
      findStudentNumberForPlanningModule({
        module,
        studentNumberMap,
      })
    )
    .filter(Boolean) as StudentNumberLikeRow[];

  const totalExpected = relatedStudentNumbers.reduce(
    (sum, row) => sum + Number(row.expected_student_number ?? 0),
    0
  );

  const allActualComplete =
    relatedStudentNumbers.length === params.candidate.rows.length &&
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

/*
  Important:
  applyNaturalCombine now loads unfiltered planning modules internally.

  Do NOT pass filtered UI planning modules into natural combine detection.
  Natural combine must see all programme/stream offerings in the academic year.
*/
export async function applyNaturalCombine(params: {
  academicYear: string;
  createdBy: string;
}) {
  const { data: planningData, error: planningError } = await supabase
    .from("timetable_planning_modules")
    .select("*")
    .eq("academic_year", params.academicYear)
    .order("programme_code")
    .order("stream_code")
    .order("module_code");

  if (planningError) throw planningError;

  const planningModules = filterActivePlanningModules(
    (planningData ?? []) as TimetablePlanningModuleRow[]
  );

/*
  Important:
  Modules that already belong to a manual combine group must not be
  pulled back into natural combine.

  Manual combine has higher priority than natural combine.
*/
const naturalCombineEligibleModules = planningModules.filter(
  (module) => !module.manual_combine_group_id
);

const candidates = detectNaturalCombineGroups(naturalCombineEligibleModules);


  /*
    Clear old natural combine data first.
    This prevents old AUTO_XXX groups and old relations from interfering
    after detection rules or code format changes.
  */
  const { data: oldNaturalGroups, error: oldGroupError } = await supabase
    .from("combine_groups")
    .select("id")
    .eq("academic_year", params.academicYear)
    .eq("combine_type", "natural_same_module_code");

  if (oldGroupError) throw oldGroupError;

  const oldNaturalGroupIds = (oldNaturalGroups ?? []).map((group) => group.id);

  if (oldNaturalGroupIds.length > 0) {
    const { error: relationDeleteError } = await supabase
      .from("combine_group_modules")
      .delete()
      .in("combine_group_id", oldNaturalGroupIds);

    if (relationDeleteError) throw relationDeleteError;

    const { error: groupDeleteError } = await supabase
      .from("combine_groups")
      .delete()
      .in("id", oldNaturalGroupIds);

    if (groupDeleteError) throw groupDeleteError;
  }

  const [
    { data: studentNumberData, error: studentNumberError },
    { data: enrollmentData, error: enrollmentError },
  ] = await Promise.all([
    supabase
      .from("timetable_student_numbers")
      .select("*")
      .eq("academic_year", params.academicYear),
    supabase
      .from("module_enrollment")
      .select("*")
      .eq("academic_year", params.academicYear),
  ]);

  if (studentNumberError) throw studentNumberError;
  if (enrollmentError) throw enrollmentError;

  const studentNumbers =
    (studentNumberData ?? []) as TimetableStudentNumberRow[];

  const moduleEnrollments =
    (enrollmentData ?? []) as ModuleEnrollmentRow[];

  const createdGroups: CombineGroupRow[] = [];

const { error: resetPlanningError } = await supabase
  .from("timetable_planning_modules")
  .update({
    natural_combine_code: null,
  })
  .eq("academic_year", params.academicYear)
  .is("manual_combine_group_id", null);


  if (resetPlanningError) throw resetPlanningError;

  for (const candidate of candidates) {
    const totals = calculateNaturalCombineStudentTotals({
      candidate,
      studentNumbers,
      moduleEnrollments,
    });

    const { data: group, error: groupError } = await supabase
      .from("combine_groups")
      .upsert(
        {
          academic_year: candidate.academic_year,
          combined_code: candidate.combined_code,
          combine_type: "natural_same_module_code",
          module_term: candidate.module_term,
          total_expected_student_number: totals.totalExpected,
          total_actual_student_number: totals.totalActual,
          actual_student_number_status: totals.actualStatus,
          status: "auto_confirmed",
          created_by: params.createdBy,
          confirmed_at: new Date().toISOString(),
        },
        {
          onConflict: "academic_year,combined_code",
        }
      )
      .select("*")
      .single();

    if (groupError) throw groupError;

    const groupRow = group as CombineGroupRow;

    createdGroups.push(groupRow);

    const planningModuleIds = candidate.rows.map((row) => row.id);

    const { error: updatePlanningError } = await supabase
      .from("timetable_planning_modules")
      .update({
        natural_combine_code: candidate.combined_code,
      })
      .in("id", planningModuleIds);

    if (updatePlanningError) throw updatePlanningError;

    const relationPayload = candidate.rows.map((row) => ({
      combine_group_id: groupRow.id,
      planning_module_id: row.id,
    }));

    const { error: relationError } = await supabase
      .from("combine_group_modules")
      .upsert(relationPayload, {
        onConflict: "combine_group_id,planning_module_id",
      });

    if (relationError) throw relationError;
  }

  return createdGroups;
}

export async function listNaturalCombineGroups(params: {
  academicYear: string;
  programmeCode?: string;
  streamCode?: string;
}) {
  const [
    { data: groupData, error: groupError },
    { data: relationData, error: relationError },
    { data: planningData, error: planningError },
    { data: studentNumberData, error: studentNumberError },
    { data: enrollmentData, error: enrollmentError },
  ] = await Promise.all([
    supabase
      .from("combine_groups")
      .select("*")
      .eq("academic_year", params.academicYear)
      .eq("combine_type", "natural_same_module_code")
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
  if (studentNumberError) throw studentNumberError;
  if (enrollmentError) throw enrollmentError;

  const groups = (groupData ?? []) as CombineGroupRow[];
  const relations = (relationData ?? []) as Array<{
    combine_group_id: string;
    planning_module_id: string;
  }>;

  const planningModules =
    (planningData ?? []) as TimetablePlanningModuleRow[];

  const studentNumbers =
    (studentNumberData ?? []) as TimetableStudentNumberRow[];

  const moduleEnrollments =
    (enrollmentData ?? []) as ModuleEnrollmentRow[];

  const studentNumberMap = buildStudentNumberMap({
    studentNumbers,
    moduleEnrollments,
  });

  const planningModuleMap = new Map(
    planningModules.map((module) => [module.id, module])
  );

  const results: NaturalCombineGroupWithDetails[] = [];

  for (const group of groups) {
    const groupRelations = relations.filter(
      (relation) => relation.combine_group_id === group.id
    );

    const originalModules = groupRelations
      .map((relation) => planningModuleMap.get(relation.planning_module_id))
      .filter(Boolean) as TimetablePlanningModuleRow[];

    if (originalModules.length === 0) {
      continue;
    }

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
      .map<NaturalCombineGroupDetailRow>((module) => {
        const studentNumber = findStudentNumberForPlanningModule({
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
          expected_student_number:
            studentNumber?.expected_student_number ?? null,
          actual_student_number:
            studentNumber?.actual_student_number ?? null,
        };
      })
      .sort((a, b) => {
        const programmeDiff = a.programme_code.localeCompare(
          b.programme_code
        );

        if (programmeDiff !== 0) return programmeDiff;

        return a.stream_code.localeCompare(b.stream_code);
      });

    results.push({
      ...group,
      details,
    });
  }

  return results;
}

export async function refreshNaturalCombineTotals(academicYear: string) {
  const [
    { data: planningData, error: planningError },
    { data: studentData, error: studentError },
    { data: enrollmentData, error: enrollmentError },
    { data: groupData, error: groupError },
    { data: relationData, error: relationError },
  ] = await Promise.all([
    supabase
      .from("timetable_planning_modules")
      .select("*")
      .eq("academic_year", academicYear),
    supabase
      .from("timetable_student_numbers")
      .select("*")
      .eq("academic_year", academicYear),
    supabase
      .from("module_enrollment")
      .select("*")
      .eq("academic_year", academicYear),
    supabase
      .from("combine_groups")
      .select("*")
      .eq("academic_year", academicYear)
      .eq("combine_type", "natural_same_module_code"),
    supabase.from("combine_group_modules").select("*"),
  ]);

  if (planningError) throw planningError;
  if (studentError) throw studentError;
  if (enrollmentError) throw enrollmentError;
  if (groupError) throw groupError;
  if (relationError) throw relationError;

  const planningModules =
    (planningData ?? []) as TimetablePlanningModuleRow[];

  const studentNumbers =
    (studentData ?? []) as TimetableStudentNumberRow[];

  const moduleEnrollments =
    (enrollmentData ?? []) as ModuleEnrollmentRow[];

  const groups = (groupData ?? []) as CombineGroupRow[];

  for (const group of groups) {
    const relations = (relationData ?? []).filter(
      (row) => row.combine_group_id === group.id
    );

    const planningIds = relations.map((row) => row.planning_module_id);

    const rows = planningModules.filter((module) =>
      planningIds.includes(module.id)
    );

    if (rows.length === 0) continue;

    const candidate: NaturalCombineCandidate = {
      academic_year: group.academic_year,
      module_code: rows[0].module_code,
      module_term: group.module_term,
      combined_code: group.combined_code,
      rows,
    };

    const totals = calculateNaturalCombineStudentTotals({
      candidate,
      studentNumbers,
      moduleEnrollments,
    });

    const { error } = await supabase
      .from("combine_groups")
      .update({
        total_expected_student_number: totals.totalExpected,
        total_actual_student_number: totals.totalActual,
        actual_student_number_status: totals.actualStatus,
      })
      .eq("id", group.id);

    if (error) throw error;
  }
}
