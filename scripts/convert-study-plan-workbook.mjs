/**
 * One-off converter: Testing Data/StudyPlan.xlsx -> Testing Data/Study Plan/{CODE}.xlsx
 * Does NOT touch application source code.
 */
import fs from "fs";
import path from "path";
import XLSX from "xlsx";

const ROOT = path.resolve("Testing Data");
const SOURCE = path.join(ROOT, "StudyPlan.xlsx");
const OUTPUT_DIR = path.join(ROOT, "Study Plan");
const PROGRAMMES_FILE = path.join(ROOT, "Programmes.xlsx");

const SKIP_SHEETS = new Set([
  "modules",
  "adst_noncrime",
  "adst_crime",
  "quota",
  "mod",
  "codes",
  "timetable",
  "hdc(clear)",
]);

const META_HEADERS = new Set([
  "name",
  "student name",
  "sex",
  "sid",
  "h",
  "intake year",
  "intake level",
  "intake term",
  "smode",
  "study mode",
  "mode",
  "focus area",
  "programme stream",
  "program stream",
  "stream",
  "entry qualification",
  "entry_qualification",
]);

function cleanText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeader(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, " ");
}

function isExampleValue(value) {
  const text = cleanText(value).toLowerCase();
  return !text || text.startsWith("e.g.") || text === "m/f" || text === "f/m";
}

function isStudyTermValue(value) {
  const text = cleanText(value).toUpperCase();
  if (!text) return false;
  if (/^T\d{4}[A-Z]$/.test(text)) return true;
  return text.includes("EXEMPT");
}

function isLikelyModuleCode(value) {
  const text = cleanText(value).toUpperCase();
  if (!text) return false;
  if (isStudyTermValue(text)) return false;
  return /^(?=.*\d)[A-Z0-9]+(?:[_-][A-Z0-9]+)*$/.test(text);
}

function loadProgrammeTypes() {
  const workbook = XLSX.readFile(PROGRAMMES_FILE);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const map = new Map();

  for (const row of rows) {
    const code = cleanText(row["Programme Code"]).toUpperCase();
    const type = cleanText(row["Programme Type"]);
    if (code) {
      map.set(code, type);
    }
  }

  return map;
}

function guessProgrammeType(programmeCode, programmeTypes) {
  const code = programmeCode.toUpperCase();
  if (programmeTypes.has(code)) {
    return programmeTypes.get(code);
  }

  if (code.startsWith("HD")) {
    return "HD";
  }

  if (/^(WU|UW|TU)/.test(code)) {
    return "Degree";
  }

  return "HD";
}

function findHeaderRow(rows) {
  for (let index = 0; index < rows.length; index += 1) {
    const first = normalizeHeader(rows[index]?.[0]);
    if (first === "name" || first === "student name") {
      return index;
    }
  }

  return -1;
}

function findColumnIndex(headers, aliases) {
  const normalizedAliases = aliases.map((alias) => normalizeHeader(alias));

  for (let index = 0; index < headers.length; index += 1) {
    const header = normalizeHeader(headers[index]);
    if (normalizedAliases.includes(header)) {
      return index;
    }
  }

  return -1;
}

