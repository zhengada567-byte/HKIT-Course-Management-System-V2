import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STUDY_PLAN_DIR = path.join(ROOT, "Testing Data", "Study Plan");
const REPORT_FILE = path.join(ROOT, "Testing Data", "study-plan-upload-report.txt");

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    process.env[key] = value;
  }
}

loadEnvFile();

const {
  parseStudyPlanWorkbookBuffer,
  uploadInitialStudyPlanRows,
} = await import("../src/services/initialStudyPlanUploadService");
const { listProgrammeOptions, syncStudyPlanPostSave } = await import(
  "../src/services/studyPlanService"
);

async function main() {
  const programmeOptions = await listProgrammeOptions();
  const validProgrammes = new Set(
    programmeOptions.map((item) => item.programmeCode.trim().toUpperCase())
  );

  const files = fs
    .readdirSync(STUDY_PLAN_DIR)
    .filter(
      (name) =>
        name.toLowerCase().endsWith(".xlsx") && !name.startsWith("~$")
    )
    .sort();

  const lines: string[] = [];
  const push = (text = "") => lines.push(text);

  push("Study Plan Batch Upload Report (relaxed mode)");
  push(`Generated: ${new Date().toISOString()}`);
  push(`Valid programmes in system: ${[...validProgrammes].sort().join(", ")}`);
  push("Module aliases: HD406->HD401, HD407->HD402, plus _suffix normalization");
  push("");

  let totalSuccess = 0;
  let totalFailed = 0;

  for (const fileName of files) {
    const programmeCode = path.basename(fileName, ".xlsx").trim().toUpperCase();

    push("=".repeat(72));
    push(`${programmeCode}  (${fileName})`);

    if (!validProgrammes.has(programmeCode)) {
      push("SKIPPED: programme not found in system.");
      push("");
      continue;
    }

    const filePath = path.join(STUDY_PLAN_DIR, fileName);
    const buffer = fs.readFileSync(filePath);
    const rows = parseStudyPlanWorkbookBuffer(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    );

    const result = await uploadInitialStudyPlanRows(
      rows,
      { programmeCode },
      { relaxed: true, deferPostSync: true }
    );

    totalSuccess += result.successStudents;
    totalFailed += result.failedStudents;

    push(
      `Rows: ${result.totalRows}  |  Students: ${result.totalStudents}  |  Success: ${result.successStudents}  |  Failed: ${result.failedStudents}`
    );

    if (result.warnings.length > 0) {
      push(`Warnings: ${result.warnings.length}`);
      for (const warning of result.warnings.slice(0, 5)) {
        push(
          `  - row ${warning.row ?? "?"} ${warning.studentId ?? ""}: ${warning.message}`
        );
      }
      if (result.warnings.length > 5) {
        push(`  ... and ${result.warnings.length - 5} more warnings`);
      }
    }

    if (result.errors.length > 0) {
      push(`Errors: ${result.errors.length}`);
      for (const error of result.errors.slice(0, 10)) {
        push(
          `  - row ${error.row ?? "?"} ${error.studentId ?? ""}: ${error.message}`
        );
      }
      if (result.errors.length > 10) {
        push(`  ... and ${result.errors.length - 10} more errors`);
      }
    }

    push("");
  }

  if (totalSuccess > 0) {
    push("Running final study plan sync...");
    try {
      await syncStudyPlanPostSave();
      push("Final sync completed.");
    } catch (error) {
      push(
        `Final sync failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    push("");
  }

  push("=".repeat(72));
  push(`TOTAL SUCCESS: ${totalSuccess}`);
  push(`TOTAL FAILED: ${totalFailed}`);

  fs.writeFileSync(REPORT_FILE, lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
  console.log(`\nReport saved: ${REPORT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
