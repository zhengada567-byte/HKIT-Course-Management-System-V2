import { saveAs } from "file-saver";

import { supabase } from "../lib/supabase";
import {
  offeredTermToStudyTerm,
  normalizeAcademicYear,
  sanitizeAcademicYearForFilename,
} from "../lib/utils";
import {
  compareStudyTerm,
  getPreDegreeFebIntakeGraduateTerm,
  getPreDegreeSepIntakeGraduateTerms,
  isDegreeProgrammeType,
  isHDProgrammeType,
  normalizeStream,
} from "../pages/programme-leader/make-study-plan/helpers";
import { fetchAllPaginatedRows } from "../lib/supabasePagination";
import {
  getProgrammeTypeByCode,
  parseArticulatedDegreeCodes,
} from "./studyPlanService";

export type NewIntakeOfferedTerm = "Sep" | "Feb" | "Jun";

export interface NewIntakeTermBreakdown {
  offeredTerm: NewIntakeOfferedTerm;
  studyTerm: string;
  totalFt: number;
  totalPt: number;
  /**
   * Degree only:
   * articulated HD source (e.g. HDC stream) vs degree bridging source (e.g. UWLCS bridging complete).
   */
  fromHdFt: number;
  fromHdPt: number;
  fromDegreeBridgingFt: number;
  fromDegreeBridgingPt: number;
}

export interface NewIntakeSourceTotals {
  ft: number;
  pt: number;
  total: number;
}

export interface NewIntakeReport {
  academicYear: string;
  programmeCode: string;
  programmeType: string;
  totals: {
    ft: number;
    pt: number;
    total: number;
  };
  /** Degree only: distinct students across Sep + Feb intake (Jun excluded). */
  fromHd?: NewIntakeSourceTotals;
  fromDegreeBridging?: NewIntakeSourceTotals;
  terms: NewIntakeTermBreakdown[];
}

export type NewIntakeSourceCategory =
  | "articulated_hd"
  | "degree_bridging"
  | "hd_direct";

export interface NewIntakeStudentRow {
  academicYear: string;
  targetProgrammeCode: string;
  intakeOfferedTerm: NewIntakeOfferedTerm;
  intakeStudyTerm: string;
  sourceCategory: NewIntakeSourceCategory;
  sourceProgrammeCode: string;
  sourceProgrammeStream: string;
  studentId: string;
  studentName: string;
  studyMode: string;
  calculatedTerm: string;
  profileId: string;
}

