import FileSaver from "file-saver";

const saveAs = FileSaver.saveAs;

import { joinUniqueModuleCodes } from "../lib/moduleDisplay";
import {
  MIXED_PROGRAMME_CODE,
  isMixedProgrammeCode,
} from "../lib/timetableProgramme";
import {
  compareStudyTerm,
  isDegreeProgrammeType,
  isHDProgrammeType,
  offeredTermFromStudyTerm,
  studyTermToAcademicYear,
} from "../pages/programme-leader/make-study-plan/helpers";
import { supabase } from "../lib/supabase";
import { fetchAllPaginatedRows } from "../lib/supabasePagination";
import {
  getAcademicYearVariants,
  normalizeAcademicYear,
} from "../lib/utils";
import type { ModuleTerm } from "../types/common";
import {
  listCrossProgrammeManualCombineGroups,
  type CrossProgrammeManualCombineGroupSummary,
} from "./manualCombineService";
import { listModuleInstancesForEnrollment } from "./studyPlanCoreEnrollmentService";
import { loadStudyPlanEnrollmentRows } from "./studyPlanEnrollmentService";

function normalizeStream(value?: string | null): string {
  const text = String(value ?? "").trim();
  return text || "nil";
}

export type StudentHeadcountGroupBy =
  | "programme_type"
  | "programme_code"
  | "programme_stream";

export interface StudentHeadcountReportParams {
  groupBy: StudentHeadcountGroupBy;
  includeIntakeTerm?: boolean;
}

export interface StudentHeadcountReportRow {
  programmeType: string;
  programmeCode: string;
  programmeStream: string;
  intakeTerm: string;
  studentCount: number;
}

export interface ModuleEnrollmentReportParams {
  includeBridging?: boolean;
  programmeCode?: string;
  studyTerm?: string;
}

export interface ModuleEnrollmentReportRow {
  programmeCode: string;
  programmeStream: string;
  moduleCode: string;
  moduleName: string;
  planStage: string;
  studyTerm: string;
  studentCount: number;
}

export interface ClassEnrollmentReportParams {
  academicYear: string;
  offeredTerm: ModuleTerm;
  programmeCode: string;
  includeBridging?: boolean;
}

export interface ClassEnrollmentReportRow {
  programmeCode: string;
  moduleCode: string;
  moduleName: string;
  planStage: string;
  enrolledClass: string;
  instanceMode: string | null;
  ftCount: number;
  ptCount: number;
  studentCount: number;
  isMixedCategory?: boolean;
  memberProgrammes?: string;
}

const UNASSIGNED_CLASS_KEY = "__UNASSIGNED__";

function normalizeReportText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

type MixedCombineInstanceMeta = {
  combinedCode: string;
  combineGroupId: string;
  moduleCodes: string[];
  memberProgrammeCodes: string[];
  instanceMode: string | null;
};

function escapeCsvCell(value: unknown): string {
  const text = String(value ?? "");

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function rowsToCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
}

function normalizeProgrammeCodeKey(programmeCode: string): string {
  return String(programmeCode ?? "").trim().toUpperCase();
}

function resolveProgrammeTypeFromMap(
  programmeCode: string,
  programmeTypeByCode: Map<string, string>
): string | undefined {
  const key = normalizeProgrammeCodeKey(programmeCode);

  if (!key) {
    return undefined;
  }

  return programmeTypeByCode.get(key);
}

async function loadProgrammeTypeByCode(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("programmes")
    .select("programme_code, programme_type");

  if (error) {
    console.error("[StudyPlanReport] Failed to load programme types:", error);
    throw error;
  }

  const map = new Map<string, string>();

  for (const row of data ?? []) {
    const programmeCode = normalizeProgrammeCodeKey(
      String(row.programme_code ?? "")
    );

    if (!programmeCode) {
      continue;
    }

    const nextType = String(row.programme_type ?? "").trim() || "Unknown";
    const existing = map.get(programmeCode);

    if (!existing || existing === "Unknown") {
      map.set(programmeCode, nextType);
    }
  }

  return map;
}

