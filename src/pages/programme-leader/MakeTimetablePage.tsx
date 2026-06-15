import { useEffect, useMemo, useRef, useState } from "react";

import { DataTable } from "../../components/tables/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  buildAssignmentDraftFromTeacher,
  buildLatestAssignmentByModuleId,
  confirmAssignments,
  hasValidTeacherAssignment,
  listAssignments,
  saveAssignmentDraft,
} from "../../services/assignmentService";
import {
  createManualCombineGroup,
  deleteManualCombineGroup,
  listManualCombineGroups,
  type ManualCombineGroupWithDetails,
} from "../../services/manualCombineService";
import { applyProgrammeIntraStreamAutoCombine } from "../../services/programmeIntraStreamCombineService";
import { listProgrammes } from "../../services/programmeService";
import {
  createCombinedTimetableModules,
  createNoSplitSingleModule,
  createSplitSingleModule,
  getPlanningModulesForCombineGroup,
  syncAssignmentTeachersForTimetableModules,
  undoTimetableDecisionsForSources,
  undoTimetableModuleDecision,
} from "../../services/splitClassService";
import {
  bulkUpsertStudentNumbers,
  getStudentNumberInputRows,
  validateStudentNumbersComplete,
  type StudentNumberInputRow,
} from "../../services/studentNumberService";
import {
  excludePlanningModules,
  restorePlanningModules,
} from "../../services/timetablePlanningOfferingService";
import { syncStudyPlanStudentNumbersToTimetable } from "../../services/timetableStudentNumberSyncService";
import {
  normalizeStream,
  offeredTermToStudyTerm,
  isTBC,
  timetableProgrammeStreamFromSelection,
} from "../../lib/utils";
import { listTeachers } from "../../services/teacherService";
import {
  ensureTimetablePlanningModules,
  listAllPlanningModulesWithStudentNumbers,
  listPlanningModulesWithStudentNumbers,
  listTimetableModules,
  listTimetableModulesBySourceIds,
  type PlanningModuleWithStudentNumber,
} from "../../services/timetableService";
import {
  ensureInstancesForTimetableModules,
  listTimetableModuleInstances,
  upsertTimetableModuleInstances,
  type TimetableModuleInstanceRow,
} from "../../services/timetableModuleInstanceService";
import type {
  CombineGroupRow,
  ModuleTerm,
  ProgrammeRow,
  TeacherRow,
  TeachingAssignmentRow,
  TeachingMode,
  TeachingStatus,
  TimetableModuleRow,
  TimetablePlanningModuleRow,
} from "../../types";

import { SplitAction } from "./make-timetable/components/SplitAction";
import { StepTabs } from "./make-timetable/components/StepTabs";
import { StudentNumberStep } from "./make-timetable/components/StudentNumberStep";
import { ScheduleStep } from "./make-timetable/components/ScheduleStep";
import { TeacherConfirmStep } from "./make-timetable/components/TeacherConfirmStep";
import { resolveCombinedDefaultTeacherForGroupDetails } from "../../lib/combinedDefaultTeacher";
import { dedupeJoinedModuleName } from "../../lib/moduleDisplay";
import {
  displayStream,
  normalizeCompareText,
  renderModuleCodeAndName,
  renderModuleInstanceAndName,
} from "./make-timetable/helpers";
import type { Step } from "./make-timetable/types";

const modeOptions: TeachingMode[] = ["Day", "Night", "Saturday"];
const teachingStatusOptions: TeachingStatus[] = ["FT", "PT"];
const moduleTermOptions: ModuleTerm[] = ["Sep", "Feb", "Jun"];

/** Prefer page-loaded defaults (already shown in Split UI) when splitting combined groups. */
function mergeRelatedPlanningModulesForCombineGroup(params: {
  details: Array<{ planning_module_id: string }>;
  planningModules: PlanningModuleWithStudentNumber[];
  fetched: TimetablePlanningModuleRow[];
}): TimetablePlanningModuleRow[] {
  const byId = new Map(params.fetched.map((module) => [module.id, module]));

  for (const detail of params.details) {
    const fromPage = params.planningModules.find(
      (module) => module.id === detail.planning_module_id
    );
    if (fromPage) {
      byId.set(fromPage.id, fromPage);
    }
  }

  return params.details
    .map((detail) => byId.get(detail.planning_module_id))
    .filter((module): module is TimetablePlanningModuleRow => Boolean(module));
}

function isSameStudentNumberRow(
  row: StudentNumberInputRow,
  module: {
    academic_year: string;
    module_code: string;
    programme_code: string;
    module_term?: string | null;
    stream_code?: string | null;
  },
  selectedStreamCode?: string
) {
  const programmeStream = timetableProgrammeStreamFromSelection(
    selectedStreamCode
  );
  const studyTerm = offeredTermToStudyTerm(
    module.academic_year,
    module.module_term ?? ""
  );

  return (
    row.academic_year === module.academic_year &&
    row.module_code === module.module_code &&
    row.programme_code === module.programme_code &&
    normalizeStream(row.programme_stream) === programmeStream &&
    row.study_term === studyTerm
  );
}

