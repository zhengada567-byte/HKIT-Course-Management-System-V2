import { supabase } from "../lib/supabase";
import { fetchAllPaginatedRows } from "../lib/supabasePagination";
import {
  getAcademicYearVariants,
  normalizeAcademicYear,
} from "../lib/utils";
import {
  offeredTermFromStudyTerm,
  studyTermToAcademicYear,
} from "../pages/programme-leader/make-study-plan/helpers";
import type { ModuleTerm } from "../types/common";
import { listTimetableClassrooms } from "./timetableScheduleService";

type StudyMode = "FT" | "PT";
type InstanceMode = "Day" | "Night" | "Saturday";

export interface EnrollmentInstanceOption {
  moduleCode: string;
  moduleInstanceCode: string;
  instanceMode: InstanceMode | null;
  splitGroupSize: number;
  roomSize: number | null;
}

export interface BatchEnrollStudyPlanStudentsParams {
  academicYear: string;
  /** Catalog offered term (Feb / Jun / Sep). */
  offeredTerm: ModuleTerm;
  /** When true (default), only rows with empty enrolled class are updated. */
  onlyEmpty?: boolean;
}

export interface BatchEnrollStudyPlanStudentsResult {
  assignedCount: number;
  skippedCount: number;
  warningCount: number;
  warnings: string[];
}

interface StudyPlanEnrollmentRow {
  id: string;
  student_id: string;
  student_profile_id: string;
  module_code: string;
  programme_code: string;
  programme_stream: string | null;
  study_term: string;
  status: string;
  plan_stage: string;
  enrolled_module_instance_code: string | null;
  study_mode: StudyMode;
}

interface TimetableInstanceRow {
  module_instance_code: string;
  module_code: string;
  module_term: string | null;
  instance_mode: string | null;
  split_group_size: number | null;
}

interface TimetableModuleRow {
  module_instance_code: string;
  base_module_code: string | null;
  module_term: string | null;
  mode: string | null;
  split_group_size: number | null;
}

interface TimetableSessionRow {
  module_instance_code: string;
  room_code: string;
  status: string;
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function normalizeStudyMode(value: string | null | undefined): StudyMode {
  return String(value ?? "").trim().toUpperCase() === "PT" ? "PT" : "FT";
}

function normalizeInstanceMode(
  value: string | null | undefined
): InstanceMode | null {
  const text = normalizeText(value);

  if (text === "Day" || text === "Night" || text === "Saturday") {
    return text;
  }

  return null;
}

function buildAllocationGroupKey(params: {
  academicYear: string;
  programmeCode: string;
  moduleCode: string;
  studyTerm: string;
}) {
  return [
    normalizeAcademicYear(params.academicYear),
    params.programmeCode,
    params.moduleCode,
    params.studyTerm,
  ].join("|");
}

function pickBalancedInstance(
  instanceCodes: string[],
  counts: Map<string, number>,
  seed: string
) {
  if (instanceCodes.length === 0) {
    return null;
  }

  const sorted = [...instanceCodes].sort((a, b) => {
    const countDiff = (counts.get(a) ?? 0) - (counts.get(b) ?? 0);

    if (countDiff !== 0) {
      return countDiff;
    }

    return a.localeCompare(b);
  });

  const minCount = counts.get(sorted[0]!) ?? 0;
  const tied = sorted.filter((code) => (counts.get(code) ?? 0) === minCount);
  const hash = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);

  return tied[hash % tied.length] ?? sorted[0]!;
}

function incrementCount(map: Map<string, number>, code: string) {
  map.set(code, (map.get(code) ?? 0) + 1);
}

