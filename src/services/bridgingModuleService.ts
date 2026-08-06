import { normalizeAcademicYear, normalizeStream } from "../lib/utils";
import { supabase } from "../lib/supabase";
import {
  isDegreeProgrammeByCode,
  isHDProgrammeByCode,
  loadBridgingModuleOptionsForDegree,
} from "./studyPlanService";
import {
  listModuleDefaultAssignments,
  moduleDefaultAssignmentKey,
  type ProgrammeModuleTeacherRow,
} from "./moduleDefaultAssignmentService";
import { listModules, upsertModule } from "./moduleService";
import { ensureTimetablePlanningModules } from "./timetableService";
import type {
  BridgingModuleOfferingRow,
  ModuleRow,
  ModuleTerm,
} from "../types";

export function isBridgingModuleCode(moduleCode: string | null | undefined) {
  const code = String(moduleCode ?? "")
    .trim()
    .toUpperCase();
  // HD short offerings: GS401B, CS405B, …
  return /^[A-Z]{2}\d{3}B$/.test(code);
}

/** GS401 → GS401B; already GS401B → GS401B. */
export function buildBridgingModuleCode(parentModuleCode: string) {
  const code = String(parentModuleCode ?? "")
    .trim()
    .toUpperCase();
  if (!code) return "";
  if (isBridgingModuleCode(code)) return code;
  return `${code}B`;
}

export function bridgingOfferingKey(
  academicYear: string,
  moduleTerm: ModuleTerm,
  parentModuleId: string
) {
  return `${normalizeAcademicYear(academicYear)}|${moduleTerm}|${parentModuleId}`;
}