export async function getStudentHeadcountReport(
  params: StudentHeadcountReportParams
): Promise<StudentHeadcountReportRow[]> {
  const { data, error } = await supabase.from("study_plan_students").select("*");

  if (error) throw error;

  const programmeTypeByCode = await loadProgrammeTypeByCode();
  const includeIntakeTerm = params.includeIntakeTerm ?? false;
  const grouped = new Map<string, StudentHeadcountReportRow>();

  for (const row of data ?? []) {
    const programmeCode = String(row.programme_code ?? "").trim();
    const programmeStream = normalizeStream(row.programme_stream);
    const programmeType =
      resolveProgrammeTypeFromMap(programmeCode, programmeTypeByCode) ??
      "Unknown";
    const intakeTerm = String(row.intake_term ?? "").trim();

    const keyParts: string[] = [];

    if (params.groupBy === "programme_type") {
      keyParts.push(programmeType);
    } else if (params.groupBy === "programme_code") {
      keyParts.push(programmeCode);
    } else {
      keyParts.push(programmeCode, programmeStream);
    }

    if (includeIntakeTerm) {
      keyParts.push(intakeTerm);
    }

    const key = keyParts.join("|");
    const existing = grouped.get(key);

    if (existing) {
      existing.studentCount += 1;
      continue;
    }

    grouped.set(key, {
      programmeType,
      programmeCode:
        params.groupBy === "programme_type" ? "" : programmeCode,
      programmeStream:
        params.groupBy === "programme_stream" ? programmeStream : "",
      intakeTerm: includeIntakeTerm ? intakeTerm : "",
      studentCount: 1,
    });
  }

  const rows = Array.from(grouped.values());

  rows.sort((a, b) => {
    const typeDiff =
      programmeKindRank(a.programmeType) - programmeKindRank(b.programmeType);

    if (typeDiff !== 0) return typeDiff;

    const codeDiff = compareProgrammeCodeForReport(
      a.programmeCode,
      b.programmeCode,
      programmeTypeByCode
    );

    if (codeDiff !== 0) return codeDiff;

    const streamDiff = a.programmeStream.localeCompare(b.programmeStream);

    if (streamDiff !== 0) return streamDiff;

    return compareStudyTerm(a.intakeTerm, b.intakeTerm);
  });

  return rows;
}

export async function listModuleEnrollmentStudyTerms(): Promise<string[]> {
  const { data, error } = await supabase
    .from("study_plan_modules")
    .select("study_term")
    .eq("status", "planned")
    .not("study_term", "is", null);

  if (error) throw error;

  const terms = new Set<string>();

  for (const row of data ?? []) {
    const studyTerm = String(row.study_term ?? "").trim().toUpperCase();

    if (studyTerm) {
      terms.add(studyTerm);
    }
  }

  return Array.from(terms).sort((a, b) => compareStudyTerm(a, b));
}

function comparePlanStageForReport(a: string, b: string): number {
  if (a === b) return 0;

  if (a === "bridging") return -1;
  if (b === "bridging") return 1;

  return a.localeCompare(b);
}

function programmeKindRank(programmeType: string | undefined): number {
  if (isHDProgrammeType(programmeType)) {
    return 0;
  }

  if (isDegreeProgrammeType(programmeType)) {
    return 1;
  }

  return 2;
}

function compareProgrammeCodeForReport(
  aCode: string,
  bCode: string,
  programmeTypeByCode: Map<string, string>
): number {
  const kindDiff =
    programmeKindRank(resolveProgrammeTypeFromMap(aCode, programmeTypeByCode)) -
    programmeKindRank(resolveProgrammeTypeFromMap(bCode, programmeTypeByCode));

  if (kindDiff !== 0) {
    return kindDiff;
  }

  return normalizeProgrammeCodeKey(aCode).localeCompare(
    normalizeProgrammeCodeKey(bCode)
  );
}