async function loadEnrollmentRows(params: {
  academicYear: string;
  offeredTerm: ModuleTerm;
}): Promise<StudyPlanEnrollmentRow[]> {
  const canonicalYear = normalizeAcademicYear(params.academicYear);

  const moduleRows = await fetchAllPaginatedRows<{
    id: string;
    student_id: string;
    student_profile_id: string;
    module_code: string;
    programme_code: string;
    programme_stream: string | null;
    study_term: string | null;
    status: string;
    plan_stage: string;
    enrolled_module_instance_code: string | null;
  }>({
    fetchPage: ({ from, to }) => {
      let query = supabase
        .from("study_plan_modules")
        .select(
          "id, student_id, student_profile_id, module_code, programme_code, programme_stream, study_term, status, plan_stage, enrolled_module_instance_code"
        )
        .eq("status", "planned")
        .not("study_term", "is", null)
        .order("id", { ascending: true })
        .range(from, to);

      return query;
    },
  });

  const profileIds = Array.from(
    new Set(moduleRows.map((row) => normalizeText(row.student_profile_id)).filter(Boolean))
  );

  const studyModeByProfileId = new Map<string, StudyMode>();

  for (let index = 0; index < profileIds.length; index += 100) {
    const chunk = profileIds.slice(index, index + 100);

    const { data, error } = await supabase
      .from("study_plan_students")
      .select("id, study_mode")
      .in("id", chunk);

    if (error) {
      throw error;
    }

    for (const row of data ?? []) {
      studyModeByProfileId.set(
        normalizeText(row.id),
        normalizeStudyMode(row.study_mode)
      );
    }
  }

  const rows: StudyPlanEnrollmentRow[] = [];

  for (const row of moduleRows) {
    const studyTerm = normalizeText(row.study_term);

    if (!studyTerm) {
      continue;
    }

    const rowAcademicYear = normalizeAcademicYear(studyTermToAcademicYear(studyTerm));

    if (rowAcademicYear !== canonicalYear) {
      continue;
    }

    if (offeredTermFromStudyTerm(studyTerm) !== params.offeredTerm) {
      continue;
    }

    rows.push({
      id: row.id,
      student_id: normalizeText(row.student_id),
      student_profile_id: normalizeText(row.student_profile_id),
      module_code: normalizeText(row.module_code).toUpperCase(),
      programme_code: normalizeText(row.programme_code).toUpperCase(),
      programme_stream: row.programme_stream,
      study_term: studyTerm,
      status: row.status,
      plan_stage: row.plan_stage,
      enrolled_module_instance_code: row.enrolled_module_instance_code,
      study_mode: studyModeByProfileId.get(normalizeText(row.student_profile_id)) ?? "FT",
    });
  }

  return rows;
}

