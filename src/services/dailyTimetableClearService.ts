import { supabase } from "../lib/supabase";
import { fetchAllPaginatedRows } from "../lib/supabasePagination";
import { deleteAssignmentsForTimetableModule } from "./assignmentService";
import {
  deleteTimetableSessionsForInstanceCodes,
  deleteTimetableSessionsForModuleIds,
} from "./timetableScheduleService";
import { normalizeAcademicYear } from "../lib/utils";

export interface ClearClosedTimetableModuleResult {
  moduleInstanceCode: string;
  sessionsDeleted: boolean;
  assignmentsDeleted: boolean;
  enrollmentClearedCount: number;
  instanceDeleted: boolean;
  timetableModuleDeleted: boolean;
}

async function clearEnrollmentForInstanceCode(moduleInstanceCode: string) {
  const code = String(moduleInstanceCode ?? "").trim();
  if (!code) {
    return 0;
  }

  const rows = await fetchAllPaginatedRows<{ id: string }>({
    fetchPage: ({ from, to }) =>
      supabase
        .from("study_plan_modules")
        .select("id")
        .eq("enrolled_module_instance_code", code)
        .order("id", { ascending: true })
        .range(from, to),
  });

  if (rows.length === 0) {
    return 0;
  }

  const ids = rows.map((row) => row.id);
  const chunkSize = 100;
  let cleared = 0;

  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    const { error } = await supabase
      .from("study_plan_modules")
      .update({
        enrolled_module_instance_code: null,
        updated_at: new Date().toISOString(),
      })
      .in("id", chunk);

    if (error) throw error;
    cleared += chunk.length;
  }

  return cleared;
}

/**
 * Close one timetable instance that will not run:
 * - delete sessions (ok if already empty / weekly already removed)
 * - delete teaching assignments
 * - E1: clear enrolled_module_instance_code for this instance only
 * - delete timetable_module_instances row
 * - delete timetable_modules row
 */
export async function clearClosedTimetableModule(params: {
  timetableModuleId: string;
}): Promise<ClearClosedTimetableModuleResult> {
  const timetableModuleId = String(params.timetableModuleId ?? "").trim();

  if (!timetableModuleId) {
    throw new Error("Module is required.");
  }

  const { data: module, error: moduleError } = await supabase
    .from("timetable_modules")
    .select("id, academic_year, module_instance_code")
    .eq("id", timetableModuleId)
    .maybeSingle();

  if (moduleError) throw moduleError;

  if (!module) {
    throw new Error("Timetable module not found.");
  }

  const moduleInstanceCode = String(module.module_instance_code ?? "").trim();
  const academicYear = normalizeAcademicYear(String(module.academic_year ?? ""));

  if (!moduleInstanceCode) {
    throw new Error("Module instance code is missing.");
  }

  await deleteTimetableSessionsForModuleIds({
    timetableModuleIds: [timetableModuleId],
  });
  await deleteTimetableSessionsForInstanceCodes({
    moduleInstanceCodes: [moduleInstanceCode],
  });

  await deleteAssignmentsForTimetableModule(timetableModuleId);

  const enrollmentClearedCount =
    await clearEnrollmentForInstanceCode(moduleInstanceCode);

  const { error: instanceError } = await supabase
    .from("timetable_module_instances")
    .delete()
    .eq("academic_year", academicYear)
    .eq("module_instance_code", moduleInstanceCode);

  if (instanceError) throw instanceError;

  const { error: deleteModuleError } = await supabase
    .from("timetable_modules")
    .delete()
    .eq("id", timetableModuleId);

  if (deleteModuleError) throw deleteModuleError;

  return {
    moduleInstanceCode,
    sessionsDeleted: true,
    assignmentsDeleted: true,
    enrollmentClearedCount,
    instanceDeleted: true,
    timetableModuleDeleted: true,
  };
}