export function MakeTimetablePage() {
  const { user } = useAuth();
  const { academicYear, currentOfferedTerm } = useAcademicYear();
  const { t } = useLanguage();

  const [step, setStep] = useState<Step>("student_numbers");
  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [programmeCode, setProgrammeCode] = useState("");
  const [moduleTerm, setModuleTerm] = useState<ModuleTerm>(currentOfferedTerm);
  const prevAcademicYearRef = useRef(academicYear);

  const [planningModules, setPlanningModules] = useState<
    PlanningModuleWithStudentNumber[]
  >([]);

  const [studentRows, setStudentRows] = useState<StudentNumberInputRow[]>([]);
  const [excludedModules, setExcludedModules] = useState<
    PlanningModuleWithStudentNumber[]
  >([]);
  const [manualGroups, setManualGroups] = useState<
    ManualCombineGroupWithDetails[]
  >([]);

  const [manualCombineBaseModule, setManualCombineBaseModule] =
    useState<PlanningModuleWithStudentNumber | null>(null);

  const [manualCombineCandidates, setManualCombineCandidates] = useState<
    PlanningModuleWithStudentNumber[]
  >([]);

  const [selectedManualCandidateIds, setSelectedManualCandidateIds] = useState<
    string[]
  >([]);

  const [timetableModules, setTimetableModules] = useState<TimetableModuleRow[]>(
    []
  );
  const [sourceTimetableModules, setSourceTimetableModules] = useState<
    TimetableModuleRow[]
  >([]);
  const [timetableInstances, setTimetableInstances] = useState<
    TimetableModuleInstanceRow[]
  >([]);

  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [assignments, setAssignments] = useState<TeachingAssignmentRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [confirmingTeachers, setConfirmingTeachers] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [offeringBusy, setOfferingBusy] = useState(false);
  const [message, setMessage] = useState("");
  const programmeCodes = useMemo(
    () => [...new Set(programmes.map((p) => p.programme_code))],
    [programmes]
  );

  const scheduleInstances = useMemo(() => {
    const planningIdSet = new Set(planningModules.map((m) => m.id));
    const combineIdSet = new Set(manualGroups.map((g) => g.id));
    const instanceCodesOnPage = new Set(
      sourceTimetableModules.map((m) => m.module_instance_code)
    );

    return timetableInstances.filter((row) => {
      if (row.module_term !== moduleTerm) {
        return false;
      }

      if (instanceCodesOnPage.has(row.module_instance_code)) {
        return true;
      }
      if (
        row.source_planning_module_id &&
        planningIdSet.has(row.source_planning_module_id)
      ) {
        return true;
      }
      if (
        row.source_combine_group_id &&
        combineIdSet.has(row.source_combine_group_id)
      ) {
        return true;
      }
      return false;
    });
  }, [
    timetableInstances,
    planningModules,
    manualGroups,
    sourceTimetableModules,
    moduleTerm,
  ]);

  const teachersConfirmed = useMemo(() => {
    if (sourceTimetableModules.length === 0) {
      return false;
    }

    const latestByModule = buildLatestAssignmentByModuleId(assignments);

    return sourceTimetableModules.every((module) => {
      const assignment = latestByModule.get(module.id);
      return Boolean(assignment?.confirmed) && hasValidTeacherAssignment(assignment);
    });
  }, [sourceTimetableModules, assignments]);

  useEffect(() => {
    if (prevAcademicYearRef.current !== academicYear) {
      prevAcademicYearRef.current = academicYear;
      setModuleTerm(currentOfferedTerm);
      setStep("student_numbers");
    }
  }, [academicYear, currentOfferedTerm]);

  async function init() {
    const data = await listProgrammes();
    setProgrammes(data);
  }

  useEffect(() => {
    void init();
  }, []);

  async function refreshPlanning() {
    const data = await listPlanningModulesWithStudentNumbers({
      academicYear,
      programmeCode: programmeCode || undefined,
      moduleTerm,
      offeringStatus: "active",
    });

    setPlanningModules(data);
    return data;
  }

  async function refreshExcludedModules() {
    if (!programmeCode) {
      setExcludedModules([]);
      return [];
    }

    const data = await listPlanningModulesWithStudentNumbers({
      academicYear,
      programmeCode,
      moduleTerm,
      offeringStatus: "excluded",
    });

    setExcludedModules(data);
    return data;
  }

  async function refreshStudentRows(
    planning: PlanningModuleWithStudentNumber[] = planningModules
  ) {
    const data = await getStudentNumberInputRows({
      academicYear,
      planningModules: planning,
    });

    setStudentRows(data);
    return data;
  }

  async function loadStudentNumberRows() {
    const [planning] = await Promise.all([
      refreshPlanning(),
      refreshExcludedModules(),
    ]);
    const rows = await refreshStudentRows(planning);
    return { planning, rows };
  }

  async function handleExcludeFromOffering(row: StudentNumberInputRow) {
    if (!user?.id) {
      setMessage("Please login before updating the offering list.");
      return;
    }

    if (row.planning_module_ids.length === 0) {
      setMessage("No planning module linked to this row.");
      return;
    }

    const ok = window.confirm(t.excludeFromOfferingConfirm);

    if (!ok) return;

    setOfferingBusy(true);
    setMessage("");

    try {
      await excludePlanningModules({
        planningModuleIds: row.planning_module_ids,
        excludedBy: user.id,
      });

      await loadStudentNumberRows();
      setMessage(
        `Excluded ${row.module_code} from the ${academicYear} offering list.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not exclude module."
      );
    } finally {
      setOfferingBusy(false);
    }
  }

  async function handleRestoreToOffering(
    module: PlanningModuleWithStudentNumber
  ) {
    setOfferingBusy(true);
    setMessage("");

    try {
      await restorePlanningModules([module.id]);
      await loadStudentNumberRows();
      setMessage(`Restored ${module.module_code} to the offering list.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not restore module."
      );
    } finally {
      setOfferingBusy(false);
    }
  }

  async function refreshCombineGroups(filters?: { programmeCode?: string }) {
    const selectedProgrammeCode =
      filters?.programmeCode !== undefined
        ? filters.programmeCode
        : programmeCode;

    if (user?.id && selectedProgrammeCode) {
      try {
        await applyProgrammeIntraStreamAutoCombine({
          academicYear,
          programmeCode: selectedProgrammeCode,
          moduleTerm,
          createdBy: user.id,
        });
      } catch (error) {
        console.error(
          "[MakeTimetablePage] Programme intra-stream auto combine failed:",
          error
        );
      }
    }

    const manual = await listManualCombineGroups({
      academicYear,
      programmeCode: selectedProgrammeCode || undefined,
      moduleTerm,
    });

    setManualGroups(manual);
  }

  async function refreshSourceTimetableModules(
    groups: ManualCombineGroupWithDetails[] = manualGroups,
    planning: PlanningModuleWithStudentNumber[] = planningModules
  ): Promise<TimetableModuleRow[]> {
    const manuallyCombinedPlanningModuleIds = new Set(
      groups.flatMap((group) =>
        group.details.map((detail) => detail.planning_module_id)
      )
    );

    const pagePlanningIds = planning
      .filter(
        (module) =>
          !module.manual_combine_group_id &&
          !manuallyCombinedPlanningModuleIds.has(module.id)
      )
      .map((module) => module.id);

    const pageCombineGroupIds = groups.map((group) => group.id);

    if (pagePlanningIds.length === 0 && pageCombineGroupIds.length === 0) {
      setSourceTimetableModules([]);
      return [];
    }

    const modules = await listTimetableModulesBySourceIds({
      academicYear,
      planningModuleIds: pagePlanningIds,
      combineGroupIds: pageCombineGroupIds,
    });

    setSourceTimetableModules(modules);
    return modules;
  }

  async function refreshTimetableAndAssignments(filters?: {
    programmeCode?: string;
  }) {
    const selectedProgrammeCode =
      filters?.programmeCode !== undefined
        ? filters.programmeCode
        : programmeCode;

    let sourceModules: TimetableModuleRow[] = [];

    if (step === "split" || step === "teachers" || step === "schedule") {
      try {
        const [latestManual, latestPlanning] = await Promise.all([
          listManualCombineGroups({
            academicYear,
            programmeCode: selectedProgrammeCode || undefined,
            moduleTerm,
          }),
          listPlanningModulesWithStudentNumbers({
            academicYear,
            programmeCode: selectedProgrammeCode || undefined,
            moduleTerm,
          }),
        ]);

        sourceModules = await refreshSourceTimetableModules(
          latestManual,
          latestPlanning
        );
      } catch (error) {
        console.error(
          "[MakeTimetablePage] Refresh source timetable modules failed:",
          error
        );
        setSourceTimetableModules([]);
        sourceModules = [];
      }
    }

    const [modules, teacherRows, assignmentRows] = await Promise.all([
      listTimetableModules({
        academicYear,
        programmeCode: selectedProgrammeCode || undefined,
        moduleTerm,
      }),
      listTeachers(academicYear),
      listAssignments(academicYear),
    ]);

    const moduleIds = new Set(modules.map((module) => module.id));

    for (const module of sourceModules) {
      moduleIds.add(module.id);
    }

    const filteredAssignments = assignmentRows.filter((assignment) =>
      moduleIds.has(assignment.timetable_module_id)
    );

    setTimetableModules(modules);
    setTeachers(teacherRows);
    setAssignments(filteredAssignments);

    try {
      const instances = await listTimetableModuleInstances({
        academicYear,
      });
      setTimetableInstances(instances);
    } catch {
      // Instance table may not exist yet in local DB.
      setTimetableInstances([]);
    }
  }

  // Intentionally no "ensure all instances" here.
  // Instances should be created only for the module/group the user just split,
  // while "Confirm All Split Decisions" can do a full pass.

  async function handleSyncFromStudyPlan() {
    if (!user) {
      const text = "Please login before syncing student numbers.";
      setMessage(text);
      alert(text);
      return;
    }

    if (!user.id) {
      const text =
        "Login session is invalid. Please log out and log in again before syncing.";
      setMessage(text);
      alert(text);
      return;
    }

    if (!programmeCode) {
      const text = "Please select a programme before syncing from study plan.";
      setMessage(text);
      alert(text);
      return;
    }

    setSyncing(true);
    setMessage("Syncing student numbers from study plan...");

    try {
      const result = await syncStudyPlanStudentNumbersToTimetable({
        academicYear,
        programmeCode: programmeCode || undefined,
        moduleTerm,
        createdBy: user.id,
      });

      const { rows } = await loadStudentNumberRows();

      if (result.syncedCount === 0) {
        const text = `No planning modules found for ${programmeCode} (${moduleTerm}) in ${academicYear}. Check modules catalog and academic year settings.`;
        setMessage(text);
        alert(text);
        return;
      }

      const text = `Synced ${result.syncedCount} module row(s) from study plan (${result.zeroActualCount} with actual = 0). Loaded ${rows.length} row(s) in the table.`;
      setMessage(text);
    } catch (error) {
      console.error("[MakeTimetablePage] Sync student numbers failed:", error);
      const text =
        error instanceof Error ? error.message : "Sync failed unexpectedly.";
      setMessage(text);
      alert(`Sync failed:\n\n${text}`);
    } finally {
      setSyncing(false);
    }
  }

  function handleStepChange(next: Step) {
    if (!programmeCode && next !== "student_numbers") {
      setMessage(t.selectProgrammeRequired);
      setStep("student_numbers");
      return;
    }

    if (next === "schedule" && !teachersConfirmed) {
      setMessage(
        "Please confirm all teachers in step 4 before opening scheduling."
      );
      setStep("teachers");
      return;
    }

    setStep(next);
  }

  async function handleSaveStudentNumbers() {
    if (!user) {
      setMessage("Please login before saving student numbers.");
      return;
    }

    if (!programmeCode) {
      setMessage(t.selectProgrammeRequired);
      return;
    }

    setMessage("");

    const validation = validateStudentNumbersComplete(studentRows);

    if (!validation.valid) {
      setMessage(validation.message);
      return;
    }

    try {
      await bulkUpsertStudentNumbers({
        rows: studentRows,
        createdBy: user.id,
      });

      await loadStudentNumberRows();

      await refreshCombineGroups({
        programmeCode,
      });

      setStep("combine");
      setMessage("Student numbers saved.");
    } catch (error) {
      console.error("[MakeTimetablePage] Save student numbers failed:", error);
      setMessage(error instanceof Error ? error.message : "Save failed");
    }
  }

  function updateStudentRow(
    index: number,
    field: "expected_student_number" | "actual_student_number",
    value: string
  ) {
    setStudentRows((prev) =>
      prev.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]: value === "" ? null : Number(value),
            }
          : row
      )
    );
  }

  async function openManualCombineDialog(
    baseModule: PlanningModuleWithStudentNumber
  ) {
    const allModules = await listAllPlanningModulesWithStudentNumbers({
      academicYear,
    });

    const baseTerm = normalizeCompareText(baseModule.module_term);

    const manuallyCombinedPlanningModuleIds = new Set(
      manualGroups.flatMap((group) =>
        group.details.map((detail) => detail.planning_module_id)
      )
    );

    const candidates = allModules.filter((module) => {
      const moduleTerm = normalizeCompareText(module.module_term);

      if (module.id === baseModule.id) return false;
      if (moduleTerm !== baseTerm) return false;
      if (module.manual_combine_group_id) return false;
      if (manuallyCombinedPlanningModuleIds.has(module.id)) return false;

      return true;
    });

    setManualCombineBaseModule(baseModule);
    setManualCombineCandidates(candidates);
    setSelectedManualCandidateIds([]);
  }

  function toggleManualCandidate(id: string) {
    setSelectedManualCandidateIds((prev) =>
      prev.includes(id)
        ? prev.filter((item) => item !== id)
        : [...prev, id]
    );
  }

  async function handleConfirmManualCombineFromDialog() {
    if (!user || !manualCombineBaseModule) {
      setMessage("Please login before creating manual combine group.");
      return;
    }

    const selectedCandidates = manualCombineCandidates.filter((module) =>
      selectedManualCandidateIds.includes(module.id)
    );

    if (selectedCandidates.length === 0) {
      setMessage("Please select at least one module to combine with.");
      return;
    }

    try {
      await createManualCombineGroup({
        selectedModules: [manualCombineBaseModule, ...selectedCandidates],
        createdBy: user.id,
      });

      setManualCombineBaseModule(null);
      setManualCombineCandidates([]);
      setSelectedManualCandidateIds([]);

      await refreshPlanning();

      await refreshCombineGroups({
        programmeCode,
      });

      setMessage("Manual combine group created.");
    } catch (error) {
      console.error("[MakeTimetablePage] Manual combine failed:", error);
      setMessage(error instanceof Error ? error.message : "Manual combine failed");
    }
  }

  async function handleDeleteManualCombine(groupId: string) {
    try {
      await deleteManualCombineGroup(groupId);

      await refreshPlanning();

      await refreshCombineGroups({
        programmeCode,
      });

      setMessage("Manual combine undone. Modules can be combined again.");
    } catch (error) {
      console.error("[MakeTimetablePage] Undo manual combine failed:", error);
      setMessage(
        error instanceof Error ? error.message : "Undo manual combine failed"
      );
    }
  }

  async function handleUndoCombinedGroup(groupId: string) {
    if (!user) {
      setMessage("Please login before undo.");
      return;
    }

    // Safety: once a split/no-split decision exists, undo must be done in Split page.
    // Otherwise it can invalidate split results unexpectedly.
    try {
      const existing = await listTimetableModulesBySourceIds({
        academicYear,
        combineGroupIds: [groupId],
      });
      if (existing.length > 0) {
        setMessage(
          "This combined group has already been split/no-split decided. Please undo it in the Split page."
        );
        return;
      }
    } catch (error) {
      console.error("[MakeTimetablePage] Check combined undo status failed:", error);
      setMessage(
        error instanceof Error ? error.message : "Failed to check combined status."
      );
      return;
    }

    const confirmed = window.confirm(
      "Undo this combined group? If it was already split, this will also remove generated timetable modules, related draft assignments, and module instances."
    );
    if (!confirmed) return;

    setLoading(true);
    setMessage("Undoing combined group...");

    try {
      await deleteManualCombineGroup(groupId);

      await refreshPlanning();
      await refreshCombineGroups({ programmeCode });

      // In case user is already in Split/Schedule, keep UI consistent.
      if (step === "split" || step === "schedule") {
        await refreshTimetableAndAssignments({ programmeCode });
      }

      setMessage("Combined group undone.");
    } catch (error) {
      console.error("[MakeTimetablePage] Undo combined group failed:", error);
      setMessage(error instanceof Error ? error.message : "Undo failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleUndoAllCombinedGroupsOnPage() {
    if (!user) {
      setMessage("Please login before undo.");
      return;
    }

    if (manualGroups.length === 0) {
      setMessage("No manual combine groups to undo on this page.");
      return;
    }

    // Safety: do not allow undoing any groups that already have split decisions.
    // Those must be undone in Split page to avoid inconsistent state.
    try {
      const groupIds = manualGroups.map((g) => g.id);
      const decided = await listTimetableModulesBySourceIds({
        academicYear,
        combineGroupIds: groupIds,
      });
      const decidedGroupIds = new Set(
        decided
          .map((row) => row.combine_group_id)
          .filter((id): id is string => Boolean(id))
      );
      if (decidedGroupIds.size > 0) {
        setMessage(
          "Some combined groups on this page have already been split/no-split decided. Please undo them in the Split page first."
        );
        return;
      }
    } catch (error) {
      console.error("[MakeTimetablePage] Check combined undo-all status failed:", error);
      setMessage(
        error instanceof Error ? error.message : "Failed to check combined status."
      );
      return;
    }

    const confirmed = window.confirm(
      "Undo ALL combined groups on this page? If any were already split, this will also remove generated timetable modules, related draft assignments, and module instances."
    );
    if (!confirmed) return;

    setLoading(true);
    setMessage("Undoing all combined groups on this page...");

    try {
      const groupIds = manualGroups.map((g) => g.id);

      // Delete manual combine groups (sequential to keep error location clear).
      for (const id of groupIds) {
        await deleteManualCombineGroup(id);
      }

      await refreshPlanning();
      await refreshCombineGroups({ programmeCode });

      if (step === "split" || step === "schedule") {
        await refreshTimetableAndAssignments({ programmeCode });
      }

      setMessage("All combined groups on this page have been undone.");
    } catch (error) {
      console.error("[MakeTimetablePage] Undo all combined groups failed:", error);
      setMessage(error instanceof Error ? error.message : "Undo all failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmAllModulesCombined() {
    if (!user) {
      setMessage("Please login before confirming combine stage.");
      return;
    }

    setLoading(true);
    setMessage("Confirming combine stage...");

    try {
      const latestPlanningModules = await listPlanningModulesWithStudentNumbers({
        academicYear,
        programmeCode: programmeCode || undefined,
        moduleTerm,
      });

      const latestStudentRows = await getStudentNumberInputRows({
        academicYear,
        planningModules: latestPlanningModules,
      });

      const latestManualGroups = await listManualCombineGroups({
        academicYear,
        programmeCode: programmeCode || undefined,
        moduleTerm,
      });

      setPlanningModules(latestPlanningModules);
      setStudentRows(latestStudentRows);
      setManualGroups(latestManualGroups);

      await refreshTimetableAndAssignments({
        programmeCode,
      });

      setStep("split");

      setMessage(
        `Combine stage confirmed. ${latestPlanningModules.length} module(s) and ${latestManualGroups.length} combined group(s) are ready for split decisions.`
      );
    } catch (error) {
      console.error("[MakeTimetablePage] Confirm combine stage failed:", error);
      setMessage(
        error instanceof Error ? error.message : "Confirm combine stage failed"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleNoSplitSingle(module: TimetablePlanningModuleRow) {
    if (!user) {
      setMessage("Please login before confirming no split.");
      return;
    }

    setLoading(true);
    setMessage("Processing no split...");

    const student = studentRows.find((row) =>
      isSameStudentNumberRow(row, module)
    );

    try {
      const created = await createNoSplitSingleModule({
        planningModule: module,
        expectedStudentNumber: student?.expected_student_number ?? 0,
        actualStudentNumber: student?.actual_student_number ?? null,
        createdBy: user.id,
      });

      try {
        await ensureInstancesForTimetableModules({
          academicYear,
          programmeCode: programmeCode || undefined,
          timetableModules: [created],
          assignments: await listAssignments(academicYear),
          createdBy: user.id,
        });
      } catch (error) {
        console.error("[MakeTimetablePage] Ensure instances after no-split failed:", error);
        setMessage(
          "No-split confirmed, but instance table is not ready. Please run migration 014_timetable_module_instances.sql in Supabase, then refresh."
        );
      }

      await refreshPlanning();

      await refreshCombineGroups({
        programmeCode,
      });

      await refreshTimetableAndAssignments({
        programmeCode,
      });

      setMessage("No split confirmed. Default assignment has been created.");
    } catch (error) {
      console.error("[MakeTimetablePage] No split failed:", error);
      setMessage(error instanceof Error ? error.message : "No split failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSplitSingle(
    module: TimetablePlanningModuleRow,
    numberOfClasses: number
  ) {
    if (!user) {
      setMessage("Please login before confirming split.");
      return;
    }

    if (!Number.isFinite(numberOfClasses) || numberOfClasses < 2) {
      setMessage("Please enter a valid number of classes.");
      return;
    }

    setLoading(true);
    setMessage("Processing split...");

    const student = studentRows.find((row) =>
      isSameStudentNumberRow(row, module)
    );

    try {
      const created = await createSplitSingleModule({
        planningModule: module,
        expectedStudentNumber: student?.expected_student_number ?? 0,
        actualStudentNumber: student?.actual_student_number ?? null,
        numberOfClasses,
        createdBy: user.id,
      });

      try {
        await ensureInstancesForTimetableModules({
          academicYear,
          programmeCode: programmeCode || undefined,
          timetableModules: created,
          assignments: await listAssignments(academicYear),
          createdBy: user.id,
        });
      } catch (error) {
        console.error("[MakeTimetablePage] Ensure instances after split failed:", error);
        setMessage(
          "Split confirmed, but instance table is not ready. Please run migration 014_timetable_module_instances.sql in Supabase, then refresh."
        );
      }

      await refreshPlanning();

      await refreshCombineGroups({
        programmeCode,
      });

      await refreshTimetableAndAssignments({
        programmeCode,
      });

      setMessage("Split confirmed. Default assignments have been created.");
    } catch (error) {
      console.error("[MakeTimetablePage] Split failed:", error);
      setMessage(error instanceof Error ? error.message : "Split failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCombinedSplit(
    group: CombineGroupRow,
    numberOfClasses: number
  ) {
    if (!user) {
      setMessage("Please login before confirming combined split.");
      return;
    }

    if (!Number.isFinite(numberOfClasses) || numberOfClasses < 1) {
      setMessage("Please enter a valid number of classes.");
      return;
    }

    setLoading(true);
    setMessage("Processing combined split...");

    try {
      const fetched = await getPlanningModulesForCombineGroup(group.id);
      const groupWithDetails = manualGroups.find((item) => item.id === group.id);

      const allPlanningWithDefaults =
        await listAllPlanningModulesWithStudentNumbers({
          academicYear,
        });

      const related = groupWithDetails
        ? mergeRelatedPlanningModulesForCombineGroup({
            details: groupWithDetails.details,
            planningModules: allPlanningWithDefaults,
            fetched,
          })
        : fetched;

      const preferredDefaultTeacher = groupWithDetails
        ? resolveCombinedDefaultTeacherForGroupDetails(
            groupWithDetails.details,
            allPlanningWithDefaults
          )
        : undefined;

      const created = await createCombinedTimetableModules({
        combineGroup: group,
        relatedPlanningModules: related,
        numberOfClasses,
        createdBy: user.id,
        preferredDefaultTeacher,
      });

      try {
        await syncAssignmentTeachersForTimetableModules({
          academicYear,
          timetableModules: created,
          updatedBy: user.id,
        });

        await ensureInstancesForTimetableModules({
          academicYear,
          programmeCode: programmeCode || undefined,
          timetableModules: created,
          assignments: await listAssignments(academicYear),
          createdBy: user.id,
        });
      } catch (error) {
        console.error(
          "[MakeTimetablePage] Ensure instances after combined split failed:",
          error
        );
        setMessage(
          "Combined split confirmed, but instance table is not ready. Please run migration 014_timetable_module_instances.sql in Supabase, then refresh."
        );
      }

      await refreshPlanning();

      await refreshCombineGroups({
        programmeCode,
      });

      await refreshTimetableAndAssignments({
        programmeCode,
      });

      setMessage(
        "Combined split decision confirmed. Default assignments have been created."
      );
    } catch (error) {
      console.error("[MakeTimetablePage] Combined split failed:", error);
      setMessage(error instanceof Error ? error.message : "Combined split failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmAllSplitDecisions() {
    if (!user) {
      setMessage("Please login before confirming split decisions.");
      return;
    }

    setLoading(true);
    setMessage("Confirming split decisions on this page...");

    try {
      const latestPlanningModules = await listPlanningModulesWithStudentNumbers({
        academicYear,
        programmeCode: programmeCode || undefined,
        moduleTerm,
      });

      const latestManualGroups = await listManualCombineGroups({
        academicYear,
        programmeCode: programmeCode || undefined,
        moduleTerm,
      });

      const latestStudentRows = await getStudentNumberInputRows({
        academicYear,
        planningModules: latestPlanningModules,
      });

      const manuallyCombinedPlanningModuleIds = new Set(
        latestManualGroups.flatMap((group) =>
          group.details.map((detail) => detail.planning_module_id)
        )
      );

      const pagePlanningIds = latestPlanningModules
        .filter(
          (module) =>
            !module.manual_combine_group_id &&
            !manuallyCombinedPlanningModuleIds.has(module.id)
        )
        .map((module) => module.id);

      const pageCombineGroupIds = latestManualGroups.map((group) => group.id);

      const sourceTimetableModules = await listTimetableModulesBySourceIds({
        academicYear,
        planningModuleIds: pagePlanningIds,
        combineGroupIds: pageCombineGroupIds,
      });

      const decidedCombineGroupIds = new Set(
        sourceTimetableModules
          .map((module) => module.combine_group_id)
          .filter((id): id is string => Boolean(id))
      );

      const decidedPlanningModuleIds = new Set(
        sourceTimetableModules
          .map((module) => module.planning_module_id)
          .filter((id): id is string => Boolean(id))
      );

      const pendingCombinedGroups = latestManualGroups.filter(
        (group) => !decidedCombineGroupIds.has(group.id)
      );

      const pendingSingleModules = latestPlanningModules.filter(
        (module) =>
          !module.manual_combine_group_id &&
          !manuallyCombinedPlanningModuleIds.has(module.id) &&
          !decidedPlanningModuleIds.has(module.id)
      );

      const createdModules: TimetableModuleRow[] = [];

      const allPlanningWithDefaults =
        await listAllPlanningModulesWithStudentNumbers({
          academicYear,
        });

      for (const group of pendingCombinedGroups) {
        const fetched = await getPlanningModulesForCombineGroup(group.id);
        const groupWithDetails = latestManualGroups.find((item) => item.id === group.id);
        const related = groupWithDetails
          ? mergeRelatedPlanningModulesForCombineGroup({
              details: groupWithDetails.details,
              planningModules: allPlanningWithDefaults,
              fetched,
            })
          : fetched;

        const preferredDefaultTeacher = groupWithDetails
          ? resolveCombinedDefaultTeacherForGroupDetails(
              groupWithDetails.details,
              allPlanningWithDefaults
            )
          : undefined;

        const created = await createCombinedTimetableModules({
          combineGroup: group,
          relatedPlanningModules: related,
          numberOfClasses: 1,
          createdBy: user.id,
          preferredDefaultTeacher,
        });

        createdModules.push(...created);
      }

      for (const module of pendingSingleModules) {
        const student = latestStudentRows.find((row) =>
          isSameStudentNumberRow(row, module)
        );

        const planningModule =
          allPlanningWithDefaults.find((row) => row.id === module.id) ?? module;

        const created = await createNoSplitSingleModule({
          planningModule,
          expectedStudentNumber: student?.expected_student_number ?? 0,
          actualStudentNumber: student?.actual_student_number ?? null,
          createdBy: user.id,
        });

        createdModules.push(created);
      }

      // Sync instances for every module on this page that already has timetable_modules
      // (including ones split earlier + ones just auto no-split), not only this batch.
      const allSourceModules = await listTimetableModulesBySourceIds({
        academicYear,
        planningModuleIds: pagePlanningIds,
        combineGroupIds: pageCombineGroupIds,
      });

      if (allSourceModules.length > 0) {
        // Backfill TBC assignments from upload defaults before syncing instances.
        await syncAssignmentTeachersForTimetableModules({
          academicYear,
          timetableModules: allSourceModules,
          updatedBy: user.id,
        });

        const assignmentRows = await listAssignments(academicYear);

        await ensureInstancesForTimetableModules({
          academicYear,
          programmeCode: programmeCode || undefined,
          timetableModules: allSourceModules,
          assignments: assignmentRows,
          createdBy: user.id,
        });
        setSourceTimetableModules(allSourceModules);
        const instances = await listTimetableModuleInstances({ academicYear });
        setTimetableInstances(instances);
      }

      await refreshPlanning();

      await refreshCombineGroups({
        programmeCode,
      });

      await refreshTimetableAndAssignments({
        programmeCode,
      });

      const scopeLabel = programmeCode ? programmeCode : "current page";

      setMessage(
        `Split decisions confirmed for ${scopeLabel}. ` +
          `${pendingSingleModules.length} single module(s) and ${pendingCombinedGroups.length} combined group(s) were marked as No Split. ` +
          `${allSourceModules.length} module instance row(s) are ready for teacher confirmation.`
      );

      setStep("teachers");
    } catch (error) {
      console.error("[MakeTimetablePage] Confirm all split decisions failed:", error);
      setMessage(
        error instanceof Error
          ? error.message
          : "Confirm all split decisions failed"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleUndoTimetableModule(row: TimetableModuleRow) {
    if (!user) {
      setMessage("Please login before undo.");
      return;
    }

    const confirmed = window.confirm(
      "Undo this split/no-split decision? This will remove generated timetable modules and related draft assignments."
    );

    if (!confirmed) return;

    setLoading(true);
    setMessage("Undoing split decision...");

    try {
      await undoTimetableModuleDecision({
        timetableModule: row,
      });

      await refreshPlanning();

      await refreshCombineGroups({
        programmeCode,
      });

      await refreshTimetableAndAssignments({
        programmeCode,
      });

      setMessage("Split/no-split decision undone.");
    } catch (error) {
      console.error("[MakeTimetablePage] Undo split decision failed:", error);
      setMessage(error instanceof Error ? error.message : "Undo failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleUndoAllSplitDecisionsOnPage() {
    if (!user) {
      setMessage("Please login before undo.");
      return;
    }

    const confirmed = window.confirm(
      "Undo ALL split/no-split decisions on this page? This will remove generated timetable modules, related draft assignments, and module instances."
    );
    if (!confirmed) return;

    setLoading(true);
    setMessage("Undoing all split decisions on this page...");

    try {
      const planningIdSet = new Set(planningModules.map((m) => m.id));
      const combineIdSet = new Set(manualGroups.map((g) => g.id));

      // Derive source ids from existing modules/instances on this page.
      const planningIds = Array.from(
        new Set(
          sourceTimetableModules
            .map((m) => m.planning_module_id)
            .filter((id): id is string => Boolean(id))
            .filter((id) => planningIdSet.has(id))
        )
      );
      const combineIds = Array.from(
        new Set(
          [
            ...sourceTimetableModules
              .map((m) => m.combine_group_id)
              .filter((id): id is string => Boolean(id)),
            ...timetableInstances
              .filter((row) => row.source_type === "combine_group")
              .map((row) => row.source_combine_group_id)
              .filter((id): id is string => Boolean(id)),
          ].filter((id) => combineIdSet.has(id))
        )
      );

      await undoTimetableDecisionsForSources({
        academicYear,
        planningModuleIds: planningIds,
        combineGroupIds: combineIds,
      });

      await refreshPlanning();
      await refreshCombineGroups({ programmeCode });
      await refreshTimetableAndAssignments({ programmeCode });

      setMessage("All split/no-split decisions on this page have been undone.");
    } catch (error) {
      console.error("[MakeTimetablePage] Undo all split decisions failed:", error);
      setMessage(error instanceof Error ? error.message : "Undo all failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveAssignment(params: {
    timetableModule: TimetableModuleRow;
    teacherId: string;
    mode: TeachingMode;
    teachingStatus: TeachingStatus;
  }) {
    if (!user) {
      setMessage("Please login before saving assignment.");
      return;
    }

    const teacher =
      params.teacherId === "TBC"
        ? null
        : teachers.find((item) => item.id === params.teacherId);

    try {
      const draft = buildAssignmentDraftFromTeacher({
        timetableModule: params.timetableModule,
        teacher,
        useTBC: params.teacherId === "TBC",
        teachingStatus: params.teachingStatus,
        mode: params.mode,
        programmeType: null,
      });

      await saveAssignmentDraft({
        timetableModule: params.timetableModule,
        draft,
        updatedBy: user.id,
      });

      await refreshTimetableAndAssignments({
        programmeCode,
      });

      setMessage("Assignment saved.");
    } catch (error) {
      console.error("[MakeTimetablePage] Assignment save failed:", error);
      setMessage(error instanceof Error ? error.message : "Assignment failed");
    }
  }

  async function handleConfirmAllTeachers(
    rows: Array<{
      instance: TimetableModuleInstanceRow;
      teacherName: string;
      teachingStatus: TeachingStatus;
    }>
  ) {
    if (!user) {
      setMessage("Please login before confirming teachers.");
      return;
    }

    const tbcRows = rows.filter((row) => isTBC(row.teacherName));
    if (tbcRows.length > 0) {
      setMessage(
        `Please assign a teacher for all instances (${tbcRows.length} still TBC).`
      );
      return;
    }

    setConfirmingTeachers(true);
    setMessage("Saving teachers and confirming assignments...");

    try {
      await upsertTimetableModuleInstances(
        rows.map((row) => ({
          id: row.instance.id,
          instance_teacher_name: row.teacherName,
        }))
      );

      for (const row of rows) {
        const timetableModule = sourceTimetableModules.find(
          (module) =>
            module.module_instance_code === row.instance.module_instance_code
        );

        if (!timetableModule) {
          continue;
        }

        const teacher = teachers.find(
          (item) => item.teacher_name === row.teacherName
        );

        const mode = (row.instance.instance_mode ||
          timetableModule.mode ||
          "Night") as TeachingMode;

        const draft = buildAssignmentDraftFromTeacher({
          timetableModule,
          teacher: teacher ?? null,
          useTBC: false,
          teachingStatus: row.teachingStatus,
          mode,
          programmeType: null,
        });

        await saveAssignmentDraft({
          timetableModule,
          draft,
          updatedBy: user.id,
        });
      }

      const pageTimetableModuleIds = sourceTimetableModules.map((module) => module.id);

      const result = await confirmAssignments({
        academicYear,
        confirmedBy: user.id,
        timetableModuleIds: pageTimetableModuleIds,
      });

      await refreshTimetableAndAssignments({
        programmeCode,
      });

      setStep("schedule");
      setMessage(
        `All teachers confirmed (version ${result.confirmedVersion}). Continue to scheduling.`
      );
    } catch (error) {
      console.error("[MakeTimetablePage] Confirm all teachers failed:", error);
      setMessage(
        error instanceof Error ? error.message : "Confirm all teachers failed"
      );
    } finally {
      setConfirmingTeachers(false);
    }
  }

  async function handleConfirmAssignments() {
    if (!user) {
      setMessage("Please login before confirming assignment.");
      return;
    }

    setLoading(true);
    setMessage("Confirming assignments...");

    try {
      const result = await confirmAssignments({
        academicYear,
        confirmedBy: user.id,
      });

      await refreshTimetableAndAssignments({
        programmeCode,
      });

      setMessage(
        `Assignment confirmed. Version ${result.confirmedVersion}. Teacher Loading will be generated by Admin after all programmes are confirmed.`
      );
    } catch (error) {
      console.error("[MakeTimetablePage] Confirm assignments failed:", error);
      setMessage(error instanceof Error ? error.message : "Confirm failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let requestId = 0;

    async function refreshFilteredData() {
      if (!user) {
        setPlanningModules([]);
        setStudentRows([]);
        setExcludedModules([]);
        setLoading(false);
        return;
      }

      if (!programmeCode) {
        setPlanningModules([]);
        setStudentRows([]);
        setExcludedModules([]);
        setLoading(false);
        return;
      }

      const currentRequest = ++requestId;

      try {
        setLoading(true);

        await ensureTimetablePlanningModules({
          academicYear,
          programmeCode,
          moduleTerm,
          createdBy: user.id,
        });

        if (currentRequest !== requestId) return;

        const data = await listPlanningModulesWithStudentNumbers({
          academicYear,
          programmeCode,
          moduleTerm,
        });

        if (currentRequest !== requestId) return;

        setPlanningModules(data);

        const studentData = await getStudentNumberInputRows({
          academicYear,
          planningModules: data,
        });

        if (currentRequest !== requestId) return;

        setStudentRows(studentData);

        if (step === "combine" || step === "split") {
          await refreshCombineGroups({
            programmeCode,
          });
        }

        if (currentRequest !== requestId) return;

        if (step === "split" || step === "teachers" || step === "schedule") {
          await refreshTimetableAndAssignments({
            programmeCode,
          });
        }
      } catch (error) {
        if (currentRequest === requestId) {
          console.error("[MakeTimetablePage] Refresh filtered data failed:", error);
          const text =
            error instanceof Error ? error.message : "Failed to load timetable data.";
          setMessage(text);
        }
      } finally {
        if (currentRequest === requestId) {
          setLoading(false);
        }
      }
    }

    void refreshFilteredData();

    return () => {
      requestId += 1;
    };
  }, [academicYear, programmeCode, moduleTerm, user]);

  useEffect(() => {
    if (!programmeCode && step !== "student_numbers") {
      setStep("student_numbers");
      setMessage(t.selectProgrammeRequired);
    }
  }, [programmeCode, step, t.selectProgrammeRequired]);

  useEffect(() => {
    if (!user || !programmeCode) return;

    if (step === "combine" || step === "split") {
      void refreshCombineGroups({
        programmeCode,
      });
    }

    if (step === "split" || step === "teachers" || step === "schedule") {
      void refreshTimetableAndAssignments({
        programmeCode,
      });
    }
  }, [step, user, programmeCode, moduleTerm, academicYear]);

  useEffect(() => {
    if (!user || (step !== "split" && step !== "teachers" && step !== "schedule")) return;

    void refreshSourceTimetableModules().catch((error) => {
      console.error("[MakeTimetablePage] Load source timetable modules failed:", error);
      setSourceTimetableModules([]);
    });
  }, [step, user, academicYear, planningModules, manualGroups]);

  // If user opens Schedule before Confirm All (or ensure failed), backfill instances
  // for any timetable_modules already on this page.
  useEffect(() => {
    if (!user?.id || step !== "schedule") return;
    if (sourceTimetableModules.length === 0) return;

    let cancelled = false;

    void (async () => {
      const existingCodes = new Set(
        timetableInstances.map((row) => row.module_instance_code)
      );
      const missingModules = sourceTimetableModules.filter(
        (module) =>
          module.module_instance_code &&
          !existingCodes.has(module.module_instance_code)
      );

      if (missingModules.length === 0) return;

      try {
        const assignmentRows = await listAssignments(academicYear);
        await ensureInstancesForTimetableModules({
          academicYear,
          programmeCode: programmeCode || undefined,
          timetableModules: missingModules,
          assignments: assignmentRows,
          createdBy: user.id,
        });
        if (cancelled) return;
        await refreshTimetableAndAssignments({
          programmeCode,
        });
      } catch (error) {
        console.error(
          "[MakeTimetablePage] Sync missing schedule instances failed:",
          error
        );
        setMessage(
          error instanceof Error
            ? error.message
            : "Some module instances could not be created for scheduling."
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    step,
    user?.id,
    academicYear,
    programmeCode,
    sourceTimetableModules,
    timetableInstances,
  ]);

  return (
    <div className="page-container">
      <PageHeader
        title={t.makeTimetable}
        description="Workflow: sync student numbers → combine → split → confirm teachers → schedule."
      />

      {message && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {message}
        </div>
      )}

      <div className="card mb-4">
        <div className="card-body grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="form-label">{t.academicYear}</label>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              {academicYear}
            </div>
          </div>

          <div>
            <label className="form-label">{t.moduleTerm}</label>
            <select
              className="form-select"
              value={moduleTerm}
              title={t.moduleTerm}
              onChange={(event) => {
                setModuleTerm(event.target.value as ModuleTerm);
                setStep("student_numbers");
                setMessage("");
              }}
            >
              {moduleTermOptions.map((term) => (
                <option key={term} value={term}>
                  {term}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">{t.programmeCode}</label>
            <select
              className="form-select"
              value={programmeCode}
              title="Programme"
              required
              onChange={(event) => {
                setProgrammeCode(event.target.value);
                setStep("student_numbers");
                setMessage("");
              }}
            >
              <option value="">{t.selectProgrammePlaceholder}</option>
              {programmeCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Steps 1–5 are scoped to the selected programme and module term.
              Academic year is set by Admin.
            </div>
          </div>
        </div>
      </div>

      {!programmeCode && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t.selectProgrammeRequired}
        </div>
      )}

      <StepTabs
        step={step}
        programmeSelected={Boolean(programmeCode)}
        teachersConfirmed={teachersConfirmed}
        onStepChange={handleStepChange}
      />

      {loading && step !== "student_numbers" ? (
        <LoadingState />
      ) : (
        <>
          {step === "student_numbers" && (
            <>
              {loading && (
                <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Loading planning modules...
                </div>
              )}
              <StudentNumberStep
                rows={studentRows}
                excludedModules={excludedModules}
                updateRow={updateStudentRow}
                onSync={handleSyncFromStudyPlan}
                onSave={handleSaveStudentNumbers}
                onExclude={(row) => void handleExcludeFromOffering(row)}
                onRestoreExcluded={(row) => void handleRestoreToOffering(row)}
                syncDisabled={!programmeCode || loading}
                syncing={syncing}
                offeringBusy={offeringBusy}
                programmeSelected={Boolean(programmeCode)}
              />
            </>
          )}

          {step === "combine" && programmeCode && (
            <CombineStep
              planningModules={planningModules}
              manualGroups={manualGroups}
              openManualCombineDialog={openManualCombineDialog}
              onDeleteManualCombine={handleDeleteManualCombine}
              onUndoCombinedGroup={handleUndoCombinedGroup}
              onUndoAllCombinedGroupsOnPage={handleUndoAllCombinedGroupsOnPage}
              onConfirmAllModulesCombined={handleConfirmAllModulesCombined}
            />
          )}

          {step === "split" && programmeCode && (
            <SplitStep
              planningModules={planningModules}
              studentRows={studentRows}
              manualGroups={manualGroups}
              timetableModules={timetableModules}
              sourceTimetableModules={sourceTimetableModules}
              timetableInstances={timetableInstances}
              assignments={assignments}
              programmeCode={programmeCode}
              onNoSplitSingle={handleNoSplitSingle}
              onSplitSingle={handleSplitSingle}
              onCombinedSplit={handleCreateCombinedSplit}
              onUndoTimetableModule={handleUndoTimetableModule}
              onUndoAllSplitDecisionsOnPage={handleUndoAllSplitDecisionsOnPage}
              onConfirmAllSplitDecisions={handleConfirmAllSplitDecisions}
              onSaveInstanceEdits={async (rows) => {
                await upsertTimetableModuleInstances(rows);
                await refreshTimetableAndAssignments({
                  programmeCode,
                });
              }}
            />
          )}

          {step === "teachers" && programmeCode && (
            <TeacherConfirmStep
              instances={scheduleInstances}
              sourceTimetableModules={sourceTimetableModules}
              assignments={assignments}
              teachers={teachers}
              programmeCode={programmeCode || undefined}
              confirming={confirmingTeachers}
              onConfirmAllTeachers={handleConfirmAllTeachers}
            />
          )}

          {step === "schedule" && programmeCode && (
            <ScheduleStep
              academicYear={academicYear}
              moduleTerm={moduleTerm}
              timetableInstances={scheduleInstances}
              programmeCode={programmeCode || undefined}
              sourceTimetableModuleCount={sourceTimetableModules.length}
            />
          )}
        </>
      )}

      {manualCombineBaseModule && (
        <ManualCombineDialog
          baseModule={manualCombineBaseModule}
          candidates={manualCombineCandidates}
          selectedCandidateIds={selectedManualCandidateIds}
          toggleCandidate={toggleManualCandidate}
          onConfirm={handleConfirmManualCombineFromDialog}
          onClose={() => {
            setManualCombineBaseModule(null);
            setManualCombineCandidates([]);
            setSelectedManualCandidateIds([]);
          }}
        />
      )}
    </div>
  );
}

function CombineStep({
  planningModules,
  manualGroups,
  openManualCombineDialog,
  onDeleteManualCombine,
  onUndoCombinedGroup,
  onUndoAllCombinedGroupsOnPage,
  onConfirmAllModulesCombined,
}: {
  planningModules: PlanningModuleWithStudentNumber[];
  manualGroups: ManualCombineGroupWithDetails[];
  openManualCombineDialog: (module: PlanningModuleWithStudentNumber) => void;
  onDeleteManualCombine: (groupId: string) => void;
  onUndoCombinedGroup: (groupId: string) => void;
  onUndoAllCombinedGroupsOnPage: () => void;
  onConfirmAllModulesCombined: () => void;
}) {
  const [selectedManualGroup, setSelectedManualGroup] =
    useState<ManualCombineGroupWithDetails | null>(null);

  const manuallyCombinedPlanningModuleIds = new Set(
    manualGroups.flatMap((group) =>
      group.details.map((detail) => detail.planning_module_id)
    )
  );

  const manualEligibleModules = planningModules.filter(
    (module) =>
      !module.manual_combine_group_id &&
      !manuallyCombinedPlanningModuleIds.has(module.id)
  );

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="font-medium text-blue-900">
              Confirm combine stage
            </div>

            <div className="text-sm text-blue-700">
              Same programme, same module code across different streams are
              combined automatically (combined code = module code). Use manual
              combine only for cross-programme or different module codes. When
              ready, continue to Split.
            </div>

            <div className="mt-1 text-xs text-blue-600">
              Combined groups: {manualGroups.length}. Manual-only eligible:{" "}
              {manualEligibleModules.length}.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onUndoAllCombinedGroupsOnPage}
              disabled={manualGroups.length === 0}
              title={
                manualGroups.length === 0
                  ? "No manual combine groups to undo."
                  : "Undo all manual combine groups on this page."
              }
            >
              Undo All Combined Groups (this page)
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onConfirmAllModulesCombined}
            >
              Confirm All Modules Are Combined
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-header font-semibold">
            Manual Combine Eligible Modules
          </div>

          <div className="card-body">
            {manualEligibleModules.length === 0 ? (
              <EmptyState message="No manual combine eligible modules. Already manually-combined modules cannot be selected again." />
            ) : (
              <DataTable
                rows={manualEligibleModules}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: "module",
                    header: "Module",
                    render: (row) => renderModuleCodeAndName(row),
                  },
                  {
                    key: "programme",
                    header: "Programme",
                    render: (row) => row.programme_code,
                  },
                  {
                    key: "stream",
                    header: "Stream",
                    render: (row) => displayStream(row.stream_code),
                  },
                  {
                    key: "term",
                    header: "Term",
                    render: (row) => row.module_term,
                  },
                  {
                    key: "expected",
                    header: "Expected",
                    render: (row) => row.expected_student_number ?? "-",
                  },
                  {
                    key: "actual",
                    header: "Actual",
                    render: (row) => row.actual_student_number ?? "-",
                  },
                  {
                    key: "action",
                    header: "Action",
                    render: (row) => (
                      <button
                        type="button"
                        className="btn btn-primary py-1 text-xs"
                        onClick={() => openManualCombineDialog(row)}
                      >
                        Combine
                      </button>
                    ),
                  },
                ]}
              />
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header font-semibold">Manual Combine Groups</div>

          <div className="card-body">
            {manualGroups.length === 0 ? (
              <EmptyState message="No manual combine groups related to the selected programme / stream." />
            ) : (
              <DataTable
                rows={manualGroups}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: "code",
                    header: "Combined Code",
                    render: (row) => (
                      <button
                        type="button"
                        className="font-medium text-blue-600 underline-offset-2 hover:underline"
                        onClick={() => setSelectedManualGroup(row)}
                      >
                        {row.combined_code}
                      </button>
                    ),
                  },
                  {
                    key: "term",
                    header: "Term",
                    render: (row) => row.module_term,
                  },
                  {
                    key: "expected",
                    header: "Expected",
                    render: (row) => row.total_expected_student_number ?? 0,
                  },
                  {
                    key: "actual",
                    header: "Actual",
                    render: (row) => row.total_actual_student_number ?? "-",
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (row) => <StatusBadge status={row.status} />,
                  },
                  {
                    key: "undo",
                    header: "Undo",
                    render: (row) => (
                      <button
                        type="button"
                        className="btn btn-secondary py-1 text-xs"
                        onClick={() => onUndoCombinedGroup(row.id)}
                      >
                        Undo
                      </button>
                    ),
                  },
                ]}
              />
            )}
          </div>
        </div>
      </div>

      {selectedManualGroup && (
        <ManualCombineDetailsDialog
          group={selectedManualGroup}
          onClose={() => setSelectedManualGroup(null)}
          onDelete={() => {
            const groupId = selectedManualGroup.id;
            setSelectedManualGroup(null);
            onDeleteManualCombine(groupId);
          }}
        />
      )}
    </>
  );
}

function ManualCombineDialog({
  baseModule,
  candidates,
  selectedCandidateIds,
  toggleCandidate,
  onConfirm,
  onClose,
}: {
  baseModule: PlanningModuleWithStudentNumber;
  candidates: PlanningModuleWithStudentNumber[];
  selectedCandidateIds: string[];
  toggleCandidate: (id: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const hasSelection = selectedCandidateIds.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-slate-900">
              Create Manual Combine
            </div>

            <div className="mt-1 text-sm text-slate-500">
              Base module:{" "}
              <span className="font-medium text-slate-700">
                {baseModule.programme_code} /{" "}
                {displayStream(baseModule.stream_code)} /{" "}
                {baseModule.module_code} / {baseModule.module_term}
              </span>
            </div>

            <div className="mt-1 text-xs text-slate-400">
              Showing all same-term modules that are not already manually
              combined. Select one or more modules to create a manual combine
              group.
            </div>
          </div>

          <button
            type="button"
            className="rounded-lg px-2 py-1 text-xl leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {candidates.length === 0 ? (
            <EmptyState message="No eligible modules available for manual combine." />
          ) : (
            <DataTable
              rows={candidates}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: "select",
                  header: "Select",
                  render: (row) => (
                    <input
                      type="checkbox"
                      checked={selectedCandidateIds.includes(row.id)}
                      onChange={() => toggleCandidate(row.id)}
                      aria-label={`Select ${row.module_code}`}
                    />
                  ),
                },
                {
                  key: "module",
                  header: "Module",
                  render: (row) => renderModuleCodeAndName(row),
                },
                {
                  key: "programme",
                  header: "Programme",
                  render: (row) => row.programme_code,
                },
                {
                  key: "stream",
                  header: "Stream",
                  render: (row) => displayStream(row.stream_code),
                },
                {
                  key: "term",
                  header: "Term",
                  render: (row) => row.module_term,
                },
                {
                  key: "expected",
                  header: "Expected",
                  render: (row) => row.expected_student_number ?? "-",
                },
                {
                  key: "actual",
                  header: "Actual",
                  render: (row) => row.actual_student_number ?? "-",
                },
              ]}
            />
          )}
        </div>

        <div className="shrink-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4">
          <div className="text-sm text-slate-500">
            {hasSelection
              ? `${selectedCandidateIds.length + 1} modules selected including base module.`
              : "Select at least one module to combine with the base module."}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>

            <button
              type="button"
              className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onConfirm}
              disabled={!hasSelection}
            >
              Confirm Manual Combine
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ManualCombineDetailsDialog({
  group,
  onClose,
  onDelete,
}: {
  group: ManualCombineGroupWithDetails;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-slate-900">
              Manual Combined Modules
            </div>

            <div className="mt-1 text-sm text-slate-500">
              Combined into{" "}
              <span className="font-medium text-slate-700">
                {group.combined_code}
              </span>{" "}
              / Term: {group.module_term}
            </div>
          </div>

          <button
            type="button"
            className="rounded-lg px-2 py-1 text-xl leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="max-h-[65vh] overflow-auto p-5">
          <DataTable
            rows={group.details}
            rowKey={(row) => row.planning_module_id}
            columns={[
              {
                key: "moduleCode",
                header: "Original Module Code",
                render: (row) => row.module_code,
              },
              {
                key: "moduleName",
                header: "Module Name",
                render: (row) => row.module_name ?? "-",
              },
              {
                key: "programme",
                header: "Programme",
                render: (row) => row.programme_code,
              },
              {
                key: "stream",
                header: "Stream",
                render: (row) => displayStream(row.stream_code),
              },
              {
                key: "term",
                header: "Term",
                render: (row) => row.module_term,
              },
              {
                key: "expected",
                header: "Expected",
                render: (row) => row.expected_student_number ?? "-",
              },
              {
                key: "actual",
                header: "Actual",
                render: (row) => row.actual_student_number ?? "-",
              },
            ]}
          />
        </div>

        <div className="flex justify-between border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
            onClick={onDelete}
          >
            Undo Manual Combine
          </button>

          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SplitStep({
  planningModules,
  studentRows,
  manualGroups,
  timetableModules,
  sourceTimetableModules,
  timetableInstances,
  assignments,
  programmeCode,
  selectedStreamCode,
  onNoSplitSingle,
  onSplitSingle,
  onCombinedSplit,
  onUndoTimetableModule,
  onUndoAllSplitDecisionsOnPage = () => {},
  onConfirmAllSplitDecisions,
  onSaveInstanceEdits,
}: {
  planningModules: PlanningModuleWithStudentNumber[];
  studentRows: StudentNumberInputRow[];
  manualGroups: ManualCombineGroupWithDetails[];
  timetableModules: TimetableModuleRow[];
  sourceTimetableModules: TimetableModuleRow[];
  timetableInstances: TimetableModuleInstanceRow[];
  assignments: TeachingAssignmentRow[];
  programmeCode?: string;
  selectedStreamCode?: string;
  onNoSplitSingle: (module: TimetablePlanningModuleRow) => void;
  onSplitSingle: (
    module: TimetablePlanningModuleRow,
    numberOfClasses: number
  ) => void;
  onCombinedSplit: (group: CombineGroupRow, numberOfClasses: number) => void;
  onUndoTimetableModule: (row: TimetableModuleRow) => void;
  onUndoAllSplitDecisionsOnPage: () => void;
  onConfirmAllSplitDecisions: () => void;
  onSaveInstanceEdits: (
    rows: Array<Pick<TimetableModuleInstanceRow, "id"> &
      Partial<
        Pick<
          TimetableModuleInstanceRow,
          | "instance_expected_size"
          | "instance_actual_size"
          | "instance_mode"
        >
      >>
  ) => Promise<void>;
}) {
  const assignmentMap = new Map(
    assignments.map((assignment) => [assignment.timetable_module_id, assignment])
  );

  const planningModuleById = useMemo(() => {
    const map = new Map<string, PlanningModuleWithStudentNumber>();
    for (const row of planningModules) {
      map.set(row.id, row);
    }
    return map;
  }, [planningModules]);

  function getCombinedGroupDefaultTeacher(group: ManualCombineGroupWithDetails) {
    return resolveCombinedDefaultTeacherForGroupDetails(
      group.details,
      planningModules
    );
  }

  const manuallyCombinedPlanningModuleIds = new Set(
    manualGroups.flatMap((group) =>
      group.details.map((detail) => detail.planning_module_id)
    )
  );

  const decidedPlanningModuleIds = new Set(
    sourceTimetableModules
      .map((module) => module.planning_module_id)
      .filter((id): id is string => Boolean(id))
  );

  const pageCombineGroupIdSet = new Set(manualGroups.map((group) => group.id));

  const decidedCombineGroupIds = new Set<string>();

  for (const module of sourceTimetableModules) {
    if (
      module.combine_group_id &&
      pageCombineGroupIdSet.has(module.combine_group_id)
    ) {
      decidedCombineGroupIds.add(module.combine_group_id);
    }
  }

  for (const instance of timetableInstances) {
    if (
      instance.source_type === "combine_group" &&
      instance.source_combine_group_id &&
      pageCombineGroupIdSet.has(instance.source_combine_group_id)
    ) {
      decidedCombineGroupIds.add(instance.source_combine_group_id);
    }
  }

  const singleModules = planningModules.filter(
    (module) =>
      !module.manual_combine_group_id &&
      !manuallyCombinedPlanningModuleIds.has(module.id) &&
      !decidedPlanningModuleIds.has(module.id)
  );

  const pendingManualGroups = manualGroups.filter(
    (group) => !decidedCombineGroupIds.has(group.id)
  );

  const sourceModuleByInstanceCode = useMemo(() => {
    const map = new Map<string, TimetableModuleRow>();
    for (const row of sourceTimetableModules) {
      if (!row.module_instance_code) continue;
      map.set(row.module_instance_code, row);
    }
    return map;
  }, [sourceTimetableModules]);

  const visibleInstanceIds = useMemo(() => {
    const planningIdSet = new Set(planningModules.map((m) => m.id));
    const combineIdSet = new Set(manualGroups.map((g) => g.id));

    return new Set(
      timetableInstances
        .filter((row) => {
          if (
            row.source_type === "planning_module" &&
            row.source_planning_module_id &&
            planningIdSet.has(row.source_planning_module_id)
          ) {
            return decidedPlanningModuleIds.has(row.source_planning_module_id);
          }

          if (
            row.source_type === "combine_group" &&
            row.source_combine_group_id &&
            combineIdSet.has(row.source_combine_group_id)
          ) {
            return decidedCombineGroupIds.has(row.source_combine_group_id);
          }

          const sourceModule = sourceModuleByInstanceCode.get(row.module_instance_code);
          if (!sourceModule) return false;

          if (
            sourceModule.planning_module_id &&
            planningIdSet.has(sourceModule.planning_module_id)
          ) {
            return decidedPlanningModuleIds.has(sourceModule.planning_module_id);
          }

          if (
            sourceModule.combine_group_id &&
            combineIdSet.has(sourceModule.combine_group_id)
          ) {
            return decidedCombineGroupIds.has(sourceModule.combine_group_id);
          }

          return false;
        })
        .map((row) => row.id)
    );
  }, [
    planningModules,
    manualGroups,
    timetableInstances,
    decidedPlanningModuleIds,
    decidedCombineGroupIds,
    sourceModuleByInstanceCode,
  ]);

  const visibleInstances = useMemo(
    () => timetableInstances.filter((row) => visibleInstanceIds.has(row.id)),
    [timetableInstances, visibleInstanceIds]
  );

  const [instanceEdits, setInstanceEdits] = useState<
    Record<
      string,
      {
        instance_expected_size?: number;
        instance_actual_size?: number | null;
        instance_mode?: string | null;
      }
    >
  >({});

  const instanceRowsForValidation = useMemo(() => {
    return visibleInstances.map((row) => {
      const edit = instanceEdits[row.id];
      return {
        ...row,
        instance_expected_size:
          edit?.instance_expected_size ?? row.instance_expected_size ?? 0,
        instance_actual_size:
          edit?.instance_actual_size ?? row.instance_actual_size ?? null,
        instance_mode: edit?.instance_mode ?? (row as any).instance_mode ?? null,
      };
    });
  }, [visibleInstances, instanceEdits]);

  const hasUnsavedInstanceEdits = useMemo(
    () => Object.keys(instanceEdits).length > 0,
    [instanceEdits]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="font-medium text-blue-900">
            Confirm all split decisions (this page only)
          </div>
          <div className="text-sm text-blue-700">
            Scope: {programmeCode || "All programmes"}
            . Pending
            single modules: {singleModules.length}. Pending combined groups:{" "}
            {pendingManualGroups.length}. Remaining items on this page will be
            marked as No Split (1 class).
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onUndoAllSplitDecisionsOnPage}
          >
            Undo All (this page)
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirmAllSplitDecisions}
          >
            Confirm All Split Decisions
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header flex flex-col gap-1 font-semibold md:flex-row md:items-center md:justify-between">
          <div>Module Instances (editable)</div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              const rows = Object.entries(instanceEdits).map(([id, edit]) => ({
                id,
                ...edit,
              }));
              await onSaveInstanceEdits(rows);
              setInstanceEdits({});
            }}
            disabled={!hasUnsavedInstanceEdits}
          >
            Save instance edits
          </button>
        </div>

        <div className="card-body space-y-3">
          {visibleInstances.length === 0 ? (
            <EmptyState message="No instances yet. If you already clicked Split/No Split, please make sure migration 014_timetable_module_instances.sql has been applied, then refresh the page (or run Confirm All Split Decisions once)." />
          ) : (
            <DataTable
              rows={instanceRowsForValidation}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: "instance",
                  header: "Instance",
                  render: (row) => (
                    <div className="space-y-0.5">
                      <div className="font-medium">{row.module_instance_code}</div>
                      <div className="text-xs text-slate-600">
                        {dedupeJoinedModuleName(row.module_name)}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "term",
                  header: "Term",
                  render: (row) => row.module_term,
                },
                {
                  key: "mode",
                  header: "Mode (editable)",
                  render: (row) => (
                    <select
                      className="form-select min-w-28"
                      value={(row as any).instance_mode ?? ""}
                      title="Mode"
                      onChange={(e) => {
                        setInstanceEdits((prev) => ({
                          ...prev,
                          [row.id]: {
                            ...(prev[row.id] ?? {}),
                            instance_mode: e.target.value || null,
                          },
                        }));
                      }}
                    >
                      <option value="">(empty)</option>
                      {modeOptions.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  ),
                },
                {
                  key: "expected",
                  header: "Size (editable)",
                  render: (row) => (
                    <input
                      className="form-input w-28"
                      value={row.instance_expected_size ?? 0}
                      title="Instance size"
                      placeholder="0"
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setInstanceEdits((prev) => ({
                          ...prev,
                          [row.id]: {
                            ...(prev[row.id] ?? {}),
                            instance_expected_size: Number.isFinite(next) ? next : 0,
                          },
                        }));
                      }}
                    />
                  ),
                },
                {
                  key: "source",
                  header: "Source",
                  render: (row) =>
                    row.source_type === "combine_group"
                      ? `Combine: ${row.source_combine_group_id ?? "-"}`
                      : `Single: ${row.source_planning_module_id ?? "-"}`,
                },
                {
                  key: "undo",
                  header: "Undo",
                  render: (row) => {
                    const tm = sourceModuleByInstanceCode.get(row.module_instance_code);
                    return (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!tm}
                        title={
                          tm
                            ? "Undo split/no-split decision for this source."
                            : "Cannot resolve timetable module row for undo."
                        }
                        onClick={() => {
                          if (!tm) return;
                          onUndoTimetableModule(tm);
                        }}
                      >
                        Undo
                      </button>
                    );
                  },
                },
              ]}
            />
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header font-semibold">
          Combined Modules Ready for Split
        </div>

        <div className="card-body">
          {pendingManualGroups.length === 0 ? (
            <EmptyState message="No pending combined groups on this page. Groups already split are hidden." />
          ) : (
            <DataTable
              rows={pendingManualGroups}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: "code",
                  header: "Combined Code",
                  render: (row) => row.combined_code,
                },
                {
                  key: "term",
                  header: "Term",
                  render: (row) => row.module_term,
                },
                {
                  key: "expected",
                  header: "Expected",
                  render: (row) => row.total_expected_student_number ?? 0,
                },
                {
                  key: "actual",
                  header: "Actual",
                  render: (row) => row.total_actual_student_number ?? "-",
                },
                {
                  key: "defaultTeacher",
                  header: "Default Teacher",
                  render: (row) => getCombinedGroupDefaultTeacher(row),
                },
                {
                  key: "action",
                  header: "Action",
                  render: (row) => (
                    <SplitAction
                      expected={row.total_expected_student_number ?? 0}
                      onNoSplit={() => onCombinedSplit(row, 1)}
                      onSplit={(count) => onCombinedSplit(row, count)}
                    />
                  ),
                },
              ]}
            />
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header font-semibold">
          Single Modules Ready for Split
        </div>

        <div className="card-body">
          {singleModules.length === 0 ? (
            <EmptyState message="No pending single modules. Generated modules appear above." />
          ) : (
            <DataTable
              rows={singleModules}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: "module",
                  header: "Module",
                  render: (row) => renderModuleCodeAndName(row),
                },
                {
                  key: "programme",
                  header: "Programme",
                  render: (row) => row.programme_code,
                },
                {
                  key: "stream",
                  header: "Stream",
                  render: (row) => displayStream(row.stream_code),
                },
                {
                  key: "term",
                  header: "Term",
                  render: (row) => row.module_term,
                },
                {
                  key: "expected",
                  header: "Expected",
                  render: (row) => {
                    const student = studentRows.find((s) =>
                      isSameStudentNumberRow(s, row, selectedStreamCode)
                    );

                    return student?.expected_student_number ?? 0;
                  },
                },
                {
                  key: "defaultTeacher",
                  header: "Default Teacher",
                  render: (row) => row.default_teacher_name ?? "TBC",
                },
                {
                  key: "action",
                  header: "Action",
                  render: (row) => {
                    const student = studentRows.find((s) =>
                      isSameStudentNumberRow(s, row, selectedStreamCode)
                    );

                    return (
                      <SplitAction
                        expected={student?.expected_student_number ?? 0}
                        onNoSplit={() => onNoSplitSingle(row)}
                        onSplit={(count) => onSplitSingle(row, count)}
                      />
                    );
                  },
                },
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function AssignmentStep({
  timetableModules,
  teachers,
  assignments,
  onSave,
  onConfirm,
}: {
  timetableModules: TimetableModuleRow[];
  teachers: TeacherRow[];
  assignments: TeachingAssignmentRow[];
  onSave: (params: {
    timetableModule: TimetableModuleRow;
    teacherId: string;
    mode: TeachingMode;
    teachingStatus: TeachingStatus;
  }) => void;
  onConfirm: () => void;
}) {
  const assignmentMap = new Map(
    assignments.map((assignment) => [assignment.timetable_module_id, assignment])
  );

  if (timetableModules.length === 0) {
    return <EmptyState message="No timetable modules. Confirm split decision first." />;
  }

  return (
    <div className="space-y-4">
      <DataTable
        rows={timetableModules}
        rowKey={(row) => row.id}
        columns={[
          {
            key: "module",
            header: "Module Instance",
            render: (row) => renderModuleInstanceAndName(row),
          },
          {
            key: "term",
            header: "Term",
            render: (row) => row.module_term,
          },
          {
            key: "mode",
            header: "Mode",
            render: (row) => (
              <select
                className="form-select min-w-28"
                defaultValue={row.mode ?? "Night"}
                id={`mode-${row.id}`}
                title="Mode"
              >
                {modeOptions.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            ),
          },
          {
            key: "teacher",
            header: "Teacher",
            render: (row) => {
              const existing = assignmentMap.get(row.id);

              return (
                <select
                  className="form-select min-w-48"
                  defaultValue={
                    !existing?.teacher_name || existing.teacher_name === "TBC"
                      ? "TBC"
                      : teachers.find(
                          (teacher) =>
                            teacher.teacher_name === existing.teacher_name
                        )?.id ?? "TBC"
                  }
                  id={`teacher-${row.id}`}
                  title="Teacher"
                >
                  <option value="TBC">TBC</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.teacher_name} - {teacher.employment_type ?? "-"}
                    </option>
                  ))}
                </select>
              );
            },
          },
          {
            key: "teachingStatus",
            header: "Teaching Status",
            render: (row) => {
              const existing = assignmentMap.get(row.id);

              return (
                <select
                  className="form-select min-w-24"
                  defaultValue={existing?.teaching_status ?? "FT"}
                  id={`teaching-status-${row.id}`}
                  title="Teaching status"
                >
                  {teachingStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              );
            },
          },
          {
            key: "current",
            header: "Current",
            render: (row) => {
              const existing = assignmentMap.get(row.id);

              return existing ? (
                <div className="text-xs">
                  <div>{existing.teacher_name}</div>
                  <div className="text-slate-500">{existing.teaching_status}</div>
                  <StatusBadge status={existing.confirmed ? "confirmed" : "draft"} />
                </div>
              ) : (
                <span className="text-slate-400">No draft</span>
              );
            },
          },
          {
            key: "action",
            header: "Action",
            render: (row) => (
              <button
                type="button"
                className="btn btn-primary py-1 text-xs"
                onClick={() => {
                  const modeEl = document.getElementById(
                    `mode-${row.id}`
                  ) as HTMLSelectElement | null;

                  const teacherEl = document.getElementById(
                    `teacher-${row.id}`
                  ) as HTMLSelectElement | null;

                  const statusEl = document.getElementById(
                    `teaching-status-${row.id}`
                  ) as HTMLSelectElement | null;

                  onSave({
                    timetableModule: row,
                    teacherId: teacherEl?.value || "TBC",
                    mode: (modeEl?.value ?? "Night") as TeachingMode,
                    teachingStatus: (statusEl?.value ?? "FT") as TeachingStatus,
                  });
                }}
              >
                Save
              </button>
            ),
          },
        ]}
      />

      <button type="button" className="btn btn-success" onClick={onConfirm}>
        Confirm Assignment
      </button>
    </div>
  );
}