function normalizeKey(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function studentIdentityKey(row: {
  profileId: string;
  studentId?: string | null;
}): string {
  const studentId = normalizeKey(row.studentId);
  if (studentId) return `SID:${studentId}`;
  return `PID:${normalizeKey(row.profileId)}`;
}

function normalizeStudyMode(value: string | null | undefined) {
  const mode = String(value ?? "").trim().toUpperCase();
  return mode === "PT" ? "PT" : "FT";
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function initTermSets() {
  return {
    ft: new Set<string>(),
    pt: new Set<string>(),
  };
}

function addToModeSet(
  sets: { ft: Set<string>; pt: Set<string> },
  studyMode: string | null | undefined,
  identityKey: string
) {
  if (normalizeStudyMode(studyMode) === "PT") {
    sets.pt.add(identityKey);
  } else {
    sets.ft.add(identityKey);
  }
}

function sourceCategoryLabel(category: NewIntakeSourceCategory): string {
  if (category === "articulated_hd") return "Articulated HD";
  if (category === "degree_bridging") return "Degree Bridging";
  return "HD New Intake";
}

function appendNewIntakeStudentRow(
  rows: NewIntakeStudentRow[],
  seenRowKeys: Set<string>,
  row: NewIntakeStudentRow
) {
  const dedupeKey = [
    row.intakeOfferedTerm,
    row.sourceCategory,
    row.sourceProgrammeCode,
    normalizeStream(row.sourceProgrammeStream),
    studentIdentityKey({ profileId: row.profileId, studentId: row.studentId }),
  ].join("|");

  if (seenRowKeys.has(dedupeKey)) {
    return;
  }

  seenRowKeys.add(dedupeKey);
  rows.push(row);
}

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

async function loadProgrammeArticulationSourcesForDegree(degreeProgrammeCode: string) {
  const target = normalizeKey(degreeProgrammeCode);
  if (!target) return [];

  const { data, error } = await supabase
    .from("programmes")
    .select("programme_type,programme_code,programme_stream,articulation")
    .not("articulation", "is", null);

  if (error) throw error;

  return (data ?? [])
    .map((row: any) => ({
      programmeType: String(row.programme_type ?? "").trim(),
      programmeCode: String(row.programme_code ?? "").trim(),
      programmeStream: String(row.programme_stream ?? "").trim(),
      articulation: String(row.articulation ?? "").trim(),
    }))
    .filter((row) => row.programmeCode)
    .filter((row) => isHDProgrammeType(row.programmeType))
    .filter((row) => {
      const codes = parseArticulatedDegreeCodes(row.articulation);
      return codes.includes(target);
    });
}

function resolveEarliestProgrammeTerm(moduleRows: any[]): string | undefined {
  let earliest: string | undefined;
  for (const m of moduleRows) {
    const planStage = String(m?.plan_stage ?? "").trim();
    const status = String(m?.status ?? "").trim();
    if (planStage !== "programme" || status !== "planned") continue;
    const term = normalizeKey(m?.study_term);
    if (!term) continue;
    if (!earliest || compareStudyTerm(term, earliest) < 0) {
      earliest = term;
    }
  }
  return earliest;
}

function resolveLatestProgrammeTerm(moduleRows: any[]): string | undefined {
  let latest: string | undefined;
  for (const m of moduleRows) {
    const planStage = String(m?.plan_stage ?? "").trim();
    const status = String(m?.status ?? "").trim();
    if (planStage !== "programme" || status !== "planned") continue;
    const term = normalizeKey(m?.study_term);
    if (!term) continue;
    if (!latest || compareStudyTerm(term, latest) > 0) {
      latest = term;
    }
  }
  return latest;
}

function resolveLatestBridgingTerm(moduleRows: any[]): string | undefined {
  let latest: string | undefined;
  for (const m of moduleRows) {
    const planStage = String(m?.plan_stage ?? "").trim();
    const status = String(m?.status ?? "").trim();
    if (planStage !== "bridging" || status !== "planned") continue;
    const term = normalizeKey(m?.study_term);
    if (!term) continue;
    if (!latest || compareStudyTerm(term, latest) > 0) {
      latest = term;
    }
  }
  return latest;
}

async function computeNewIntake(params: {
  academicYear: string;
  programmeCode: string;
}): Promise<{ report: NewIntakeReport; students: NewIntakeStudentRow[] }> {
  const studentRows: NewIntakeStudentRow[] = [];
  const seenRowKeys = new Set<string>();
  const academicYear = normalizeAcademicYear(params.academicYear);
  const programmeCode = String(params.programmeCode ?? "").trim();

  if (!academicYear || !programmeCode) {
    throw new Error("必須選擇 Academic Year 及 Programme。");
  }

  const programmeType = (await getProgrammeTypeByCode(programmeCode)) ?? "Unknown";

  const sepTerm = offeredTermToStudyTerm(academicYear, "Sep").toUpperCase();
  const febTerm = offeredTermToStudyTerm(academicYear, "Feb").toUpperCase();
  const junTerm = offeredTermToStudyTerm(academicYear, "Jun").toUpperCase();
  const sepGraduateTerms = getPreDegreeSepIntakeGraduateTerms(sepTerm);
  const febGraduateTerm = getPreDegreeFebIntakeGraduateTerm(febTerm);

  const termsTemplate: NewIntakeTermBreakdown[] = [
    {
      offeredTerm: "Sep",
      studyTerm: sepTerm,
      totalFt: 0,
      totalPt: 0,
      fromHdFt: 0,
      fromHdPt: 0,
      fromDegreeBridgingFt: 0,
      fromDegreeBridgingPt: 0,
    },
    {
      offeredTerm: "Feb",
      studyTerm: febTerm,
      totalFt: 0,
      totalPt: 0,
      fromHdFt: 0,
      fromHdPt: 0,
      fromDegreeBridgingFt: 0,
      fromDegreeBridgingPt: 0,
    },
    {
      offeredTerm: "Jun",
      studyTerm: junTerm,
      totalFt: 0,
      totalPt: 0,
      fromHdFt: 0,
      fromHdPt: 0,
      fromDegreeBridgingFt: 0,
      fromDegreeBridgingPt: 0,
    },
  ];

  if (isHDProgrammeType(programmeType)) {
    // HD: new intake = first programme term in {Sep, Feb, Jun} for the given academic year.
    const byTerm = new Map<NewIntakeOfferedTerm, { ft: Set<string>; pt: Set<string> }>([
      ["Sep", initTermSets()],
      ["Feb", initTermSets()],
      ["Jun", initTermSets()],
    ]);

    const { data: students, error: studentError } = await supabase
      .from("study_plan_students")
      .select("id,student_id,study_mode")
      .eq("programme_code", programmeCode);

    if (studentError) throw studentError;

    const studentsById = new Map<
      string,
      { studentId: string | null; studyMode: string | null }
    >();
    const profileIds: string[] = [];

    for (const s of students ?? []) {
      const profileId = String((s as any)?.id ?? "").trim();
      if (!profileId) continue;
      profileIds.push(profileId);
      studentsById.set(profileId, {
        studentId: (s as any)?.student_id ?? null,
        studyMode: (s as any)?.study_mode ?? null,
      });
    }

    for (const chunk of chunkValues(profileIds, 100)) {
      const { data: moduleRows, error: moduleError } = await supabase
        .from("study_plan_modules")
        .select("student_profile_id,plan_stage,status,study_term")
        .in("student_profile_id", chunk);

      if (moduleError) throw moduleError;

      const modulesByProfileId = new Map<string, any[]>();
      for (const m of moduleRows ?? []) {
        const pid = String((m as any)?.student_profile_id ?? "").trim();
        if (!pid) continue;
        const arr = modulesByProfileId.get(pid) ?? [];
        arr.push(m);
        modulesByProfileId.set(pid, arr);
      }

      for (const profileId of chunk) {
        const student = studentsById.get(profileId);
        if (!student) continue;

        const firstTerm = resolveEarliestProgrammeTerm(
          modulesByProfileId.get(profileId) ?? []
        );

        const identity = studentIdentityKey({
          profileId,
          studentId: student.studentId,
        });

        if (firstTerm === sepTerm) {
          addToModeSet(byTerm.get("Sep")!, student.studyMode, identity);
        } else if (firstTerm === febTerm) {
          addToModeSet(byTerm.get("Feb")!, student.studyMode, identity);
        } else if (firstTerm === junTerm) {
          addToModeSet(byTerm.get("Jun")!, student.studyMode, identity);
        }
      }
    }

    const termRows = termsTemplate.map((row) => {
      const sets = byTerm.get(row.offeredTerm)!;
      return {
        ...row,
        totalFt: sets.ft.size,
        totalPt: sets.pt.size,
      };
    });

    const ft = termRows.reduce((sum, r) => sum + r.totalFt, 0);
    const pt = termRows.reduce((sum, r) => sum + r.totalPt, 0);

    return {
      report: {
        academicYear,
        programmeCode,
        programmeType,
        totals: { ft, pt, total: ft + pt },
        terms: termRows,
      },
      students: studentRows,
    };
  }

  // Degree (and any non-HD): new intake = Sep intake + Feb intake.
  // Each intake term breaks down into:
  // - articulated HD sources (e.g. HDC stream)
  // - degree bridging complete sources (students under this degree programme)
  const sepHd = initTermSets();
  const febHd = initTermSets();
  const sepBridging = initTermSets();
  const febBridging = initTermSets();
  const sepUnion = initTermSets();
  const febUnion = initTermSets();
  const yearHd = initTermSets();
  const yearBridging = initTermSets();

  // 1) Articulated HD sources.
  const sources = await loadProgrammeArticulationSourcesForDegree(programmeCode);
  for (const source of sources) {
    const sourceStream = normalizeStream(source.programmeStream);

    const students = await fetchAllPaginatedRows<{
      id: string;
      student_id: string | null;
      student_name: string | null;
      study_mode: string | null;
      programme_stream: string | null;
    }>({
      fetchPage: ({ from, to }) =>
        supabase
          .from("study_plan_students")
          .select("id,student_id,student_name,study_mode,programme_stream")
          .eq("programme_code", source.programmeCode)
          .order("id", { ascending: true })
          .range(from, to),
    });

    const filteredStudents = students.filter(
      (row) => normalizeStream(row.programme_stream) === sourceStream
    );

    const studentsById = new Map<
      string,
      {
        studentId: string | null;
        studentName: string | null;
        studyMode: string | null;
      }
    >();
    const profileIds: string[] = [];

    for (const s of filteredStudents) {
      const profileId = String(s?.id ?? "").trim();
      if (!profileId) continue;
      profileIds.push(profileId);
      studentsById.set(profileId, {
        studentId: s?.student_id ?? null,
        studentName: s?.student_name ?? null,
        studyMode: s?.study_mode ?? null,
      });
    }

    for (const chunk of chunkValues(profileIds, 100)) {
      const moduleRows = await fetchAllPaginatedRows<{
        student_profile_id: string;
        plan_stage: string | null;
        status: string | null;
        study_term: string | null;
      }>({
        fetchPage: ({ from, to }) =>
          supabase
            .from("study_plan_modules")
            .select("student_profile_id,plan_stage,status,study_term")
            .in("student_profile_id", chunk)
            .order("id", { ascending: true })
            .range(from, to),
      });

      const modulesByProfileId = new Map<string, any[]>();
      for (const m of moduleRows) {
        const pid = String(m?.student_profile_id ?? "").trim();
        if (!pid) continue;
        const arr = modulesByProfileId.get(pid) ?? [];
        arr.push(m);
        modulesByProfileId.set(pid, arr);
      }

      for (const profileId of chunk) {
        const student = studentsById.get(profileId);
        if (!student) continue;

        const latestProgramme = resolveLatestProgrammeTerm(
          modulesByProfileId.get(profileId) ?? []
        );
        if (!latestProgramme) continue;

        const identity = studentIdentityKey({
          profileId,
          studentId: student.studentId,
        });

        const baseRow = {
          academicYear,
          targetProgrammeCode: programmeCode,
          sourceCategory: "articulated_hd" as const,
          sourceProgrammeCode: source.programmeCode,
          sourceProgrammeStream: sourceStream,
          studentId: String(student.studentId ?? "").trim(),
          studentName: String(student.studentName ?? "").trim(),
          studyMode: normalizeStudyMode(student.studyMode),
          calculatedTerm: latestProgramme,
          profileId,
        };

        // Sep intake: latest programme term is Feb/Jun immediately before Sep anchor.
        if (sepGraduateTerms.includes(latestProgramme)) {
          addToModeSet(sepHd, student.studyMode, identity);
          addToModeSet(sepUnion, student.studyMode, identity);
          addToModeSet(yearHd, student.studyMode, identity);
          appendNewIntakeStudentRow(studentRows, seenRowKeys, {
            ...baseRow,
            intakeOfferedTerm: "Sep",
            intakeStudyTerm: sepTerm,
          });
        }

        // Feb intake: latest programme term is Sep immediately before Feb anchor.
        if (febGraduateTerm && latestProgramme === febGraduateTerm) {
          addToModeSet(febHd, student.studyMode, identity);
          addToModeSet(febUnion, student.studyMode, identity);
          addToModeSet(yearHd, student.studyMode, identity);
          appendNewIntakeStudentRow(studentRows, seenRowKeys, {
            ...baseRow,
            intakeOfferedTerm: "Feb",
            intakeStudyTerm: febTerm,
          });
        }
      }
    }
  }

  // 2) Degree bridging complete sources: students under this degree programme code.
  const degreeStudents = await fetchAllPaginatedRows<{
    id: string;
    student_id: string | null;
    student_name: string | null;
    study_mode: string | null;
  }>({
    fetchPage: ({ from, to }) =>
      supabase
        .from("study_plan_students")
        .select("id,student_id,student_name,study_mode")
        .eq("programme_code", programmeCode)
        .order("id", { ascending: true })
        .range(from, to),
  });

  const degreeStudentsById = new Map<
    string,
    {
      studentId: string | null;
      studentName: string | null;
      studyMode: string | null;
    }
  >();
  const degreeProfileIds: string[] = [];

  for (const s of degreeStudents) {
    const profileId = String(s?.id ?? "").trim();
    if (!profileId) continue;
    degreeProfileIds.push(profileId);
    degreeStudentsById.set(profileId, {
      studentId: s?.student_id ?? null,
      studentName: s?.student_name ?? null,
      studyMode: s?.study_mode ?? null,
    });
  }

  for (const chunk of chunkValues(degreeProfileIds, 100)) {
    const moduleRows = await fetchAllPaginatedRows<{
      student_profile_id: string;
      plan_stage: string | null;
      status: string | null;
      study_term: string | null;
    }>({
      fetchPage: ({ from, to }) =>
        supabase
          .from("study_plan_modules")
          .select("student_profile_id,plan_stage,status,study_term")
          .in("student_profile_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
    });

    const modulesByProfileId = new Map<string, any[]>();
    for (const m of moduleRows) {
      const pid = String(m?.student_profile_id ?? "").trim();
      if (!pid) continue;
      const arr = modulesByProfileId.get(pid) ?? [];
      arr.push(m);
      modulesByProfileId.set(pid, arr);
    }

    for (const profileId of chunk) {
      const student = degreeStudentsById.get(profileId);
      if (!student) continue;

      const latestBridging = resolveLatestBridgingTerm(
        modulesByProfileId.get(profileId) ?? []
      );
      if (!latestBridging) continue;

      const identity = studentIdentityKey({
        profileId,
        studentId: student.studentId,
      });

      const baseRow = {
        academicYear,
        targetProgrammeCode: programmeCode,
        sourceCategory: "degree_bridging" as const,
        sourceProgrammeCode: programmeCode,
        sourceProgrammeStream: "",
        studentId: String(student.studentId ?? "").trim(),
        studentName: String(student.studentName ?? "").trim(),
        studyMode: normalizeStudyMode(student.studyMode),
        calculatedTerm: latestBridging,
        profileId,
      };

      // Sep intake: latest bridging term is Feb/Jun immediately before Sep anchor.
      if (sepGraduateTerms.includes(latestBridging)) {
        addToModeSet(sepBridging, student.studyMode, identity);
        addToModeSet(sepUnion, student.studyMode, identity);
        addToModeSet(yearBridging, student.studyMode, identity);
        appendNewIntakeStudentRow(studentRows, seenRowKeys, {
          ...baseRow,
          intakeOfferedTerm: "Sep",
          intakeStudyTerm: sepTerm,
        });
      }

      // Feb intake: latest bridging term is Sep immediately before Feb anchor.
      if (febGraduateTerm && latestBridging === febGraduateTerm) {
        addToModeSet(febBridging, student.studyMode, identity);
        addToModeSet(febUnion, student.studyMode, identity);
        addToModeSet(yearBridging, student.studyMode, identity);
        appendNewIntakeStudentRow(studentRows, seenRowKeys, {
          ...baseRow,
          intakeOfferedTerm: "Feb",
          intakeStudyTerm: febTerm,
        });
      }
    }
  }

  const termRows = termsTemplate.map((row) => {
    if (row.offeredTerm === "Sep") {
      return {
        ...row,
        totalFt: sepUnion.ft.size,
        totalPt: sepUnion.pt.size,
        fromHdFt: sepHd.ft.size,
        fromHdPt: sepHd.pt.size,
        fromDegreeBridgingFt: sepBridging.ft.size,
        fromDegreeBridgingPt: sepBridging.pt.size,
      };
    }

    if (row.offeredTerm === "Feb") {
      return {
        ...row,
        totalFt: febUnion.ft.size,
        totalPt: febUnion.pt.size,
        fromHdFt: febHd.ft.size,
        fromHdPt: febHd.pt.size,
        fromDegreeBridgingFt: febBridging.ft.size,
        fromDegreeBridgingPt: febBridging.pt.size,
      };
    }

    // Jun: degree has no direct Jun intake (kept for consistent UI).
    return {
      ...row,
      totalFt: 0,
      totalPt: 0,
      fromHdFt: 0,
      fromHdPt: 0,
      fromDegreeBridgingFt: 0,
      fromDegreeBridgingPt: 0,
    };
  });

  const ft = termRows.reduce((sum, r) => sum + r.totalFt, 0);
  const pt = termRows.reduce((sum, r) => sum + r.totalPt, 0);

  studentRows.sort((a, b) => {
    const termDiff = compareStudyTerm(a.intakeStudyTerm, b.intakeStudyTerm);
    if (termDiff !== 0) return termDiff;

    const sourceDiff = a.sourceCategory.localeCompare(b.sourceCategory);
    if (sourceDiff !== 0) return sourceDiff;

    const codeDiff = a.sourceProgrammeCode.localeCompare(b.sourceProgrammeCode);
    if (codeDiff !== 0) return codeDiff;

    return a.studentId.localeCompare(b.studentId);
  });

  return {
    report: {
      academicYear,
      programmeCode,
      programmeType: isDegreeProgrammeType(programmeType)
        ? programmeType
        : programmeType,
      totals: { ft, pt, total: ft + pt },
      fromHd: {
        ft: yearHd.ft.size,
        pt: yearHd.pt.size,
        total: yearHd.ft.size + yearHd.pt.size,
      },
      fromDegreeBridging: {
        ft: yearBridging.ft.size,
        pt: yearBridging.pt.size,
        total: yearBridging.ft.size + yearBridging.pt.size,
      },
      terms: termRows,
    },
    students: studentRows,
  };
}

export async function getNewIntakeReport(params: {
  academicYear: string;
  programmeCode: string;
}): Promise<NewIntakeReport> {
  const { report } = await computeNewIntake(params);
  return report;
}

export async function listNewIntakeStudents(params: {
  academicYear: string;
  programmeCode: string;
}): Promise<NewIntakeStudentRow[]> {
  const { students } = await computeNewIntake(params);
  return students;
}

export async function downloadNewIntakeReportCsv(params: {
  academicYear: string;
  programmeCode: string;
}): Promise<{ fileName: string; rowCount: number }> {
  const academicYear = normalizeAcademicYear(params.academicYear);
  const programmeCode = String(params.programmeCode ?? "").trim();
  const students = await listNewIntakeStudents({
    academicYear,
    programmeCode,
  });

  if (students.length === 0) {
    throw new Error("沒有符合條件的 new intake 學生，無法匯出。");
  }

  const headers = [
    "Academic Year",
    "Target Programme",
    "Intake Term",
    "Intake Study Term",
    "Source Category",
    "Source Programme Code",
    "Source Programme Stream",
    "Student ID",
    "Student Name",
    "Study Mode",
    "Calculated Term",
    "Profile ID",
  ];

  const csvRows = students.map((row) => [
    row.academicYear,
    row.targetProgrammeCode,
    row.intakeOfferedTerm,
    row.intakeStudyTerm,
    sourceCategoryLabel(row.sourceCategory),
    row.sourceProgrammeCode,
    row.sourceProgrammeStream === "nil" || !row.sourceProgrammeStream
      ? "-"
      : row.sourceProgrammeStream,
    row.studentId,
    row.studentName,
    row.studyMode,
    row.calculatedTerm,
    row.profileId,
  ]);

  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const fileName = `new_intake_${programmeCode}_${sanitizeAcademicYearForFilename(academicYear)}_${dateStamp}.csv`;

  saveAs(
    new Blob([rowsToCsv(headers, csvRows)], {
      type: "text/csv;charset=utf-8;",
    }),
    fileName
  );

  return {
    fileName,
    rowCount: students.length,
  };
}

