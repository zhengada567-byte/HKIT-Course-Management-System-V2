/**
 * Compare module codes in Testing Data/Study Plan/*.xlsx
 * against system module catalog (Supabase + Modules.xlsx fallback).
 */
import fs from "fs";
import path from "path";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve("Testing Data");
const STUDY_PLAN_DIR = path.join(ROOT, "Study Plan");
const MODULES_FILE = path.join(ROOT, "Modules.xlsx");
const PROGRAMMES_FILE = path.join(ROOT, "Programmes.xlsx");
const REPORT_FILE = path.join(ROOT, "study-plan-module-comparison.txt");

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeCode(value) {
  return cleanText(value).toUpperCase();
}

function normalizeStream(value) {
  const text = cleanText(value);
  return text === "" ? "nil" : text;
}

function loadEnv() {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return {};

  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

function loadProgrammeTypes() {
  const workbook = XLSX.readFile(PROGRAMMES_FILE);
  const rows = XLSX.utils.sheet_to_json(
    workbook.Sheets[workbook.SheetNames[0]],
    { defval: "" }
  );

  const map = new Map();
  for (const row of rows) {
    const code = normalizeCode(row["Programme Code"]);
    const type = cleanText(row["Programme Type"]);
    if (code) map.set(code, type);
  }
  return map;
}

function loadModulesFromExcel() {
  const workbook = XLSX.readFile(MODULES_FILE);
  const rows = XLSX.utils.sheet_to_json(
    workbook.Sheets[workbook.SheetNames[0]],
    { defval: "" }
  );

  const byProgramme = new Map();
  const allCodes = new Set();

  for (const row of rows) {
    const programmeCode = normalizeCode(row["Programme Code"]);
    const moduleCode = normalizeCode(row["Module Code"]);
    const streamCode = normalizeStream(row["Stream Code"]);

    if (!programmeCode || !moduleCode) continue;

    allCodes.add(moduleCode);

    const bucket = byProgramme.get(programmeCode) ?? {
      exact: new Set(),
      byStream: new Map(),
    };

    bucket.exact.add(moduleCode);

    const streamBucket = bucket.byStream.get(streamCode) ?? new Set();
    streamBucket.add(moduleCode);
    bucket.byStream.set(streamCode, streamBucket);

    byProgramme.set(programmeCode, bucket);
  }

  return { byProgramme, allCodes };
}

async function loadModulesFromSupabase() {
  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("modules")
    .select("module_code, programme_code, stream_code, module_name");

  if (error) {
    throw error;
  }

  const byProgramme = new Map();
  const allCodes = new Set();

  for (const row of data ?? []) {
    const programmeCode = normalizeCode(row.programme_code);
    const moduleCode = normalizeCode(row.module_code);
    const streamCode = normalizeStream(row.stream_code);

    if (!programmeCode || !moduleCode) continue;

    allCodes.add(moduleCode);

    const bucket = byProgramme.get(programmeCode) ?? {
      exact: new Set(),
      byStream: new Map(),
    };

    bucket.exact.add(moduleCode);

    const streamBucket = bucket.byStream.get(streamCode) ?? new Set();
    streamBucket.add(moduleCode);
    bucket.byStream.set(streamCode, streamBucket);

    byProgramme.set(programmeCode, bucket);
  }

  return { byProgramme, allCodes, source: "supabase", rowCount: data?.length ?? 0 };
}

function baseModuleCode(code) {
  const normalized = normalizeCode(code);
  const underscore = normalized.indexOf("_");
  const hyphen = normalized.indexOf("-");

  if (underscore > 0) return normalized.slice(0, underscore);
  if (hyphen > 0) return normalized.slice(0, hyphen);
  return normalized;
}

function extractModulesFromStudyPlanFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(
    workbook.Sheets[workbook.SheetNames[0]],
    { header: 1, defval: "" }
  );

  if (rows.length === 0) {
    return { students: 0, moduleCodes: new Set(), usageCount: new Map() };
  }

  const headers = rows[0].map((cell) => cleanText(cell));
  const moduleCodes = new Set();
  const usageCount = new Map();
  let students = 0;

  const pairIndexes = [];
  for (let index = 0; index < headers.length - 1; index += 1) {
    if (
      headers[index + 1].toLowerCase() === "study term" &&
      headers[index].toLowerCase() === "module code"
    ) {
      pairIndexes.push(index);
    }
  }

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const studentName = cleanText(row[0]);
    if (!studentName) continue;

    students += 1;

    for (const col of pairIndexes) {
      const moduleCode = normalizeCode(row[col]);
      const studyTerm = cleanText(row[col + 1]);

      if (!moduleCode || !studyTerm) continue;

      moduleCodes.add(moduleCode);
      usageCount.set(moduleCode, (usageCount.get(moduleCode) ?? 0) + 1);
    }
  }

  return { students, moduleCodes, usageCount };
}