function compareModuleEnrollmentRows(
  a: ModuleEnrollmentReportRow,
  b: ModuleEnrollmentReportRow,
  params: ModuleEnrollmentReportParams,
  programmeTypeByCode: Map<string, string>
): number {
  const hasProgramme = Boolean(String(params.programmeCode ?? "").trim());
  const hasTerm = Boolean(String(params.studyTerm ?? "").trim());

  const chain = (...parts: number[]) => {
    for (const part of parts) {
      if (part !== 0) {
        return part;
      }
    }

    return 0;
  };

  if (hasProgramme && hasTerm) {
    return chain(
      a.moduleCode.localeCompare(b.moduleCode),
      a.programmeStream.localeCompare(b.programmeStream),
      comparePlanStageForReport(a.planStage, b.planStage)
    );
  }

  if (hasProgramme && !hasTerm) {
    return chain(
      compareStudyTerm(a.studyTerm, b.studyTerm),
      a.moduleCode.localeCompare(b.moduleCode),
      a.programmeStream.localeCompare(b.programmeStream),
      comparePlanStageForReport(a.planStage, b.planStage)
    );
  }

  if (!hasProgramme && hasTerm) {
    return chain(
      a.moduleCode.localeCompare(b.moduleCode),
      a.programmeStream.localeCompare(b.programmeStream),
      compareProgrammeCodeForReport(
        a.programmeCode,
        b.programmeCode,
        programmeTypeByCode
      ),
      comparePlanStageForReport(a.planStage, b.planStage)
    );
  }

  return chain(
    compareStudyTerm(a.studyTerm, b.studyTerm),
    a.moduleCode.localeCompare(b.moduleCode),
    a.programmeStream.localeCompare(b.programmeStream),
    compareProgrammeCodeForReport(
      a.programmeCode,
      b.programmeCode,
      programmeTypeByCode
    ),
    comparePlanStageForReport(a.planStage, b.planStage)
  );
}

export async function getModuleEnrollmentReport(
  params: ModuleEnrollmentReportParams = {}
): Promise<ModuleEnrollmentReportRow[]> {
  const programmeCode = String(params.programmeCode ?? "").trim();
  const studyTerm = String(params.studyTerm ?? "").trim().toUpperCase();
  const includeBridging = params.includeBridging ?? false;

  const data = await fetchAllPaginatedRows<{
    module_code: string;
    module_name: string | null;
    programme_code: string;
    programme_stream: string | null;
    study_term: string;
    status: string;
    plan_stage: string;
  }>({
    fetchPage: ({ from, to }) => {
      let query = supabase
        .from("study_plan_modules")
        .select(
          "module_code, module_name, programme_code, programme_stream, study_term, status, plan_stage"
        )
        .eq("status", "planned")
        .not("study_term", "is", null)
        .order("id", { ascending: true });

      if (!includeBridging) {
        query = query.eq("plan_stage", "programme");
      }

      if (programmeCode) {
        query = query.eq("programme_code", programmeCode);
      }

      if (studyTerm) {
        query = query.eq("study_term", studyTerm);
      }

      return query.range(from, to);
    },
  });

  const grouped = new Map<string, ModuleEnrollmentReportRow>();

  for (const row of data) {
    const programmeCode = String(row.programme_code ?? "").trim();
    const programmeStream = normalizeStream(row.programme_stream);
    const moduleCode = String(row.module_code ?? "").trim();
    const moduleName = String(row.module_name ?? moduleCode).trim();
    const planStage = String(row.plan_stage ?? "programme").trim();
    const studyTerm = String(row.study_term ?? "").trim().toUpperCase();

    if (!programmeCode || !moduleCode || !studyTerm) {
      continue;
    }

    const key = [
      programmeCode,
      programmeStream,
      moduleCode,
      planStage,
      studyTerm,
    ].join("|");

    const existing = grouped.get(key);

    if (existing) {
      existing.studentCount += 1;
      continue;
    }

    grouped.set(key, {
      programmeCode,
      programmeStream,
      moduleCode,
      moduleName,
      planStage,
      studyTerm,
      studentCount: 1,
    });
  }

  const rows = Array.from(grouped.values());
  const programmeTypeByCode = await loadProgrammeTypeByCode();

  rows.sort((a, b) =>
    compareModuleEnrollmentRows(a, b, params, programmeTypeByCode)
  );

  return rows;
}