async function loadTimetableEnrollmentContext(params: {
  academicYear: string;
  offeredTerm?: ModuleTerm;
}) {
  const canonicalYear = normalizeAcademicYear(params.academicYear);
  const yearVariants = getAcademicYearVariants(canonicalYear);

  const [instances, timetableModules, sessions, classrooms] = await Promise.all([
    fetchAllPaginatedRows<TimetableInstanceRow>({
      fetchPage: ({ from, to }) => {
        let query = supabase
          .from("timetable_module_instances")
          .select(
            "module_instance_code, module_code, module_term, instance_mode, split_group_size"
          )
          .in("academic_year", yearVariants)
          .order("module_instance_code", { ascending: true })
          .range(from, to);

        if (params.offeredTerm) {
          query = query.eq("module_term", params.offeredTerm);
        }

        return query;
      },
    }),
    fetchAllPaginatedRows<TimetableModuleRow>({
      fetchPage: ({ from, to }) => {
        let query = supabase
          .from("timetable_modules")
          .select(
            "module_instance_code, base_module_code, module_term, mode, split_group_size"
          )
          .in("academic_year", yearVariants)
          .order("module_instance_code", { ascending: true })
          .range(from, to);

        if (params.offeredTerm) {
          query = query.eq("module_term", params.offeredTerm);
        }

        return query;
      },
    }),
    fetchAllPaginatedRows<TimetableSessionRow>({
      fetchPage: ({ from, to }) =>
        supabase
          .from("timetable_sessions")
          .select("module_instance_code, room_code, status")
          .in("academic_year", yearVariants)
          .order("session_date", { ascending: true })
          .range(from, to),
    }),
    listTimetableClassrooms(),
  ]);

  const roomSizeByCode = new Map<string, number>();

  for (const room of classrooms) {
    roomSizeByCode.set(room.room_code, Number(room.room_size ?? 0));
  }

  const roomSizeByInstance = new Map<string, number>();

  for (const session of sessions) {
    if (normalizeText(session.status) === "cancel") {
      continue;
    }

    const instanceCode = normalizeText(session.module_instance_code);

    if (!instanceCode || roomSizeByInstance.has(instanceCode)) {
      continue;
    }

    const roomCode = normalizeText(session.room_code);
    const roomSize = roomSizeByCode.get(roomCode);

    if (roomSize !== undefined) {
      roomSizeByInstance.set(instanceCode, roomSize);
    }
  }

  const modeByInstance = new Map<string, InstanceMode | null>();
  const splitGroupSizeByInstance = new Map<string, number>();
  const instancesByModuleCode = new Map<string, EnrollmentInstanceOption[]>();

  const registerInstance = (option: EnrollmentInstanceOption) => {
    const moduleCode = normalizeText(option.moduleCode).toUpperCase();
    const instanceCode = normalizeText(option.moduleInstanceCode);

    if (!moduleCode || !instanceCode) {
      return;
    }

    modeByInstance.set(instanceCode, option.instanceMode);
    splitGroupSizeByInstance.set(instanceCode, option.splitGroupSize);

    const existing = instancesByModuleCode.get(moduleCode) ?? [];
    const seen = new Set(existing.map((row) => row.moduleInstanceCode));

    if (!seen.has(instanceCode)) {
      existing.push(option);
      instancesByModuleCode.set(moduleCode, existing);
    }
  };

  for (const row of instances) {
    const instanceCode = normalizeText(row.module_instance_code);
    const moduleCode = normalizeText(row.module_code).toUpperCase();

    if (!instanceCode || !moduleCode) {
      continue;
    }

    registerInstance({
      moduleCode,
      moduleInstanceCode: instanceCode,
      instanceMode: normalizeInstanceMode(row.instance_mode),
      splitGroupSize: Number(row.split_group_size ?? 1),
      roomSize: roomSizeByInstance.get(instanceCode) ?? null,
    });
  }

  for (const row of timetableModules) {
    const instanceCode = normalizeText(row.module_instance_code);
    const moduleCode = normalizeText(row.base_module_code).toUpperCase();

    if (!instanceCode || !moduleCode) {
      continue;
    }

    if (modeByInstance.has(instanceCode)) {
      continue;
    }

    registerInstance({
      moduleCode,
      moduleInstanceCode: instanceCode,
      instanceMode: normalizeInstanceMode(row.mode),
      splitGroupSize: Number(row.split_group_size ?? 1),
      roomSize: roomSizeByInstance.get(instanceCode) ?? null,
    });
  }

  return {
    instancesByModuleCode,
    roomSizeByInstance,
    modeByInstance,
    splitGroupSizeByInstance,
  };
}

function resolveModuleInstances(
  moduleCode: string,
  instancesByModuleCode: Map<string, EnrollmentInstanceOption[]>
) {
  const direct = instancesByModuleCode.get(moduleCode) ?? [];

  if (direct.length > 0) {
    return direct;
  }

  return [];
}

function isSplitModule(instances: EnrollmentInstanceOption[]) {
  if (instances.length <= 1) {
    return instances[0]?.splitGroupSize > 1;
  }

  return true;
}