export async function listBridgingModuleOfferings(params: {
  academicYear: string;
  moduleTerm?: ModuleTerm;
  status?: BridgingModuleOfferingRow["status"];
}) {
  const academicYear = normalizeAcademicYear(params.academicYear);

  let query = supabase
    .from("bridging_module_offerings")
    .select("*")
    .eq("academic_year", academicYear)
    .order("bridging_module_code");

  if (params.moduleTerm) {
    query = query.eq("module_term", params.moduleTerm);
  }

  if (params.status) {
    query = query.eq("status", params.status);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as BridgingModuleOfferingRow[];
}

export type BridgingParentCandidate = {
  parent: ModuleRow;
  bridgingModuleCode: string;
  existingOffering: BridgingModuleOfferingRow | null;
  existingBridgingModule: ModuleRow | null;
};

/**
 * HD parents eligible for short bridging creation in the selected term.
 * Degree programme → articulated HD modules; HD programme → own catalogue.
 * Parent list is the full programme catalogue (all Sep/Feb/Jun); the selected
 * moduleTerm only controls which term the GS401B offering is activated for.
 */
export async function listBridgingParentCandidates(params: {
  academicYear: string;
  programmeCode: string;
  moduleTerm: ModuleTerm;
}): Promise<BridgingParentCandidate[]> {
  const programmeCode = String(params.programmeCode ?? "").trim();
  if (!programmeCode) return [];

  const academicYear = normalizeAcademicYear(params.academicYear);
  const [isHd, isDegree, offerings] = await Promise.all([
    isHDProgrammeByCode(programmeCode),
    isDegreeProgrammeByCode(programmeCode),
    listBridgingModuleOfferings({
      academicYear,
      moduleTerm: params.moduleTerm,
    }),
  ]);

  let parents: ModuleRow[] = [];

  if (isHd) {
    parents = await listModules({
      programme_code: programmeCode,
    });
  } else if (isDegree) {
    const bridgingOptions = await loadBridgingModuleOptionsForDegree({
      degreeProgrammeCode: programmeCode,
    });
    const ids = Array.from(
      new Set(
        bridgingOptions
          .map((row) => String(row.sourceModuleId ?? "").trim())
          .filter(Boolean)
      )
    );

    if (ids.length === 0) {
      return [];
    }

    const { data, error } = await supabase
      .from("modules")
      .select("*")
      .in("id", ids)
      .order("programme_code")
      .order("module_code");

    if (error) throw error;
    parents = (data ?? []) as ModuleRow[];
  } else {
    parents = await listModules({
      programme_code: programmeCode,
    });
  }

  parents = parents.filter((module) => {
    const code = String(module.module_code ?? "")
      .trim()
      .toUpperCase();
    if (isBridgingModuleCode(code)) return false;
    // Short bridging codes are defined for HD-style parents (e.g. GS401 → GS401B).
    return /^[A-Z]{2}\d{3}$/.test(code);
  });

  const offeringByParentId = new Map(
    offerings.map((row) => [row.parent_module_id, row])
  );

  const bridgingIds = Array.from(
    new Set(
      offerings
        .map((row) => row.bridging_module_id)
        .filter(Boolean)
    )
  );

  const bridgingById = new Map<string, ModuleRow>();
  if (bridgingIds.length > 0) {
    const { data, error } = await supabase
      .from("modules")
      .select("*")
      .in("id", bridgingIds);

    if (error) throw error;
    for (const row of (data ?? []) as ModuleRow[]) {
      bridgingById.set(row.id, row);
    }
  }

  const expectedCodes = Array.from(
    new Set(parents.map((parent) => buildBridgingModuleCode(parent.module_code)))
  ).filter(Boolean);

  const bridgingByIdentity = new Map<string, ModuleRow>();
  if (expectedCodes.length > 0) {
    const programmeCodes = Array.from(
      new Set(parents.map((parent) => parent.programme_code))
    );
    const { data, error } = await supabase
      .from("modules")
      .select("*")
      .in("module_code", expectedCodes)
      .in("programme_code", programmeCodes);

    if (error) throw error;
    for (const row of (data ?? []) as ModuleRow[]) {
      const key = `${String(row.module_code).toUpperCase()}|${row.programme_code}|${normalizeStream(row.stream_code)}`;
      bridgingByIdentity.set(key, row);
    }
  }

  const result: BridgingParentCandidate[] = [];

  for (const parent of parents) {
    const bridgingModuleCode = buildBridgingModuleCode(parent.module_code);
    const existingOffering = offeringByParentId.get(parent.id) ?? null;
    let existingBridgingModule = existingOffering
      ? bridgingById.get(existingOffering.bridging_module_id) ?? null
      : null;

    if (!existingBridgingModule) {
      const key = `${bridgingModuleCode}|${parent.programme_code}|${normalizeStream(parent.stream_code)}`;
      existingBridgingModule = bridgingByIdentity.get(key) ?? null;
    }

    result.push({
      parent,
      bridgingModuleCode,
      existingOffering,
      existingBridgingModule,
    });
  }

  return result.sort((a, b) => {
    const codeCmp = a.parent.module_code.localeCompare(
      b.parent.module_code,
      undefined,
      { sensitivity: "base" }
    );
    if (codeCmp !== 0) return codeCmp;
    return normalizeStream(a.parent.stream_code).localeCompare(
      normalizeStream(b.parent.stream_code),
      undefined,
      { sensitivity: "base" }
    );
  });
}

export type CreateBridgingModulesResult = {
  created: BridgingModuleOfferingRow[];
  reused: BridgingModuleOfferingRow[];
  skippedExisting: BridgingModuleOfferingRow[];
};

/**
 * Create or reuse GS401B catalogue rows and activate offerings for the term.
 * If an active/inactive offering already exists for parent+term → do not create again
 * (reactivate if inactive when creating).
 */
export async function createBridgingModuleOfferings(params: {
  academicYear: string;
  moduleTerm: ModuleTerm;
  parentModuleIds: string[];
  createdBy?: string | null;
  /** Optional per-parent hour overrides keyed by parent module id. */
  hoursByParentId?: Record<
    string,
    {
      module_teaching_contact_hours?: number | null;
      module_tutorial_contact_hours?: number | null;
    }
  >;
}): Promise<CreateBridgingModulesResult> {
  const academicYear = normalizeAcademicYear(params.academicYear);
  const parentIds = Array.from(
    new Set(params.parentModuleIds.map((id) => String(id ?? "").trim()).filter(Boolean))
  );

  if (parentIds.length === 0) {
    return { created: [], reused: [], skippedExisting: [] };
  }

  const { data: parentRows, error: parentError } = await supabase
    .from("modules")
    .select("*")
    .in("id", parentIds);

  if (parentError) throw parentError;

  const parents = (parentRows ?? []) as ModuleRow[];
  if (parents.length === 0) {
    return { created: [], reused: [], skippedExisting: [] };
  }

  const existingOfferings = await listBridgingModuleOfferings({
    academicYear,
    moduleTerm: params.moduleTerm,
  });
  const offeringByParentId = new Map(
    existingOfferings.map((row) => [row.parent_module_id, row])
  );

  const created: BridgingModuleOfferingRow[] = [];
  const reused: BridgingModuleOfferingRow[] = [];
  const skippedExisting: BridgingModuleOfferingRow[] = [];
  const programmeCodesToEnsure = new Set<string>();

  for (const parent of parents) {
    if (isBridgingModuleCode(parent.module_code)) {
      continue;
    }

    const existing = offeringByParentId.get(parent.id);
    if (existing) {
      if (existing.status === "inactive") {
        const { data, error } = await supabase
          .from("bridging_module_offerings")
          .update({
            status: "active",
            updated_by: params.createdBy ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select("*")
          .single();

        if (error) throw error;
        reused.push(data as BridgingModuleOfferingRow);
        programmeCodesToEnsure.add(existing.programme_code);
      } else {
        skippedExisting.push(existing);
      }
      continue;
    }

    const bridgingModuleCode = buildBridgingModuleCode(parent.module_code);
    const hourOverride = params.hoursByParentId?.[parent.id];
    const teachingHours =
      hourOverride?.module_teaching_contact_hours ??
      parent.module_teaching_contact_hours;
    const tutorialHours =
      hourOverride?.module_tutorial_contact_hours ??
      parent.module_tutorial_contact_hours;

    const { data: existingBridging, error: findError } = await supabase
      .from("modules")
      .select("*")
      .eq("module_code", bridgingModuleCode)
      .eq("programme_code", parent.programme_code)
      .eq("stream_code", normalizeStream(parent.stream_code))
      .maybeSingle();

    if (findError) throw findError;

    let bridgingModule = existingBridging as ModuleRow | null;

    if (!bridgingModule) {
      bridgingModule = await upsertModule({
        module_code: bridgingModuleCode,
        module_name: parent.module_name
          ? `${parent.module_name} (Bridging)`
          : `${bridgingModuleCode} Bridging`,
        module_year: parent.module_year,
        module_term: params.moduleTerm,
        programme_code: parent.programme_code,
        stream_code: parent.stream_code,
        uses_computer: parent.uses_computer,
        module_type: parent.module_type,
        module_teaching_contact_hours: teachingHours,
        module_tutorial_contact_hours: tutorialHours,
      });
    } else if (hourOverride) {
      bridgingModule = await upsertModule({
        id: bridgingModule.id,
        module_code: bridgingModule.module_code,
        module_name: bridgingModule.module_name,
        module_year: bridgingModule.module_year,
        module_term: params.moduleTerm,
        programme_code: bridgingModule.programme_code,
        stream_code: bridgingModule.stream_code,
        uses_computer: bridgingModule.uses_computer,
        module_type: bridgingModule.module_type,
        module_teaching_contact_hours: teachingHours,
        module_tutorial_contact_hours: tutorialHours,
      });
    } else if (bridgingModule.module_term !== params.moduleTerm) {
      // Keep catalogue term aligned with this activation so basic settings load filters work.
      bridgingModule = await upsertModule({
        id: bridgingModule.id,
        module_code: bridgingModule.module_code,
        module_name: bridgingModule.module_name,
        module_year: bridgingModule.module_year,
        module_term: params.moduleTerm,
        programme_code: bridgingModule.programme_code,
        stream_code: bridgingModule.stream_code,
        uses_computer: bridgingModule.uses_computer,
        module_type: bridgingModule.module_type,
        module_teaching_contact_hours:
          bridgingModule.module_teaching_contact_hours,
        module_tutorial_contact_hours:
          bridgingModule.module_tutorial_contact_hours,
      });
    }

    const { data: offering, error: offeringError } = await supabase
      .from("bridging_module_offerings")
      .insert({
        academic_year: academicYear,
        module_term: params.moduleTerm,
        parent_module_id: parent.id,
        bridging_module_id: bridgingModule.id,
        parent_module_code: parent.module_code.trim().toUpperCase(),
        bridging_module_code: bridgingModuleCode,
        programme_code: parent.programme_code,
        stream_code: normalizeStream(parent.stream_code),
        status: "active",
        created_by: params.createdBy ?? null,
        updated_by: params.createdBy ?? null,
      })
      .select("*")
      .single();

    if (offeringError) throw offeringError;

    created.push(offering as BridgingModuleOfferingRow);
    programmeCodesToEnsure.add(parent.programme_code);
  }

  for (const programmeCode of programmeCodesToEnsure) {
    await ensureTimetablePlanningModules({
      academicYear,
      programmeCode,
      createdBy: params.createdBy ?? "",
    });
  }

  return { created, reused, skippedExisting };
}

export async function updateBridgingModuleHours(params: {
  bridgingModuleId: string;
  module_teaching_contact_hours: number;
  module_tutorial_contact_hours: number;
  updatedBy?: string | null;
}) {
  const { data: existing, error: findError } = await supabase
    .from("modules")
    .select("*")
    .eq("id", params.bridgingModuleId)
    .single();

  if (findError) throw findError;

  const module = existing as ModuleRow;

  const updated = await upsertModule({
    id: module.id,
    module_code: module.module_code,
    module_name: module.module_name,
    module_year: module.module_year,
    module_term: module.module_term,
    programme_code: module.programme_code,
    stream_code: module.stream_code,
    uses_computer: module.uses_computer,
    module_type: module.module_type,
    module_teaching_contact_hours: params.module_teaching_contact_hours,
    module_tutorial_contact_hours: params.module_tutorial_contact_hours,
  });

  if (params.updatedBy) {
    await supabase
      .from("bridging_module_offerings")
      .update({
        updated_by: params.updatedBy,
        updated_at: new Date().toISOString(),
      })
      .eq("bridging_module_id", params.bridgingModuleId);
  }

  return updated;
}

/** Admin only: deactivate this term's bridging offering (does not delete catalogue). */
export async function deactivateBridgingModuleOffering(params: {
  offeringId: string;
  updatedBy?: string | null;
  isAdmin: boolean;
}) {
  if (!params.isAdmin) {
    throw new Error("Only admin can deactivate bridging modules for a term.");
  }

  const { data, error } = await supabase
    .from("bridging_module_offerings")
    .update({
      status: "inactive",
      updated_by: params.updatedBy ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.offeringId)
    .select("*")
    .single();

  if (error) throw error;

  return data as BridgingModuleOfferingRow;
}

export type BridgingOfferingListItem = {
  offering: BridgingModuleOfferingRow;
  bridgingModule: ModuleRow | null;
  parentModule: ModuleRow | null;
};

/**
 * Active bridging offerings for a Degree programme in the selected term.
 * Includes B modules whose HD parent is in the Degree's articulation sources.
 */
export async function listActiveBridgingOfferingsForDegreeProgramme(params: {
  academicYear: string;
  degreeProgrammeCode: string;
  moduleTerm: ModuleTerm;
}): Promise<BridgingOfferingListItem[]> {
  const degreeProgrammeCode = String(params.degreeProgrammeCode ?? "").trim();
  if (!degreeProgrammeCode) return [];

  const isDegree = await isDegreeProgrammeByCode(degreeProgrammeCode);
  if (!isDegree) return [];

  const [offerings, bridgingOptions] = await Promise.all([
    listBridgingModuleOfferings({
      academicYear: params.academicYear,
      moduleTerm: params.moduleTerm,
      status: "active",
    }),
    loadBridgingModuleOptionsForDegree({
      degreeProgrammeCode,
    }),
  ]);

  if (offerings.length === 0) return [];

  const parentIds = new Set(
    bridgingOptions
      .map((row) => String(row.sourceModuleId ?? "").trim())
      .filter(Boolean)
  );

  const parentCodes = new Set(
    bridgingOptions
      .map((row) => String(row.moduleCode ?? "").trim().toUpperCase())
      .filter(Boolean)
  );

  const matched = offerings.filter((row) => {
    if (parentIds.has(row.parent_module_id)) return true;
    return parentCodes.has(
      String(row.parent_module_code ?? "").trim().toUpperCase()
    );
  });

  if (matched.length === 0) return [];

  const moduleIds = Array.from(
    new Set(
      matched.flatMap((row) => [row.bridging_module_id, row.parent_module_id])
    )
  );

  const { data, error } = await supabase
    .from("modules")
    .select("*")
    .in("id", moduleIds);

  if (error) throw error;

  const byId = new Map(
    ((data ?? []) as ModuleRow[]).map((row) => [row.id, row])
  );

  return matched
    .map((offering) => ({
      offering,
      bridgingModule: byId.get(offering.bridging_module_id) ?? null,
      parentModule: byId.get(offering.parent_module_id) ?? null,
    }))
    .sort((a, b) =>
      a.offering.bridging_module_code.localeCompare(
        b.offering.bridging_module_code,
        undefined,
        { sensitivity: "base" }
      )
    );
}

/**
 * Bridging modules for a Degree programme this term, with default teacher
 * assignments (stored under the HD programme_code of each B module).
 */
export async function listDegreeTermBridgingModuleTeacherRows(params: {
  academicYear: string;
  degreeProgrammeCode: string;
  moduleTerm: ModuleTerm;
}): Promise<ProgrammeModuleTeacherRow[]> {
  const items = await listActiveBridgingOfferingsForDegreeProgramme(params);

  const modulesById = new Map<string, ModuleRow>();
  for (const item of items) {
    if (item.bridgingModule) {
      modulesById.set(item.bridgingModule.id, item.bridgingModule);
    }
  }

  const modules = Array.from(modulesById.values()).sort((a, b) => {
    const codeCmp = a.module_code.localeCompare(b.module_code, undefined, {
      sensitivity: "base",
    });
    if (codeCmp !== 0) return codeCmp;
    return normalizeStream(a.stream_code).localeCompare(
      normalizeStream(b.stream_code),
      undefined,
      { sensitivity: "base" }
    );
  });

  if (modules.length === 0) return [];

  const programmeCodes = Array.from(
    new Set(modules.map((module) => String(module.programme_code ?? "").trim()))
  ).filter(Boolean);

  const assignmentLists = await Promise.all(
    programmeCodes.map((programmeCode) =>
      listModuleDefaultAssignments({
        academicYear: params.academicYear,
        programmeCode,
      })
    )
  );

  const assignmentByKey = new Map(
    assignmentLists.flat().map((row) => [
      `${String(row.programme_code).trim().toUpperCase()}|${moduleDefaultAssignmentKey(row.module_code, row.stream_code)}`,
      row,
    ])
  );

  return modules.map((module) => {
    const key = `${String(module.programme_code).trim().toUpperCase()}|${moduleDefaultAssignmentKey(module.module_code, module.stream_code)}`;
    return {
      module,
      assignment: assignmentByKey.get(key) ?? null,
    };
  });
}