export async function downloadStudentHeadcountReportCsv(
  params: StudentHeadcountReportParams
): Promise<{ fileName: string; rowCount: number }> {
  const rows = await getStudentHeadcountReport(params);
  const includeIntakeTerm = params.includeIntakeTerm ?? false;

  const headers = ["Programme Type"];

  if (params.groupBy === "programme_code" || params.groupBy === "programme_stream") {
    headers.push("Programme Code");
  }

  if (params.groupBy === "programme_stream") {
    headers.push("Programme Stream");
  }

  if (includeIntakeTerm) {
    headers.push("Intake Term");
  }

  headers.push("Student Count");

  const csvRows = rows.map((row) => {
    const cells = [row.programmeType];

    if (params.groupBy === "programme_code" || params.groupBy === "programme_stream") {
      cells.push(row.programmeCode);
    }

    if (params.groupBy === "programme_stream") {
      cells.push(row.programmeStream);
    }

    if (includeIntakeTerm) {
      cells.push(row.intakeTerm);
    }

    cells.push(String(row.studentCount));

    return cells;
  });

  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const fileName = `study_plan_student_headcount_${params.groupBy}_${dateStamp}.csv`;

  saveAs(
    new Blob([rowsToCsv(headers, csvRows)], {
      type: "text/csv;charset=utf-8;",
    }),
    fileName
  );

  return {
    fileName,
    rowCount: rows.length,
  };
}

export async function downloadModuleEnrollmentReportCsv(
  params: ModuleEnrollmentReportParams = {}
): Promise<{ fileName: string; rowCount: number }> {
  const rows = await getModuleEnrollmentReport(params);

  const headers = [
    "Programme Code",
    "Programme Stream",
    "Plan Stage",
    "Module Code",
    "Module Name",
    "Study Term",
    "Student Count",
  ];

  const csvRows = rows.map((row) => [
    row.programmeCode,
    row.programmeStream,
    row.planStage,
    row.moduleCode,
    row.moduleName,
    row.studyTerm,
    String(row.studentCount),
  ]);

  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffixParts = [
    params.programmeCode || "all_programmes",
    params.studyTerm || "all_terms",
    params.includeBridging ? "with_bridging" : "programme_only",
  ];
  const suffix = suffixParts.join("_");

  const fileName = `study_plan_module_enrollment_${suffix}_${dateStamp}.csv`;

  saveAs(
    new Blob([rowsToCsv(headers, csvRows)], {
      type: "text/csv;charset=utf-8;",
    }),
    fileName
  );

  return {
    fileName,
    rowCount: rows.length,
  };
}