function classifyModule(moduleCode, programmeCode, catalog, allCodes) {
  const exactInProgramme = catalog?.exact?.has(moduleCode) ?? false;
  const base = baseModuleCode(moduleCode);
  const baseInProgramme = catalog?.exact?.has(base) ?? false;
  const exactAnyProgramme = allCodes.has(moduleCode);
  const baseAnyProgramme = allCodes.has(base);

  if (exactInProgramme) {
    return { status: "exact_match", matchedAs: moduleCode };
  }

  if (baseInProgramme && base !== moduleCode) {
    return { status: "alias_match", matchedAs: base };
  }

  if (exactAnyProgramme) {
    return { status: "other_programme", matchedAs: moduleCode };
  }

  if (baseAnyProgramme && base !== moduleCode) {
    return { status: "other_programme_alias", matchedAs: base };
  }

  return { status: "missing", matchedAs: null };
}

async function main() {
  const programmeTypes = loadProgrammeTypes();
  const excelCatalog = loadModulesFromExcel();

  let catalog = excelCatalog;
  let catalogSource = "Modules.xlsx";

  try {
    const supabaseCatalog = await loadModulesFromSupabase();
    if (supabaseCatalog) {
      catalog = supabaseCatalog;
      catalogSource = `Supabase (${supabaseCatalog.rowCount} rows)`;
    }
  } catch (error) {
    console.warn("Supabase unavailable, using Modules.xlsx:", error.message);
  }

  const files = fs
    .readdirSync(STUDY_PLAN_DIR)
    .filter((name) => name.toLowerCase().endsWith(".xlsx"))
    .sort();

  const lines = [];
  const push = (text = "") => lines.push(text);

  push("Study Plan Module Comparison Report");
  push(`Generated: ${new Date().toISOString()}`);
  push(`Catalog source: ${catalogSource}`);
  push(`Study plan files: ${files.length}`);
  push("");

  const globalMissing = new Map();

  for (const fileName of files) {
    const programmeCode = normalizeCode(path.basename(fileName, ".xlsx"));
    const programmeType =
      programmeTypes.get(programmeCode) ??
      (programmeCode.startsWith("HD") ? "HD" : "Degree");

    const filePath = path.join(STUDY_PLAN_DIR, fileName);
    const extracted = extractModulesFromStudyPlanFile(filePath);
    const programmeCatalog = catalog.byProgramme.get(programmeCode);

    push("=".repeat(72));
    push(`${programmeCode} (${programmeType})  |  file: ${fileName}`);
    push(
      `Students: ${extracted.students}  |  Unique module codes in Excel: ${extracted.moduleCodes.size}`
    );
    push(
      `Programme catalog size: ${programmeCatalog?.exact?.size ?? 0} module codes`
    );
    push("");

    const buckets = {
      exact_match: [],
      alias_match: [],
      other_programme: [],
      other_programme_alias: [],
      missing: [],
    };

    for (const moduleCode of [...extracted.moduleCodes].sort()) {
      const result = classifyModule(
        moduleCode,
        programmeCode,
        programmeCatalog,
        catalog.allCodes
      );
      buckets[result.status].push({
        moduleCode,
        matchedAs: result.matchedAs,
        uses: extracted.usageCount.get(moduleCode) ?? 0,
      });
    }

    push(
      `Exact match in ${programmeCode}: ${buckets.exact_match.length}  |  Alias match (_suffix): ${buckets.alias_match.length}`
    );
    push(
      `In other programme: ${buckets.other_programme.length + buckets.other_programme_alias.length}  |  Missing completely: ${buckets.missing.length}`
    );
    push("");

    if (buckets.missing.length > 0) {
      push("MISSING (not in system catalog at all):");
      for (const item of buckets.missing) {
        push(`  - ${item.moduleCode}  (${item.uses} cell uses)`);
        const list = globalMissing.get(item.moduleCode) ?? [];
        list.push(programmeCode);
        globalMissing.set(item.moduleCode, list);
      }
      push("");
    }

    if (buckets.alias_match.length > 0) {
      push("ALIAS ONLY (Excel code has suffix; base exists in this programme):");
      for (const item of buckets.alias_match) {
        push(`  - ${item.moduleCode} -> ${item.matchedAs}  (${item.uses} uses)`);
      }
      push("");
    }

    if (buckets.other_programme.length + buckets.other_programme_alias.length > 0) {
      push("IN OTHER PROGRAMME (exists in system, but not under this programme):");
      for (const item of [
        ...buckets.other_programme,
        ...buckets.other_programme_alias,
      ]) {
        push(
          `  - ${item.moduleCode}${item.matchedAs && item.matchedAs !== item.moduleCode ? ` -> ${item.matchedAs}` : ""}  (${item.uses} uses)`
        );
      }
      push("");
    }

    if (programmeType === "Degree" && buckets.missing.length > 0) {
      push(
        "NOTE: Degree upload will FAIL students using missing modules unless catalog/articulation is updated or upload rules are relaxed."
      );
      push("");
    } else if (programmeType === "HD" && buckets.missing.length > 0) {
      push(
        "NOTE: HD upload can still save these students; missing modules will use module code as module name."
      );
      push("");
    }
  }

  push("=".repeat(72));
  push("GLOBAL SUMMARY - Missing module codes across all study plan files");
  push("");

  if (globalMissing.size === 0) {
    push("No completely missing module codes.");
  } else {
    for (const [moduleCode, programmes] of [...globalMissing.entries()].sort()) {
      push(`  ${moduleCode}  ->  used in: ${programmes.join(", ")}`);
    }
  }

  fs.writeFileSync(REPORT_FILE, lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
  console.log(`\nReport saved: ${REPORT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
