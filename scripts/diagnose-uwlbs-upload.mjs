import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const envPath = path.join(ROOT, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    process.env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
}

const { parseStudyPlanWorkbookBuffer, previewInitialStudyPlanRows } =
  await import("../src/services/initialStudyPlanUploadService.ts");

const buffer = fs.readFileSync(
  path.join(ROOT, "Testing Data", "Study Plan", "UWLBS.xlsx")
);
const rows = parseStudyPlanWorkbookBuffer(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
);

const { grouped, errors, warnings } = await previewInitialStudyPlanRows(rows, {
  programmeCode: "UWLBS",
});

console.log("=== GROUPED STUDENTS ===");
for (const [studentId, plan] of grouped.entries()) {
  console.log(
    `row ${plan.rowNumber} | ${studentId} | intake ${plan.student.intakeTerm} | modules ${plan.modules.length}`
  );
}

console.log("\n=== PARSE ERRORS ===");
for (const error of errors) {
  console.log(`row ${error.row ?? "?"} | ${error.studentId ?? ""} | ${error.message}`);
}

const t2025c = ["12560046", "12560048", "12560054", "12560055"];
console.log("\n=== T2025C IN GROUPED? ===");
for (const id of t2025c) {
  const plan = grouped.get(id);
  console.log(id, plan ? `YES row ${plan.rowNumber} modules=${plan.modules.length}` : "NO");
}