async function loadModuleNameByCodeForProgramme(
  programmeCode: string,
  academicYear: string,
  offeredTerm: ModuleTerm
): Promise<Map<string, string>> {
  const canonicalYear = normalizeAcademicYear(academicYear);
  const normalizedProgrammeCode = String(programmeCode ?? "").trim().toUpperCase();

  const data = await fetchAllPaginatedRows<{
    module_code: string;
    module_name: string | null;
    study_term: string | null;
  }>({
    fetchPage: ({ from, to }) =>
      supabase
        .from("study_plan_modules")
        .select("module_code, module_name, study_term")
        .eq("status", "planned")
        .eq("programme_code", normalizedProgrammeCode)
        .not("study_term", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
  });

  const moduleNameByCode = new Map<string, string>();

  for (const row of data) {
    const studyTerm = String(row.study_term ?? "").trim().toUpperCase();

    if (!studyTerm) {
      continue;
    }

    if (normalizeAcademicYear(studyTermToAcademicYear(studyTerm)) !== canonicalYear) {
      continue;
    }

    if (offeredTermFromStudyTerm(studyTerm) !== offeredTerm) {
      continue;
    }

    const moduleCode = String(row.module_code ?? "").trim().toUpperCase();

    if (!moduleCode || moduleNameByCode.has(moduleCode)) {
      continue;
    }

    const moduleName = String(row.module_name ?? moduleCode).trim() || moduleCode;
    moduleNameByCode.set(moduleCode, moduleName);
  }

  return moduleNameByCode;
}

function compareClassEnrollmentRows(
  a: ClassEnrollmentReportRow,
  b: ClassEnrollmentReportRow
): number {
  const chain = (...parts: number[]) => {
    for (const part of parts) {
      if (part !== 0) {
        return part;
      }
    }

    return 0;
  };

  const classRank = (value: string) => (value ? 1 : 0);

  return chain(
    a.moduleCode.localeCompare(b.moduleCode),
    comparePlanStageForReport(a.planStage, b.planStage),
    classRank(a.enrolledClass) - classRank(b.enrolledClass),
    a.enrolledClass.localeCompare(b.enrolledClass)
  );
}

function compareMixedClassEnrollmentRows(
  a: ClassEnrollmentReportRow,
  b: ClassEnrollmentReportRow
): number {
  const chain = (...parts: number[]) => {
    for (const part of parts) {
      if (part !== 0) {
        return part;
      }
    }

    return 0;
  };

  const classRank = (value: string) => (value ? 1 : 0);

  return chain(
    a.moduleCode.localeCompare(b.moduleCode),
    classRank(a.enrolledClass) - classRank(b.enrolledClass),
    a.enrolledClass.localeCompare(b.enrolledClass)
  );
}

async function loadMixedCombineInstanceContext(params: {
  academicYear: string;
  offeredTerm: ModuleTerm;
}) {
  const canonicalYear = normalizeAcademicYear(params.academicYear);
  const yearVariants = getAcademicYearVariants(canonicalYear);

  const groups = await listCrossProgrammeManualCombineGroups({
    academicYear: canonicalYear,
    moduleTerm: params.offeredTerm,
  });

  const groupById = new Map(groups.map((group) => [group.id, group]));
  const groupIds = groups.map((group) => group.id);

  const instanceByCode = new Map<string, MixedCombineInstanceMeta>();
  const groupsByMemberModuleCode = new Map<
    string,
    CrossProgrammeManualCombineGroupSummary[]
  >();

  for (const group of groups) {
    for (const code of group.module_codes) {
      const key = normalizeReportText(code).toUpperCase();
      if (!key) continue;

      const bucket = groupsByMemberModuleCode.get(key) ?? [];
      bucket.push(group);
      groupsByMemberModuleCode.set(key, bucket);
    }
  }

  if (groupIds.length === 0) {
    return { groups, instanceByCode, groupsByMemberModuleCode };
  }

  const registerInstance = (
    instanceCode: string,
    groupId: string,
    instanceMode: string | null
  ) => {
    const group = groupById.get(groupId);
    const normalizedInstanceCode = normalizeReportText(instanceCode);

    if (!group || !normalizedInstanceCode) {
      return;
    }

    instanceByCode.set(normalizedInstanceCode, {
      combinedCode: group.combined_code,
      combineGroupId: group.id,
      moduleCodes: group.module_codes,
      memberProgrammeCodes: group.member_programme_codes,
      instanceMode,
    });
  };

  const [instanceRows, timetableModuleRows] = await Promise.all([
    fetchAllPaginatedRows<{
      module_instance_code: string;
      source_combine_group_id: string | null;
      instance_mode: string | null;
    }>({
      fetchPage: ({ from, to }) =>
        supabase
          .from("timetable_module_instances")
          .select(
            "module_instance_code, source_combine_group_id, instance_mode"
          )
          .in("academic_year", yearVariants)
          .eq("module_term", params.offeredTerm)
          .in("source_combine_group_id", groupIds)
          .order("module_instance_code", { ascending: true })
          .range(from, to),
    }),
    fetchAllPaginatedRows<{
      module_instance_code: string;
      combine_group_id: string | null;
      mode: string | null;
    }>({
      fetchPage: ({ from, to }) =>
        supabase
          .from("timetable_modules")
          .select("module_instance_code, combine_group_id, mode")
          .in("academic_year", yearVariants)
          .eq("module_term", params.offeredTerm)
          .in("combine_group_id", groupIds)
          .order("module_instance_code", { ascending: true })
          .range(from, to),
    }),
  ]);

  for (const row of instanceRows) {
    registerInstance(
      row.module_instance_code,
      normalizeReportText(row.source_combine_group_id),
      normalizeReportText(row.instance_mode) || null
    );
  }

  for (const row of timetableModuleRows) {
    const instanceCode = normalizeReportText(row.module_instance_code);
    if (!instanceCode || instanceByCode.has(instanceCode)) {
      continue;
    }

    registerInstance(
      instanceCode,
      normalizeReportText(row.combine_group_id),
      normalizeReportText(row.mode) || null
    );
  }

  return { groups, instanceByCode, groupsByMemberModuleCode };
}

function resolveMixedCombineGroupForEnrollmentRow(params: {
  row: {
    module_code: string;
    programme_code: string;
    enrolled_module_instance_code: string | null;
  };
  instanceByCode: Map<string, MixedCombineInstanceMeta>;
  groupsByMemberModuleCode: Map<string, CrossProgrammeManualCombineGroupSummary[]>;
}): MixedCombineInstanceMeta | null {
  const enrolledClass = normalizeReportText(params.row.enrolled_module_instance_code);
  const enrolledMeta = enrolledClass
    ? params.instanceByCode.get(enrolledClass)
    : undefined;

  if (enrolledClass) {
    return enrolledMeta ?? null;
  }

  const moduleCode = normalizeReportText(params.row.module_code).toUpperCase();
  const programmeCode = normalizeReportText(params.row.programme_code).toUpperCase();

  if (!moduleCode || !programmeCode) {
    return null;
  }

  const candidateGroups = params.groupsByMemberModuleCode.get(moduleCode) ?? [];

  const matchedGroup = candidateGroups.find(
    (group) =>
      group.module_codes.some(
        (code) => normalizeReportText(code).toUpperCase() === moduleCode
      ) &&
      group.member_programme_codes.some(
        (code) => normalizeReportText(code).toUpperCase() === programmeCode
      )
  );

  if (!matchedGroup) {
    return null;
  }

  return {
    combinedCode: matchedGroup.combined_code,
    combineGroupId: matchedGroup.id,
    moduleCodes: matchedGroup.module_codes,
    memberProgrammeCodes: matchedGroup.member_programme_codes,
    instanceMode: null,
  };
}

function buildMixedClassEnrollmentRow(params: {
  meta: MixedCombineInstanceMeta;
  enrolledClass: string;
  ftCount: number;
  ptCount: number;
}): ClassEnrollmentReportRow {
  return {
    programmeCode: MIXED_PROGRAMME_CODE,
    moduleCode: params.meta.combinedCode,
    moduleName: joinUniqueModuleCodes(params.meta.moduleCodes),
    planStage: "programme",
    enrolledClass: params.enrolledClass,
    instanceMode: params.enrolledClass ? params.meta.instanceMode : null,
    ftCount: params.ftCount,
    ptCount: params.ptCount,
    studentCount: params.ftCount + params.ptCount,
    isMixedCategory: true,
    memberProgrammes: params.meta.memberProgrammeCodes.join(", "),
  };
}

async function getMixedClassEnrollmentReport(
  params: ClassEnrollmentReportParams
): Promise<ClassEnrollmentReportRow[]> {
  const includeBridging = params.includeBridging ?? false;

  const [{ groups, instanceByCode, groupsByMemberModuleCode }, enrollmentRows] =
    await Promise.all([
      loadMixedCombineInstanceContext({
        academicYear: params.academicYear,
        offeredTerm: params.offeredTerm,
      }),
      loadStudyPlanEnrollmentRows({
        academicYear: params.academicYear,
        offeredTerm: params.offeredTerm,
      }),
    ]);

  const grouped = new Map<string, ClassEnrollmentReportRow>();

  for (const row of enrollmentRows) {
    if (!includeBridging && row.plan_stage === "bridging") {
      continue;
    }

    const meta = resolveMixedCombineGroupForEnrollmentRow({
      row,
      instanceByCode,
      groupsByMemberModuleCode,
    });

    if (!meta) {
      continue;
    }

    const enrolledClass = normalizeReportText(row.enrolled_module_instance_code);
    const classKey = enrolledClass || UNASSIGNED_CLASS_KEY;
    const key = [meta.combineGroupId, classKey].join("|");
    const existing = grouped.get(key);

    if (existing) {
      if (row.study_mode === "PT") {
        existing.ptCount += 1;
      } else {
        existing.ftCount += 1;
      }

      existing.studentCount += 1;
      continue;
    }

    grouped.set(
      key,
      buildMixedClassEnrollmentRow({
        meta,
        enrolledClass,
        ftCount: row.study_mode === "PT" ? 0 : 1,
        ptCount: row.study_mode === "PT" ? 1 : 0,
      })
    );
  }

  for (const [instanceCode, meta] of instanceByCode.entries()) {
    const hasRow = Array.from(grouped.values()).some(
      (row) =>
        row.moduleCode === meta.combinedCode && row.enrolledClass === instanceCode
    );

    if (hasRow) {
      continue;
    }

    const key = [meta.combineGroupId, instanceCode].join("|");

    grouped.set(
      key,
      buildMixedClassEnrollmentRow({
        meta,
        enrolledClass: instanceCode,
        ftCount: 0,
        ptCount: 0,
      })
    );
  }

  const rows = Array.from(grouped.values());
  rows.sort(compareMixedClassEnrollmentRows);

  return rows;
}

export async function getClassEnrollmentReport(
  params: ClassEnrollmentReportParams
): Promise<ClassEnrollmentReportRow[]> {
  const programmeCode = String(params.programmeCode ?? "").trim().toUpperCase();

  if (!programmeCode) {
    return [];
  }

  if (isMixedProgrammeCode(programmeCode)) {
    return getMixedClassEnrollmentReport(params);
  }

  const includeBridging = params.includeBridging ?? false;

  const [enrollmentRows, moduleNameByCode] = await Promise.all([
    loadStudyPlanEnrollmentRows({
      academicYear: params.academicYear,
      offeredTerm: params.offeredTerm,
    }),
    loadModuleNameByCodeForProgramme(
      programmeCode,
      params.academicYear,
      params.offeredTerm
    ),
  ]);

  const filtered = enrollmentRows.filter((row) => {
    if (row.programme_code.toUpperCase() !== programmeCode) {
      return false;
    }

    if (!includeBridging && row.plan_stage === "bridging") {
      return false;
    }

    return true;
  });

  const grouped = new Map<string, ClassEnrollmentReportRow>();

  for (const row of filtered) {
    const moduleCode = row.module_code.toUpperCase();
    const planStage = String(row.plan_stage ?? "programme").trim();
    const enrolledClass = String(row.enrolled_module_instance_code ?? "").trim();
    const classKey = enrolledClass || UNASSIGNED_CLASS_KEY;
    const key = [moduleCode, planStage, classKey].join("|");

    const existing = grouped.get(key);

    if (existing) {
      if (row.study_mode === "PT") {
        existing.ptCount += 1;
      } else {
        existing.ftCount += 1;
      }

      existing.studentCount += 1;
      continue;
    }

    grouped.set(key, {
      programmeCode,
      moduleCode,
      moduleName: moduleNameByCode.get(moduleCode) ?? moduleCode,
      planStage,
      enrolledClass,
      instanceMode: null,
      ftCount: row.study_mode === "PT" ? 0 : 1,
      ptCount: row.study_mode === "PT" ? 1 : 0,
      studentCount: 1,
    });
  }

  const moduleCodes = Array.from(
    new Set([
      ...Array.from(grouped.values()).map((row) => row.moduleCode),
      ...Array.from(moduleNameByCode.keys()),
    ])
  ).sort();

  const instancesByModule = await listModuleInstancesForEnrollment({
    academicYear: params.academicYear,
    offeredTerm: params.offeredTerm,
    moduleCodes,
  });

  const instanceModeByCode = new Map<string, string | null>();

  for (const instances of Object.values(instancesByModule)) {
    for (const instance of instances) {
      instanceModeByCode.set(instance.moduleInstanceCode, instance.instanceMode);
    }
  }

  for (const row of grouped.values()) {
    if (!row.enrolledClass) {
      continue;
    }

    row.instanceMode = instanceModeByCode.get(row.enrolledClass) ?? null;
  }

  for (const moduleCode of moduleCodes) {
    const instances = instancesByModule[moduleCode] ?? [];

    for (const instance of instances) {
      const hasRow = Array.from(grouped.values()).some(
        (row) =>
          row.moduleCode === moduleCode &&
          row.enrolledClass === instance.moduleInstanceCode
      );

      if (hasRow) {
        continue;
      }

      const key = [moduleCode, "programme", instance.moduleInstanceCode].join("|");

      grouped.set(key, {
        programmeCode,
        moduleCode,
        moduleName: moduleNameByCode.get(moduleCode) ?? moduleCode,
        planStage: "programme",
        enrolledClass: instance.moduleInstanceCode,
        instanceMode: instance.instanceMode,
        ftCount: 0,
        ptCount: 0,
        studentCount: 0,
      });
    }
  }

  const rows = Array.from(grouped.values());
  rows.sort(compareClassEnrollmentRows);

  return rows;
}

export async function downloadClassEnrollmentReportCsv(
  params: ClassEnrollmentReportParams & { unassignedLabel?: string }
): Promise<{ fileName: string; rowCount: number }> {
  const rows = await getClassEnrollmentReport(params);
  const unassignedLabel = params.unassignedLabel ?? "Not enrolled";
  const isMixed = isMixedProgrammeCode(params.programmeCode);

  const headers = isMixed
    ? [
        "Category",
        "Member Programmes",
        "Combined Code",
        "Member Modules",
        "Enrolled Class",
        "Instance Mode",
        "FT Count",
        "PT Count",
        "Total Count",
      ]
    : [
        "Programme Code",
        "Plan Stage",
        "Module Code",
        "Module Name",
        "Enrolled Class",
        "Instance Mode",
        "FT Count",
        "PT Count",
        "Total Count",
      ];

  const csvRows = rows.map((row) =>
    isMixed
      ? [
          row.programmeCode,
          row.memberProgrammes ?? "",
          row.moduleCode,
          row.moduleName,
          row.enrolledClass || unassignedLabel,
          row.instanceMode ?? "",
          String(row.ftCount),
          String(row.ptCount),
          String(row.studentCount),
        ]
      : [
          row.programmeCode,
          row.planStage,
          row.moduleCode,
          row.moduleName,
          row.enrolledClass || unassignedLabel,
          row.instanceMode ?? "",
          String(row.ftCount),
          String(row.ptCount),
          String(row.studentCount),
        ]
  );

  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffixParts = [
    params.programmeCode,
    params.academicYear,
    params.offeredTerm,
    params.includeBridging ? "with_bridging" : "programme_only",
  ];
  const suffix = suffixParts.join("_");
  const fileName = `study_plan_class_enrollment_${suffix}_${dateStamp}.csv`;

  saveAs(
    new Blob([rowsToCsv(headers, csvRows)], {
      type: "text/csv;charset=utf-8;",
    }),
    fileName
  );

  return {
    fileName,
    rowCount: rows.length,
  };
}
