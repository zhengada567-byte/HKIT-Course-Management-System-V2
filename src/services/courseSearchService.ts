import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

import { normalizeProgrammeYear } from "../lib/programmeYear";
import { supabase } from "../lib/supabase";
import { assertFeatureUpdatesAllowed } from "./featureLockService";
import type { UserRole } from "../types";
import {
  deleteModule,
  normalizeModuleType,
  normalizeUsesComputerFlag,
  upsertModule,
  type ModuleInput,
} from "./moduleService";
import { listProgrammes } from "./programmeService";
import {
  getModuleTermOrder,
  getModuleYearOrder,
  normalizeStream,
} from "../lib/utils";
import type {
  ModuleRow,
  ModuleTerm,
  ModuleType,
  ModuleUsesComputerFlag,
} from "../types";

export interface CourseSearchRow {
  module_id: string;
  programme_code: string;
  stream_code: string;
  module_code: string;
  module_name: string | null;
  uses_computer: ModuleUsesComputerFlag;
  module_type: ModuleType;
  module_teaching_contact_hours: number;
  module_tutorial_contact_hours: number;
  module_year: string | null;
  module_term: ModuleTerm;
}

export type CourseSearchModuleDraft = {
  module_id: string;
  module_code: string;
  programme_code: string;
  stream_code: string;
  module_name: string;
  module_year: string;
  module_term: ModuleTerm;
  uses_computer: ModuleUsesComputerFlag;
  module_type: ModuleType;
  module_teaching_contact_hours: number;
  module_tutorial_contact_hours: number;
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

export interface ModuleCatalogBreakdownBucket {
  label: string;
  yearOrder: number;
  termOrder: number;
  count: number;
}

export function formatModuleBreakdownYearLabel(
  year: string | null | undefined
): string {
  const order = getModuleYearOrder(year);

  if (order >= 1 && order <= 9) {
    return `Y${order}`;
  }

  const text = normalizeText(year);

  return text || "Unspecified";
}

const MODULE_BREAKDOWN_TERMS: ModuleTerm[] = ["Sep", "Feb", "Jun"];

export function buildModuleCatalogBreakdown(
  rows: Array<{
    module_year: string | null | undefined;
    module_term: ModuleTerm | string | null | undefined;
  }>
) {
  const counts = new Map<string, ModuleCatalogBreakdownBucket>();
  let unclassified = 0;

  for (const row of rows) {
    const year = normalizeText(row.module_year);
    const term = normalizeText(row.module_term) as ModuleTerm;

    if (!year || !MODULE_BREAKDOWN_TERMS.includes(term)) {
      unclassified += 1;
      continue;
    }

    const label = `${formatModuleBreakdownYearLabel(year)} ${term}`;
    const existing = counts.get(label);

    if (existing) {
      existing.count += 1;
      continue;
    }

    counts.set(label, {
      label,
      yearOrder: getModuleYearOrder(year),
      termOrder: getModuleTermOrder(term),
      count: 1,
    });
  }

  const buckets = Array.from(counts.values()).sort((a, b) => {
    if (a.yearOrder !== b.yearOrder) {
      return a.yearOrder - b.yearOrder;
    }

    return a.termOrder - b.termOrder;
  });

  return {
    total: rows.length,
    buckets,
    unclassified,
  };
}

function isCommonStreamModule(streamCode: string | null | undefined) {
  const text = normalizeText(streamCode).toLowerCase();

  return text === "" || text === "nil";
}

export async function searchCourses(params: {
  academicYear?: string;
  programmeCode?: string;
  streamCode?: string;
}) {
  let moduleQuery = supabase
    .from("modules")
    .select("*")
    .order("programme_code")
    .order("stream_code")
    .order("module_code");

  if (params.programmeCode) {
    moduleQuery = moduleQuery.eq("programme_code", params.programmeCode);
  }

  const { data: modules, error: moduleError } = await moduleQuery;

  if (moduleError) throw moduleError;

  const rawSelectedStream = normalizeText(params.streamCode);

  const selectedStream = rawSelectedStream
    ? normalizeStream(rawSelectedStream)
    : "";

  const filteredModules = ((modules ?? []) as ModuleRow[]).filter((module) => {
    if (!selectedStream) {
      return true;
    }

    if (isCommonStreamModule(module.stream_code)) {
      return true;
    }

    const moduleStream = normalizeStream(module.stream_code);

    return moduleStream === selectedStream;
  });

  const rows = filteredModules.map<CourseSearchRow>((module) => ({
    module_id: module.id,
    programme_code: module.programme_code,
    stream_code: module.stream_code,
    module_code: module.module_code,
    module_name: module.module_name,
    uses_computer: normalizeUsesComputerFlag(module.uses_computer),
    module_type: normalizeModuleType(module.module_type),
    module_teaching_contact_hours: Number(
      module.module_teaching_contact_hours ?? 0
    ),
    module_tutorial_contact_hours: Number(
      module.module_tutorial_contact_hours ?? 0
    ),
    module_year: normalizeProgrammeYear(module.module_year),
    module_term: module.module_term,
  }));

  rows.sort((a, b) => {
    const yearDiff =
      getModuleYearOrder(a.module_year) - getModuleYearOrder(b.module_year);

    if (yearDiff !== 0) return yearDiff;

    const termDiff =
      getModuleTermOrder(a.module_term) - getModuleTermOrder(b.module_term);

    if (termDiff !== 0) return termDiff;

    return a.module_code.localeCompare(b.module_code);
  });

  return rows;
}

export function buildCourseSearchDraft(row: CourseSearchRow): CourseSearchModuleDraft {
  return {
    module_id: row.module_id,
    module_code: row.module_code,
    programme_code: row.programme_code,
    stream_code: row.stream_code,
    module_name: row.module_name ?? "",
    module_year: row.module_year ?? "",
    module_term: row.module_term,
    uses_computer: row.uses_computer,
    module_type: row.module_type,
    module_teaching_contact_hours: row.module_teaching_contact_hours,
    module_tutorial_contact_hours: row.module_tutorial_contact_hours,
  };
}

export async function saveCourseSearchModule(params: {
  draft: CourseSearchModuleDraft;
  role?: UserRole | null;
}) {
  await assertFeatureUpdatesAllowed("courseSearch", { role: params.role });

  const { draft } = params;
  const streamCode = normalizeStream(draft.stream_code);

  const moduleInput: ModuleInput = {
    id: draft.module_id,
    module_code: draft.module_code,
    module_name: draft.module_name || null,
    module_year: draft.module_year || null,
    module_term: draft.module_term,
    programme_code: draft.programme_code,
    stream_code: streamCode,
    uses_computer: draft.uses_computer,
    module_type: draft.module_type,
    module_teaching_contact_hours: draft.module_teaching_contact_hours,
    module_tutorial_contact_hours: draft.module_tutorial_contact_hours,
  };

  await upsertModule(moduleInput);
}

async function deleteModuleRelatedEnrollmentRows(module: {
  module_code: string;
  programme_code: string;
  stream_code: string;
  module_term: ModuleTerm;
}) {
  const streamCode = normalizeStream(module.stream_code);

  const { error } = await supabase
    .from("module_enrollment")
    .delete()
    .eq("module_code", module.module_code)
    .eq("programme_code", module.programme_code)
    .eq("stream_code", streamCode)
    .eq("module_term", module.module_term);

  if (error) throw error;
}

async function deleteModuleRelatedDefaultAssignments(module: {
  module_code: string;
  programme_code: string;
  stream_code: string;
  module_term: ModuleTerm;
}) {
  const streamCode = normalizeStream(module.stream_code);

  const { error } = await supabase
    .from("module_default_assignments")
    .delete()
    .eq("module_code", module.module_code)
    .eq("programme_code", module.programme_code)
    .eq("stream_code", streamCode)
    .eq("module_term", module.module_term);

  if (error) throw error;
}

/** Removes module master row and related enrollment / default-assignment rows. */
export async function deleteCourseSearchModule(
  row: CourseSearchRow,
  options?: { role?: UserRole | null }
) {
  await assertFeatureUpdatesAllowed("courseSearch", { role: options?.role });

  await deleteModuleRelatedEnrollmentRows({
    module_code: row.module_code,
    programme_code: row.programme_code,
    stream_code: row.stream_code,
    module_term: row.module_term,
  });

  await deleteModuleRelatedDefaultAssignments({
    module_code: row.module_code,
    programme_code: row.programme_code,
    stream_code: row.stream_code,
    module_term: row.module_term,
  });

  await deleteModule(row.module_id);
}

function excelSheetName(label: string, used: Set<string>) {
  const raw = normalizeText(label) || "Unknown";
  let base = raw
    .replace(/[\\/?*[\]:]/g, "_")
    .slice(0, 31);
  if (!base) base = "Unknown";

  let name = base;
  let suffix = 2;
  while (used.has(name.toUpperCase())) {
    const tag = `_${suffix}`;
    name = `${base.slice(0, Math.max(1, 31 - tag.length))}${tag}`;
    suffix += 1;
  }
  used.add(name.toUpperCase());
  return name;
}

function moduleRowToExportObject(row: CourseSearchRow) {
  return {
    "Programme Code": row.programme_code,
    Stream: row.stream_code || "nil",
    "Module Code": row.module_code,
    "Module Name": row.module_name ?? "",
    Year: row.module_year ?? "",
    Term: row.module_term,
    Type: row.module_type,
    "Uses Computer": row.uses_computer,
    "Teaching Hours": row.module_teaching_contact_hours,
    "Tutorial Hours": row.module_tutorial_contact_hours,
  };
}

function exportStreamLabel(streamCode: string | null | undefined) {
  const text = normalizeText(streamCode);
  if (!text || text.toLowerCase() === "nil") return "nil";
  return normalizeStream(text) || "nil";
}

function sortExportModules(rows: CourseSearchRow[]) {
  return [...rows].sort((a, b) => {
    const yearDiff =
      getModuleYearOrder(a.module_year) - getModuleYearOrder(b.module_year);
    if (yearDiff !== 0) return yearDiff;

    const termDiff =
      getModuleTermOrder(a.module_term) - getModuleTermOrder(b.module_term);
    if (termDiff !== 0) return termDiff;

    const streamA = exportStreamLabel(a.stream_code);
    const streamB = exportStreamLabel(b.stream_code);
    const streamRankA = streamA === "nil" ? 0 : 1;
    const streamRankB = streamB === "nil" ? 0 : 1;
    if (streamRankA !== streamRankB) return streamRankA - streamRankB;
    if (streamA !== streamB) return streamA.localeCompare(streamB);

    return a.module_code.localeCompare(b.module_code);
  });
}

/**
 * Admin-only: download the full module catalogue as one Excel workbook.
 * One sheet per programme stream. Common (nil) modules are included under
 * every stream of that programme — same rule as Course Search filtering.
 */
export async function downloadAllCourseModulesExcel(params?: {
  role?: UserRole | null;
}): Promise<{
  programmeCount: number;
  streamGroupCount: number;
  moduleCount: number;
}> {
  if (params?.role !== "admin") {
    throw new Error("Only Admin can download all course modules.");
  }

  const [programmes, rows] = await Promise.all([
    listProgrammes(),
    searchCourses({}),
  ]);

  if (rows.length === 0) {
    throw new Error("No modules found to export.");
  }

  const modulesByProgramme = new Map<string, CourseSearchRow[]>();
  for (const row of rows) {
    const programmeCode = normalizeText(row.programme_code) || "Unknown";
    const list = modulesByProgramme.get(programmeCode) ?? [];
    list.push(row);
    modulesByProgramme.set(programmeCode, list);
  }

  /** Named streams per programme (nil excluded). From programmes table + module rows. */
  const namedStreamsByProgramme = new Map<string, Set<string>>();

  function addNamedStream(programmeCode: string, streamLabel: string) {
    if (!streamLabel || streamLabel === "nil") return;
    const set = namedStreamsByProgramme.get(programmeCode) ?? new Set<string>();
    set.add(streamLabel);
    namedStreamsByProgramme.set(programmeCode, set);
  }

  for (const programme of programmes) {
    const programmeCode = normalizeText(programme.programme_code);
    if (!programmeCode) continue;
    addNamedStream(programmeCode, exportStreamLabel(programme.programme_stream));
  }

  for (const [programmeCode, moduleRows] of modulesByProgramme) {
    for (const row of moduleRows) {
      addNamedStream(programmeCode, exportStreamLabel(row.stream_code));
    }
  }

  type SheetGroup = {
    programmeCode: string;
    streamLabel: string;
    modules: CourseSearchRow[];
  };

  const sheetGroups: SheetGroup[] = [];

  const programmeCodes = Array.from(
    new Set([
      ...modulesByProgramme.keys(),
      ...namedStreamsByProgramme.keys(),
    ])
  ).sort((a, b) => a.localeCompare(b));

  for (const programmeCode of programmeCodes) {
    const moduleRows = modulesByProgramme.get(programmeCode) ?? [];
    const namedStreams = Array.from(
      namedStreamsByProgramme.get(programmeCode) ?? []
    ).sort((a, b) => a.localeCompare(b));

    if (namedStreams.length === 0) {
      // No named streams: one sheet with the programme's full catalogue.
      sheetGroups.push({
        programmeCode,
        streamLabel: "nil",
        modules: sortExportModules(moduleRows),
      });
      continue;
    }

    for (const streamLabel of namedStreams) {
      const completeList = moduleRows.filter((row) => {
        const rowStream = exportStreamLabel(row.stream_code);
        return rowStream === "nil" || rowStream === streamLabel;
      });

      sheetGroups.push({
        programmeCode,
        streamLabel,
        modules: sortExportModules(completeList),
      });
    }
  }

  const workbook = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();

  const indexRows = sheetGroups.map((group) => ({
    "Programme Code": group.programmeCode,
    Stream: group.streamLabel,
    "Module Count": group.modules.length,
    "Includes Nil Modules":
      group.streamLabel === "nil"
        ? "N/A"
        : group.modules.some(
            (row) => exportStreamLabel(row.stream_code) === "nil"
          )
          ? "Yes"
          : "No",
  }));
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(indexRows),
    excelSheetName("Index", usedSheetNames)
  );

  for (const group of sheetGroups) {
    const sheet = XLSX.utils.json_to_sheet(
      group.modules.map((row) => moduleRowToExportObject(row))
    );
    const sheetLabel =
      group.streamLabel === "nil"
        ? group.programmeCode
        : `${group.programmeCode}_${group.streamLabel}`;
    XLSX.utils.book_append_sheet(
      workbook,
      sheet,
      excelSheetName(sheetLabel, usedSheetNames)
    );
  }

  const buffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  });

  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  saveAs(
    new Blob([buffer]),
    `HKIT_Module_Catalogue_By_Programme_Stream_${dateStamp}.xlsx`
  );

  return {
    programmeCount: programmeCodes.length,
    streamGroupCount: sheetGroups.length,
    moduleCount: rows.length,
  };
}
