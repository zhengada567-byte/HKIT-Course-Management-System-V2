import { fetchAllPaginatedRows } from "../lib/supabasePagination";
import { supabase } from "../lib/supabase";
import { schedulingWeekdayLabel } from "../lib/timetableSchedulingRules";
import { normalizeAcademicYear } from "../lib/utils";
import {
  offeredTermFromStudyTerm,
  studyTermToAcademicYear,
} from "../pages/programme-leader/make-study-plan/helpers";
import type { ModuleTerm } from "../types/common";
import { listTimetableModuleInstances } from "./timetableModuleInstanceService";
import {
  listTimetableSessions,
  type TimetableScheduleTerm,
} from "./timetableScheduleService";

export type WeeklyPatternSlot = {
  weekday: number;
  start: string;
  end: string;
  roomCode: string;
};

export type StudentWeeklyTimetableConflict = {
  studentId: string;
  studentName: string;
  programmeCode: string;
  programmeStream: string;
  studyMode: string;
  weekday: number;
  weekdayLabel: string;
  overlapStart: string;
  overlapEnd: string;
  moduleCodeA: string;
  moduleInstanceCodeA: string;
  moduleCodeB: string;
  moduleInstanceCodeB: string;
  timeWindowA: string;
  timeWindowB: string;
  roomCodeA: string;
  roomCodeB: string;
};

export type StudentWeeklyTimetableWarning = {
  studentId: string;
  studentName: string;
  programmeCode: string;
  moduleCode: string;
  reason: "missing_enrolled_class" | "missing_weekly_pattern";
  detail: string;
};