function classifyIntakeYearColumns(headers, rows, headerRowIndex) {
  const indexes = headers
    .map((header, index) => ({ header: normalizeHeader(header), index }))
    .filter(({ header }) => header === "intake year" || header === "intake level")
    .map(({ index }) => index);

  const intakeTermIndex = findColumnIndex(headers, ["intake term"]);
  const intakeLevelIndex = findColumnIndex(headers, ["intake level"]);

  if (intakeTermIndex >= 0 && intakeLevelIndex >= 0) {
    return { intakeTermIndex, intakeLevelIndex };
  }

  if (indexes.length === 0) {
    return { intakeTermIndex: -1, intakeLevelIndex: -1 };
  }

  if (indexes.length === 1) {
    const sampleValues = rows
      .slice(headerRowIndex + 1, headerRowIndex + 12)
      .map((row) => cleanText(row[indexes[0]]));

    const termVotes = sampleValues.filter((value) =>
      /^T\d{4}[A-Z]$/i.test(value)
    ).length;
    const levelVotes = sampleValues.filter((value) =>
      /^year\s*\d+/i.test(value)
    ).length;

    if (termVotes >= levelVotes) {
      return {
        intakeTermIndex: indexes[0],
        intakeLevelIndex: intakeLevelIndex >= 0 ? intakeLevelIndex : -1,
      };
    }

    return {
      intakeTermIndex: intakeTermIndex >= 0 ? intakeTermIndex : -1,
      intakeLevelIndex: indexes[0],
    };
  }

  const scored = indexes.map((index) => {
    const sampleValues = rows
      .slice(headerRowIndex + 1, headerRowIndex + 12)
      .map((row) => cleanText(row[index]));

    return {
      index,
      termVotes: sampleValues.filter((value) => /^T\d{4}[A-Z]$/i.test(value))
        .length,
      levelVotes: sampleValues.filter((value) => /^year\s*\d+/i.test(value))
        .length,
    };
  });

  const termColumn =
    scored.sort((a, b) => b.termVotes - a.termVotes)[0]?.index ?? indexes[0];
  const levelColumn =
    scored.sort((a, b) => b.levelVotes - a.levelVotes)[0]?.index ?? indexes[1];

  return {
    intakeTermIndex:
      intakeTermIndex >= 0
        ? intakeTermIndex
        : termColumn === levelColumn
          ? indexes.find((index) => index !== levelColumn) ?? termColumn
          : termColumn,
    intakeLevelIndex:
      intakeLevelIndex >= 0
        ? intakeLevelIndex
        : levelColumn === termColumn
          ? indexes.find((index) => index !== termColumn) ?? levelColumn
          : levelColumn,
  };
}

function findModulePairColumns(headers) {
  const pairs = [];

  for (let index = 0; index < headers.length - 1; index += 1) {
    const currentHeader = normalizeHeader(headers[index]);
    const nextHeader = normalizeHeader(headers[index + 1]);

    if (nextHeader !== "term") {
      continue;
    }

    if (META_HEADERS.has(currentHeader)) {
      continue;
    }

    pairs.push({ moduleIndex: index, termIndex: index + 1 });
  }

  return pairs;
}

function buildOutputHeader(maxPairs) {
  const header = [
    "Student Name",
    "Intake Level",
    "student ID",
    "Intake term",
    "study mode",
    "programme stream",
  ];

  for (let index = 0; index < maxPairs; index += 1) {
    header.push("Module code", "Study term");
  }

  return header;
}

