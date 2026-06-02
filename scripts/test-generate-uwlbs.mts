import {
  generateStudyPlanForStudent,
  getDegreeStartTermAfterBridging,
} from "../src/pages/programme-leader/make-study-plan/studyPlanRules.ts";

const student = {
  studentId: "12560046",
  studentName: "TEST",
  programmeCode: "UWLBS",
  programmeStream: "nil",
  studyMode: "FT" as const,
  programmeType: "Degree",
  intakeTerm: "T2025C",
  intakeLevel: "Year 3",
};

const modules = [
  {
    moduleCode: "BS401",
    moduleName: "BS401",
    moduleYear: "3",
    moduleTerm: "Sep",
    planStage: "programme" as const,
    programmeCode: "UWLBS",
    programmeStream: "nil",
    studentId: "12560046",
    status: "planned" as const,
  },
];

for (const intakeTerm of ["T2025C", "T2026A"]) {
  const startTerm = getDegreeStartTermAfterBridging([], intakeTerm);
  const out = generateStudyPlanForStudent({
    student: { ...student, intakeTerm },
    modules,
    startTerm,
  });
  console.log(intakeTerm, "start", startTerm, "count", out.length);
}