export type StudentWeeklyTimetableConflictResult = {
  conflicts: StudentWeeklyTimetableConflict[];
  warnings: StudentWeeklyTimetableWarning[];
  studentCount: number;
  moduleRowCount: number;
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function timeToMinutes(value: string) {
  const [hh, mm] = String(value ?? "")
    .slice(0, 5)
    .split(":")
    .map((part) => Number(part));
  return hh * 60 + mm;
}

function overlaps(a: { start: string; end: string }, b: { start: string; end: string }) {
  return timeToMinutes(a.start) < timeToMinutes(b.end) &&
    timeToMinutes(b.start) < timeToMinutes(a.end);
}

function overlapWindow(a: { start: string; end: string }, b: { start: string; end: string }) {
  const start = Math.max(timeToMinutes(a.start), timeToMinutes(b.start));
  const end = Math.min(timeToMinutes(a.end), timeToMinutes(b.end));
  const toTime = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return { start: toTime(start), end: toTime(end) };
}

function buildWeeklyPatternsByInstanceCode(
  sessions: Awaited<ReturnType<typeof listTimetableSessions>>,
  instanceCodesFilter?: Set<string>
) {
  const map = new Map<string, WeeklyPatternSlot[]>();
  const seen = new Set<string>();

  for (const session of sessions) {
    if (session.status === "cancel") continue;

    const instanceCode = normalizeText(session.module_instance_code).toUpperCase();
    if (!instanceCode) continue;
    if (instanceCodesFilter && !instanceCodesFilter.has(instanceCode)) continue;

    const dateIso = String(session.session_date ?? "").slice(0, 10);
    if (!dateIso) continue;

    const jsDay = new Date(`${dateIso}T00:00:00`).getDay();
    if (jsDay === 0) continue;

    const start = String(session.start_time ?? "").slice(0, 5);
    const end = String(session.end_time ?? "").slice(0, 5);
    if (!start || !end) continue;

    const dedupeKey = `${instanceCode}|${jsDay}|${start}|${end}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const roomCode = normalizeText(session.room_code);
    const list = map.get(instanceCode) ?? [];
    list.push({
      weekday: jsDay,
      start,
      end,
      roomCode,
    });
    map.set(instanceCode, list);
  }

  for (const [code, slots] of map) {
    slots.sort((a, b) => {
      if (a.weekday !== b.weekday) return a.weekday - b.weekday;
      if (a.start !== b.start) return a.start.localeCompare(b.start);
      return a.end.localeCompare(b.end);
    });
    map.set(code, slots);
  }

  return map;
}

function pushUnique(map: Map<string, string[]>, key: string, value: string) {
  const k = normalizeText(key).toUpperCase();
  const v = normalizeText(value).toUpperCase();
  if (!k || !v) return;
  const existing = map.get(k) ?? [];
  if (!existing.includes(v)) {
    existing.push(v);
    map.set(k, existing);
  }
}

export async function detectStudentWeeklyTimetableConflicts(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  programmeCode?: string;
}): Promise<StudentWeeklyTimetableConflictResult> {
  const canonicalYear = normalizeAcademicYear(params.academicYear);
  const programmeCode = normalizeText(params.programmeCode).toUpperCase();
  const offeredTerm = params.term as ModuleTerm;

  const students = await fetchAllPaginatedRows<{
    id: string;
    student_id: string;
    student_name: string;
    programme_code: string;
    programme_stream: string | null;
    study_mode: string | null;
  }>({
    fetchPage: ({ from, to }) =>
      supabaseQueryStudents(programmeCode, from, to),
  });

  const studentByProfileId = new Map(
    students.map((row) => [
      normalizeText(row.id),
      {
        studentId: normalizeText(row.student_id),
        studentName: normalizeText(row.student_name),
        programmeCode: normalizeText(row.programme_code).toUpperCase(),
        programmeStream: normalizeText(row.programme_stream),
        studyMode: normalizeText(row.study_mode),
      },
    ])
  );

  const profileIds = students.map((row) => normalizeText(row.id)).filter(Boolean);

  if (profileIds.length === 0) {
    return {
      conflicts: [],
      warnings: [],
      studentCount: 0,
      moduleRowCount: 0,
    };
  }

  const moduleRows = await loadPlannedModulesForTerm({
    profileIds,
    academicYear: canonicalYear,
    offeredTerm,
  });

  const [instances, sessions] = await Promise.all([
    listTimetableModuleInstances({ academicYear: canonicalYear }),
    listTimetableSessions({ academicYear: canonicalYear }),
  ]);

  const instancesForTerm = instances.filter(
    (row) => normalizeText(row.module_term) === params.term
  );

  // Map original (study-plan) module_code -> candidate instance codes.
  // - planning_module instances: module_code is already the original code.
  // - combine_group instances: module_code is combined_code, so we expand to all member original codes.
  const instanceCodesByBaseModuleCode = new Map<string, string[]>();
  const combineGroupIds = Array.from(
    new Set(
      instancesForTerm
        .map((row) => normalizeText((row as any).source_combine_group_id))
        .filter(Boolean)
    )
  );
  const combineMembersByGroupId = await loadCombineGroupMembersByGroupId({
    combineGroupIds,
  });

  for (const row of instancesForTerm) {
    const instanceCode = normalizeText(row.module_instance_code).toUpperCase();
    if (!instanceCode) continue;

    const combineGroupId = normalizeText((row as any).source_combine_group_id);
    if (combineGroupId) {
      const members = combineMembersByGroupId.get(combineGroupId) ?? [];
      for (const member of members) {
        pushUnique(instanceCodesByBaseModuleCode, member.module_code, instanceCode);
      }
      continue;
    }

    pushUnique(instanceCodesByBaseModuleCode, row.module_code, instanceCode);
  }

  const instanceCodesForTerm = new Set(
    instancesForTerm
      .map((row) => normalizeText(row.module_instance_code).toUpperCase())
      .filter(Boolean)
  );
  const moduleCodeByInstance = new Map(
    instancesForTerm.map((row) => [
      normalizeText(row.module_instance_code).toUpperCase(),
      normalizeText(row.module_code).toUpperCase(),
    ])
  );

  // Build once for all sessions (for inference when instance row is missing),
  // and also a term-filtered view for speed when instances exist.
  const weeklyPatternsByInstanceAll = buildWeeklyPatternsByInstanceCode(sessions);
  const weeklyPatternsByInstanceForTerm = buildWeeklyPatternsByInstanceCode(
    sessions,
    instanceCodesForTerm
  );

  const conflicts: StudentWeeklyTimetableConflict[] = [];
  const warnings: StudentWeeklyTimetableWarning[] = [];

  const modulesByProfileId = new Map<string, typeof moduleRows>();
  for (const row of moduleRows) {
    const key = normalizeText(row.student_profile_id);
    const list = modulesByProfileId.get(key) ?? [];
    list.push(row);
    modulesByProfileId.set(key, list);
  }

  for (const [profileId, student] of studentByProfileId) {
    const rows = modulesByProfileId.get(profileId) ?? [];
    const placedSlots: Array<
      WeeklyPatternSlot & {
        moduleCode: string;
        moduleInstanceCode: string;
      }
    > = [];

    for (const row of rows) {
      const moduleCode = normalizeText(row.module_code).toUpperCase();
      const enrolledCodeRaw = normalizeText(row.enrolled_module_instance_code).toUpperCase();
      const enrolledCode =
        enrolledCodeRaw ||
        (() => {
          const candidates = instanceCodesByBaseModuleCode.get(moduleCode) ?? [];
          if (candidates.length === 1) return candidates[0]!;
          // Some combined/legacy rows have sessions saved but no instance row.
          // If module_code itself is used as module_instance_code in sessions, infer it.
          if (candidates.length === 0 && weeklyPatternsByInstanceAll.has(moduleCode)) {
            return moduleCode;
          }
          return "";
        })();

      if (!enrolledCode) {
        const candidates = instanceCodesByBaseModuleCode.get(moduleCode) ?? [];
        warnings.push({
          studentId: student.studentId,
          studentName: student.studentName,
          programmeCode: student.programmeCode,
          moduleCode,
          reason: "missing_enrolled_class",
          detail:
            candidates.length === 0
              ? "No enrolled class (Enrolled Class empty) and no timetable instance found for this module/term."
              : `No enrolled class (Enrolled Class empty). This module has ${candidates.length} timetable instance(s) in ${params.term}, so it cannot be inferred.`,
        });
        continue;
      }

      const patterns =
        (instanceCodesForTerm.has(enrolledCode)
          ? weeklyPatternsByInstanceForTerm.get(enrolledCode)
          : weeklyPatternsByInstanceAll.get(enrolledCode)) ?? [];
      if (patterns.length === 0) {
        warnings.push({
          studentId: student.studentId,
          studentName: student.studentName,
          programmeCode: student.programmeCode,
          moduleCode,
          reason: "missing_weekly_pattern",
          detail: `${enrolledCode} has no saved weekly timetable for ${params.term}.`,
        });
        continue;
      }

      const resolvedModuleCode =
        moduleCodeByInstance.get(enrolledCode) || moduleCode;

      for (const pattern of patterns) {
        placedSlots.push({
          ...pattern,
          moduleCode: resolvedModuleCode,
          moduleInstanceCode: enrolledCode,
        });
      }
    }

    for (let index = 0; index < placedSlots.length; index += 1) {
      for (let other = index + 1; other < placedSlots.length; other += 1) {
        const left = placedSlots[index]!;
        const right = placedSlots[other]!;

        if (left.weekday !== right.weekday) continue;
        if (!overlaps(left, right)) continue;

        const overlap = overlapWindow(left, right);

        conflicts.push({
          studentId: student.studentId,
          studentName: student.studentName,
          programmeCode: student.programmeCode,
          programmeStream: student.programmeStream,
          studyMode: student.studyMode,
          weekday: left.weekday,
          weekdayLabel: schedulingWeekdayLabel(left.weekday),
          overlapStart: overlap.start,
          overlapEnd: overlap.end,
          moduleCodeA: left.moduleCode,
          moduleInstanceCodeA: left.moduleInstanceCode,
          moduleCodeB: right.moduleCode,
          moduleInstanceCodeB: right.moduleInstanceCode,
          timeWindowA: `${left.start}–${left.end}`,
          timeWindowB: `${right.start}–${right.end}`,
          roomCodeA: left.roomCode || "—",
          roomCodeB: right.roomCode || "—",
        });
      }
    }
  }

  conflicts.sort((a, b) => {
    if (a.studentId !== b.studentId) {
      return a.studentId.localeCompare(b.studentId);
    }
    if (a.weekday !== b.weekday) return a.weekday - b.weekday;
    return a.overlapStart.localeCompare(b.overlapStart);
  });

  warnings.sort((a, b) => {
    if (a.studentId !== b.studentId) {
      return a.studentId.localeCompare(b.studentId);
    }
    return a.moduleCode.localeCompare(b.moduleCode);
  });

  return {
    conflicts,
    warnings,
    studentCount: students.length,
    moduleRowCount: moduleRows.length,
  };
}

async function supabaseQueryStudents(
  programmeCode: string,
  from: number,
  to: number
) {
  let query = supabase
    .from("study_plan_students")
    .select("id, student_id, student_name, programme_code, programme_stream, study_mode");

  if (programmeCode) {
    query = query.eq("programme_code", programmeCode);
  }

  return query
    .order("student_id", { ascending: true })
    .range(from, to);
}

async function loadPlannedModulesForTerm(params: {
  profileIds: string[];
  academicYear: string;
  offeredTerm: ModuleTerm;
}) {
  const profileIdSet = new Set(params.profileIds);
  const rows = await fetchAllPaginatedRows<{
    student_profile_id: string;
    module_code: string;
    study_term: string | null;
    enrolled_module_instance_code: string | null;
    status: string;
  }>({
    fetchPage: ({ from, to }) =>
      supabaseQueryPlannedModules(from, to),
  });

  return rows.filter((row) => {
    if (row.status !== "planned") return false;
    if (!profileIdSet.has(normalizeText(row.student_profile_id))) return false;

    const studyTerm = normalizeText(row.study_term);
    if (!studyTerm) return false;

    if (normalizeAcademicYear(studyTermToAcademicYear(studyTerm)) !== params.academicYear) {
      return false;
    }

    return offeredTermFromStudyTerm(studyTerm) === params.offeredTerm;
  });
}

async function supabaseQueryPlannedModules(from: number, to: number) {
  return supabase
    .from("study_plan_modules")
    .select(
      "student_profile_id, module_code, study_term, enrolled_module_instance_code, status"
    )
    .eq("status", "planned")
    .not("study_term", "is", null)
    .order("id", { ascending: true })
    .range(from, to);
}

async function loadCombineGroupMembersByGroupId(params: {
  combineGroupIds: string[];
}): Promise<Map<string, Array<{ module_code: string; programme_code: string }>>> {
  const result = new Map<string, Array<{ module_code: string; programme_code: string }>>();

  const ids = params.combineGroupIds.map((id) => normalizeText(id)).filter(Boolean);
  if (ids.length === 0) return result;

  const { data: relations, error: relationError } = await supabase
    .from("combine_group_modules")
    .select("combine_group_id, planning_module_id")
    .in("combine_group_id", ids);

  if (relationError) throw relationError;

  const relationRows = (relations ?? []) as Array<{
    combine_group_id: string;
    planning_module_id: string;
  }>;

  const planningIds = Array.from(
    new Set(relationRows.map((row) => normalizeText(row.planning_module_id)).filter(Boolean))
  );

  if (planningIds.length === 0) return result;

  const { data: planningModules, error: planningError } = await supabase
    .from("timetable_planning_modules")
    .select("id, module_code, programme_code")
    .in("id", planningIds);

  if (planningError) throw planningError;

  const planningById = new Map(
    (planningModules ?? []).map((row) => [
      normalizeText((row as any).id),
      {
        module_code: normalizeText((row as any).module_code),
        programme_code: normalizeText((row as any).programme_code),
      },
    ])
  );

  for (const row of relationRows) {
    const groupId = normalizeText(row.combine_group_id);
    const planning = planningById.get(normalizeText(row.planning_module_id));
    if (!groupId || !planning?.module_code) continue;

    const bucket = result.get(groupId) ?? [];
    bucket.push(planning);
    result.set(groupId, bucket);
  }

  return result;
}