function convertSheet(sheetName, worksheet, programmeTypes) {
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });

  const headerRowIndex = findHeaderRow(rows);
  if (headerRowIndex < 0) {
    return {
      ok: false,
      reason: "No student header row found",
    };
  }

  const headers = rows[headerRowIndex].map((cell) => cleanText(cell));
  const isDegree = guessProgrammeType(sheetName, programmeTypes) === "Degree";

  const nameIndex = 0;
  const sidIndex = findColumnIndex(headers, ["sid", "student id", "student_id"]);
  const { intakeTermIndex, intakeLevelIndex } = classifyIntakeYearColumns(
    headers,
    rows,
    headerRowIndex
  );
  const studyModeIndex = findColumnIndex(headers, [
    "smode",
    "study mode",
    "study_mode",
    "mode",
  ]);
  const focusAreaIndex = findColumnIndex(headers, [
    "focus area",
    "programme stream",
    "program stream",
    "stream",
  ]);
  const modulePairs = findModulePairColumns(headers);

  if (sidIndex < 0 || intakeTermIndex < 0 || modulePairs.length === 0) {
    return {
      ok: false,
      reason: "Missing SID, intake term, or module/term columns",
    };
  }

  const students = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const studentName = cleanText(row[nameIndex]);

    if (!studentName || isExampleValue(studentName)) {
      continue;
    }

    const studentId = cleanText(row[sidIndex]);
    const intakeTerm = cleanText(row[intakeTermIndex]);

    if (!studentId || isExampleValue(studentId)) {
      continue;
    }

    if (!intakeTerm || isExampleValue(intakeTerm)) {
      continue;
    }

    const rawIntakeLevel =
      intakeLevelIndex >= 0 ? cleanText(row[intakeLevelIndex]) : "";
    const intakeLevel = isDegree
      ? "Year 3"
      : rawIntakeLevel && !isExampleValue(rawIntakeLevel)
        ? rawIntakeLevel
        : "Year 1";

    const studyMode = isDegree
      ? "FT"
      : cleanText(row[studyModeIndex]).toUpperCase();
    const focusArea =
      focusAreaIndex >= 0 ? cleanText(row[focusAreaIndex]) : "";

    const programmeStream = isDegree
      ? "nil"
      : focusArea && !isExampleValue(focusArea)
        ? focusArea
        : "nil";

    const modules = [];

    for (const pair of modulePairs) {
      const moduleCode = cleanText(row[pair.moduleIndex]).toUpperCase();
      const studyTerm = cleanText(row[pair.termIndex]);

      if (!moduleCode && !studyTerm) {
        continue;
      }

      if (!moduleCode && studyTerm) {
        continue;
      }

      if (moduleCode && !studyTerm) {
        continue;
      }

      if (!isLikelyModuleCode(moduleCode) && !isStudyTermValue(studyTerm)) {
        continue;
      }

      modules.push({
        moduleCode,
        studyTerm: isStudyTermValue(studyTerm)
          ? studyTerm.toUpperCase().includes("EXEMPT")
            ? "Exempted"
            : studyTerm.toUpperCase()
          : studyTerm,
      });
    }

    if (modules.length === 0) {
      continue;
    }

    students.push({
      studentName,
      intakeLevel,
      studentId,
      intakeTerm: intakeTerm.toUpperCase(),
      studyMode,
      programmeStream,
      modules,
    });
  }

  if (students.length === 0) {
    return {
      ok: false,
      reason: "No valid student rows found",
    };
  }

  const maxPairs = Math.max(...students.map((student) => student.modules.length));

  const outputRows = [buildOutputHeader(maxPairs)];

  for (const student of students) {
    const outputRow = [
      student.studentName,
      student.intakeLevel,
      student.studentId,
      student.intakeTerm,
      student.studyMode,
      student.programmeStream,
    ];

    for (let index = 0; index < maxPairs; index += 1) {
      const module = student.modules[index];
      outputRow.push(module?.moduleCode ?? "", module?.studyTerm ?? "");
    }

    outputRows.push(outputRow);
  }

  return {
    ok: true,
    students: students.length,
    maxPairs,
    outputRows,
  };
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`Source file not found: ${SOURCE}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const programmeTypes = loadProgrammeTypes();
  const workbook = XLSX.readFile(SOURCE);

  const summary = [];

  for (const sheetName of workbook.SheetNames) {
    const normalizedSheet = sheetName.trim().toLowerCase();

    if (SKIP_SHEETS.has(normalizedSheet)) {
      summary.push({ sheet: sheetName, status: "skipped" });
      continue;
    }

    const result = convertSheet(
      sheetName,
      workbook.Sheets[sheetName],
      programmeTypes
    );

    if (!result.ok) {
      summary.push({
        sheet: sheetName,
        status: "failed",
        reason: result.reason,
      });
      continue;
    }

    const outputPath = path.join(
      OUTPUT_DIR,
      `${sheetName.trim().toUpperCase()}.xlsx`
    );
    const outputWorkbook = XLSX.utils.book_new();
    const outputWorksheet = XLSX.utils.aoa_to_sheet(result.outputRows);
    XLSX.utils.book_append_sheet(outputWorkbook, outputWorksheet, "Sheet1");
    XLSX.writeFile(outputWorkbook, outputPath);

    summary.push({
      sheet: sheetName,
      status: "written",
      file: outputPath,
      students: result.students,
      maxPairs: result.maxPairs,
    });
  }

  console.log(JSON.stringify(summary, null, 2));
}

main();