function allocateGroup(params: {
  rows: StudyPlanEnrollmentRow[];
  instances: EnrollmentInstanceOption[];
  warnings: string[];
  groupLabel: string;
}) {
  const assignments = new Map<string, string>();
  const instances = params.instances;

  if (instances.length === 0) {
    for (const row of params.rows) {
      params.warnings.push(
        `${params.groupLabel}: no timetable instances found for ${row.student_id} / ${row.module_code}.`
      );
    }

    return assignments;
  }

  if (!isSplitModule(instances)) {
    const code =
      instances[0]?.moduleInstanceCode ?? instances[0]?.moduleCode ?? "";

    for (const row of params.rows) {
      assignments.set(row.id, code);
    }

    return assignments;
  }

  const dayInstances = instances.filter((row) => row.instanceMode === "Day");
  const nightInstances = instances.filter((row) => row.instanceMode === "Night");
  const saturdayInstances = instances.filter(
    (row) => row.instanceMode === "Saturday"
  );
  const ptInstances = [...nightInstances, ...saturdayInstances];

  const sortedRows = [...params.rows].sort((a, b) =>
    a.student_id.localeCompare(b.student_id)
  );

  const ftRows = sortedRows.filter((row) => row.study_mode === "FT");
  const ptRows = sortedRows.filter((row) => row.study_mode === "PT");

  const assignedCounts = new Map<string, number>();

  const pickDayInstanceWithCapacity = (seed: string) => {
    const available = dayInstances
      .filter((item) => item.roomSize !== null && item.roomSize !== undefined)
      .filter((item) => {
        const assigned = assignedCounts.get(item.moduleInstanceCode) ?? 0;
        return assigned < Number(item.roomSize ?? 0);
      })
      .map((item) => item.moduleInstanceCode);

    return pickBalancedInstance(available, assignedCounts, seed);
  };

  for (const row of ftRows) {
    const dayCode = pickDayInstanceWithCapacity(row.student_id);

    if (dayCode) {
      assignments.set(row.id, dayCode);
      incrementCount(assignedCounts, dayCode);
      continue;
    }

    if (ptInstances.length > 0) {
      const code = pickBalancedInstance(
        ptInstances.map((item) => item.moduleInstanceCode),
        assignedCounts,
        row.student_id
      );

      if (code) {
        assignments.set(row.id, code);
        incrementCount(assignedCounts, code);
        continue;
      }
    }

    params.warnings.push(
      `${params.groupLabel}: FT student ${row.student_id} / ${row.module_code} could not be assigned (no Day/Night/Sat instance with capacity).`
    );
  }

  for (const row of ptRows) {
    if (ptInstances.length === 0) {
      params.warnings.push(
        `${params.groupLabel}: PT student ${row.student_id} / ${row.module_code} requires Night or Saturday class, but none is available.`
      );
      continue;
    }

    const code = pickBalancedInstance(
      ptInstances.map((item) => item.moduleInstanceCode),
      assignedCounts,
      row.student_id
    );

    if (!code) {
      params.warnings.push(
        `${params.groupLabel}: PT student ${row.student_id} / ${row.module_code} could not be assigned.`
      );
      continue;
    }

    assignments.set(row.id, code);
    incrementCount(assignedCounts, code);
  }

  return assignments;
}

export async function loadEnrollmentInstanceCatalog(params: {
  academicYear: string;
  offeredTerm?: ModuleTerm;
}): Promise<EnrollmentInstanceOption[]> {
  const context = await loadTimetableEnrollmentContext(params);
  const all: EnrollmentInstanceOption[] = [];

  for (const options of context.instancesByModuleCode.values()) {
    all.push(...options);
  }

  return all.sort((a, b) =>
    a.moduleInstanceCode.localeCompare(b.moduleInstanceCode)
  );
}

export async function batchEnrollStudyPlanStudents(
  params: BatchEnrollStudyPlanStudentsParams
): Promise<BatchEnrollStudyPlanStudentsResult> {
  const onlyEmpty = params.onlyEmpty !== false;
  const rows = await loadEnrollmentRows(params);
  const context = await loadTimetableEnrollmentContext(params);

  const warnings: string[] = [];
  const updates = new Map<string, string>();
  let skippedCount = 0;

  const groups = new Map<string, StudyPlanEnrollmentRow[]>();

  for (const row of rows) {
    if (onlyEmpty && normalizeText(row.enrolled_module_instance_code)) {
      skippedCount += 1;
      continue;
    }

    const key = buildAllocationGroupKey({
      academicYear: params.academicYear,
      programmeCode: row.programme_code,
      moduleCode: row.module_code,
      studyTerm: row.study_term,
    });

    const existing = groups.get(key) ?? [];
    existing.push(row);
    groups.set(key, existing);
  }

  for (const [, groupRows] of groups) {
    const sample = groupRows[0]!;

    const instances = resolveModuleInstances(
      sample.module_code,
      context.instancesByModuleCode
    );

    const assignments = allocateGroup({
      rows: groupRows,
      instances,
      warnings,
      groupLabel: `${sample.programme_code} / ${sample.module_code} / ${sample.study_term}`,
    });

    for (const [rowId, code] of assignments) {
      updates.set(rowId, code);
    }
  }

  let assignedCount = 0;

  for (const [rowId, code] of updates) {
    const { error } = await supabase
      .from("study_plan_modules")
      .update({
        enrolled_module_instance_code: code,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rowId);

    if (error) {
      throw error;
    }

    assignedCount += 1;
  }

  return {
    assignedCount,
    skippedCount,
    warningCount: warnings.length,
    warnings,
  };
}
