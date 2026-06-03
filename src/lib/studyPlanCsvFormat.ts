import type { StudyPlanModule, StudyPlanStudent } from "../pages/programme-leader/make-study-plan/types";

/** Student columns shared by export and initial-upload template (order matches Student Profile). */
export const STUDY_PLAN_CSV_STUDENT_HEADERS = [
  "student ID",
  "Student Name",
  "Intake term",
  "Intake Level",
  "study mode",
  "programme code",
  "programme stream",
  "Articulation",
  "remark1",
  "remark2",
] as const;

export function escapeStudyPlanCsvCell(value: unknown): string {
  const text = String(value ?? "");

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function buildStudyPlanModulePairHeaders(pairCount: number): string[] {
  const headers: string[] = [];

  for (let index = 0; index < pairCount; index += 1) {
    headers.push("Module code", "Study term");
  }

  return headers;
}

export function formatArticulationForCsv(student: StudyPlanStudent): string {
  if (student.okToArticulate === false) {
    return "No";
  }

  return "Yes";
}

export function buildStudyPlanStudentCsvCells(student: StudyPlanStudent): string[] {
  return [
    student.studentId,
    student.studentName,
    student.intakeTerm ?? "",
    student.intakeLevel ?? "",
    student.studyMode,
    student.programmeCode,
    student.programmeStream?.trim() ? student.programmeStream : "nil",
    formatArticulationForCsv(student),
    student.remark1 ?? "",
    student.remark2 ?? "",
  ];
}

export function studyTermCellValue(module: StudyPlanModule): string {
  if (module.status === "exempted") {
    return "Exempted";
  }

  return String(module.studyTerm ?? "").trim();
}

export function buildStudyPlanCsvHeaderRow(modulePairCount: number): string[] {
  return [
    ...STUDY_PLAN_CSV_STUDENT_HEADERS,
    ...buildStudyPlanModulePairHeaders(modulePairCount),
  ];
}

export function buildStudyPlanCsvContent(params: {
  students: Array<{
    student: StudyPlanStudent;
    modules: StudyPlanModule[];
  }>;
  modulePairCount: number;
}): string {
  const headerRow = buildStudyPlanCsvHeaderRow(params.modulePairCount);

  const dataRows = params.students.map(({ student, modules }) => {
    const row = [...buildStudyPlanStudentCsvCells(student)];

    for (const module of modules) {
      row.push(module.moduleCode, studyTermCellValue(module));
    }

    while (row.length < headerRow.length) {
      row.push("");
    }

    return row;
  });

  return [headerRow, ...dataRows]
    .map((row) => row.map(escapeStudyPlanCsvCell).join(","))
    .join("\n");
}

export function parseArticulationFromUpload(value: string): boolean {
  const text = String(value ?? "").trim().toLowerCase();

  if (!text) {
    return true;
  }

  if (["no", "n", "false", "0"].includes(text)) {
    return false;
  }

  return true;
}

export function parseRemarkFromUpload(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}
