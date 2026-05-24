import { useEffect, useMemo, useState } from "react";

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
  confirmAssignments,
  listAssignments,
  saveAssignmentDraft,
} from "../../services/assignmentService";
import { downloadTimetableExcel } from "../../services/exportService";
import {
  createManualCombineGroup,
  deleteManualCombineGroup,
  listManualCombineGroups,
  type ManualCombineGroupWithDetails,
} from "../../services/manualCombineService";
import { listProgrammes } from "../../services/programmeService";
import {
  createCombinedTimetableModules,
  createNoSplitSingleModule,
  createSplitSingleModule,
  getPlanningModulesForCombineGroup,
  undoTimetableModuleDecision,
} from "../../services/splitClassService";
import {
  bulkUpsertStudentNumbers,
  getStudentNumberInputRows,
  validateStudentNumbersComplete,
  type StudentNumberInputRow,
} from "../../services/studentNumberService";
import { listTeachers } from "../../services/teacherService";
import {
  ensureTimetablePlanningModules,
  listAllPlanningModulesWithStudentNumbers,
  listPlanningModulesWithStudentNumbers,
  listTimetableModules,
  type PlanningModuleWithStudentNumber,
} from "../../services/timetableService";
import type {
  CombineGroupRow,
  ProgrammeRow,
  TeacherRow,
  TeachingAssignmentRow,
  TeachingMode,
  TeachingStatus,
  TimetableModuleRow,
  TimetablePlanningModuleRow,
} from "../../types";

import { PlanningStep } from "./make-timetable/components/PlanningStep";
import { SplitAction } from "./make-timetable/components/SplitAction";
import { StepTabs } from "./make-timetable/components/StepTabs";
import { StudentNumberStep } from "./make-timetable/components/StudentNumberStep";
import {
  displayStream,
  normalizeCompareText,
  renderModuleCodeAndName,
  renderModuleInstanceAndName,
} from "./make-timetable/helpers";
import type { Step } from "./make-timetable/types";

const modeOptions: TeachingMode[] = ["Day", "Night", "Saturday"];
const teachingStatusOptions: TeachingStatus[] = ["FT", "PT"];

function isSameStudentNumberRow(
  row: StudentNumberInputRow,
  module: {
    academic_year: string;
    module_code: string;
    programme_code: string;
    module_term?: string | null;
  }
) {
  return (
    row.academic_year === module.academic_year &&
    row.module_code === module.module_code &&
    row.programme_code === module.programme_code &&
    (row.module_term ?? null) === (module.module_term ?? null)
  );
}

export function MakeTimetablePage() {
  const { user } = useAuth();
  const { academicYear } = useAcademicYear();
  const { t } = useLanguage();

  const [step, setStep] = useState<Step>("planning");
  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [programmeCode, setProgrammeCode] = useState("");
  const [streamCode, setStreamCode] = useState("");

  const [planningModules, setPlanningModules] = useState<
    PlanningModuleWithStudentNumber[]
  >([]);

  const [studentRows, setStudentRows] = useState<StudentNumberInputRow[]>([]);
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

  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [assignments, setAssignments] = useState<TeachingAssignmentRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const programmeCodes = useMemo(
    () => [...new Set(programmes.map((p) => p.programme_code))],
    [programmes]
  );

  const streamOptions = useMemo(
    () =>
      programmes
        .filter((p) => !programmeCode || p.programme_code === programmeCode)
        .map((p) => p.programme_stream),
    [programmes, programmeCode]
  );

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
      streamCode: streamCode || undefined,
    });

    setPlanningModules(data);
  }

  async function refreshStudentRows(planning = planningModules) {
    const data = await getStudentNumberInputRows({
      academicYear,
      planningModules: planning,
    });

    setStudentRows(data);
  }

  async function refreshCombineGroups(filters?: {
    programmeCode?: string;
    streamCode?: string;
  }) {
    const selectedProgrammeCode =
      filters?.programmeCode !== undefined
        ? filters.programmeCode
        : programmeCode;

    const selectedStreamCode =
      filters?.streamCode !== undefined ? filters.streamCode : streamCode;

    const manual = await listManualCombineGroups({
      academicYear,
      programmeCode: selectedProgrammeCode || undefined,
      streamCode: selectedStreamCode || undefined,
    });

    setManualGroups(manual);
  }

  async function refreshTimetableAndAssignments(filters?: {
    programmeCode?: string;
    streamCode?: string;
  }) {
    const selectedProgrammeCode =
      filters?.programmeCode !== undefined
        ? filters.programmeCode
        : programmeCode;

    const selectedStreamCode =
      filters?.streamCode !== undefined ? filters.streamCode : streamCode;

    const [modules, teacherRows, assignmentRows] = await Promise.all([
      listTimetableModules({
        academicYear,
        programmeCode: selectedProgrammeCode || undefined,
        streamCode: selectedStreamCode || undefined,
      }),
      listTeachers(academicYear),
      listAssignments(academicYear),
    ]);

    const moduleIds = new Set(modules.map((module) => module.id));

    const filteredAssignments = assignmentRows.filter((assignment) =>
      moduleIds.has(assignment.timetable_module_id)
    );

    setTimetableModules(modules);
    setTeachers(teacherRows);
    setAssignments(filteredAssignments);
  }

  async function handleSaveStudentNumbers() {
    if (!user) {
      setMessage("Please login before saving student numbers.");
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

      await refreshPlanning();

      await refreshCombineGroups({
        programmeCode,
        streamCode,
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
        streamCode,
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
        streamCode,
      });

      setMessage("Manual combine undone. Modules can be combined again.");
    } catch (error) {
      console.error("[MakeTimetablePage] Undo manual combine failed:", error);
      setMessage(
        error instanceof Error ? error.message : "Undo manual combine failed"
      );
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
        streamCode: streamCode || undefined,
      });

      const latestStudentRows = await getStudentNumberInputRows({
        academicYear,
        planningModules: latestPlanningModules,
      });

      const latestManualGroups = await listManualCombineGroups({
        academicYear,
        programmeCode: programmeCode || undefined,
        streamCode: streamCode || undefined,
      });

      setPlanningModules(latestPlanningModules);
      setStudentRows(latestStudentRows);
      setManualGroups(latestManualGroups);

      await refreshTimetableAndAssignments({
        programmeCode,
        streamCode,
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
      await createNoSplitSingleModule({
        planningModule: module,
        expectedStudentNumber: student?.expected_student_number ?? 0,
        actualStudentNumber: student?.actual_student_number ?? null,
        createdBy: user.id,
      });

      await refreshPlanning();

      await refreshCombineGroups({
        programmeCode,
        streamCode,
      });

      await refreshTimetableAndAssignments({
        programmeCode,
        streamCode,
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
      await createSplitSingleModule({
        planningModule: module,
        expectedStudentNumber: student?.expected_student_number ?? 0,
        actualStudentNumber: student?.actual_student_number ?? null,
        numberOfClasses,
        createdBy: user.id,
      });

      await refreshPlanning();

      await refreshCombineGroups({
        programmeCode,
        streamCode,
      });

      await refreshTimetableAndAssignments({
        programmeCode,
        streamCode,
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
      const related = await getPlanningModulesForCombineGroup(group.id);

      await createCombinedTimetableModules({
        combineGroup: group,
        relatedPlanningModules: related,
        numberOfClasses,
        createdBy: user.id,
      });

      await refreshPlanning();

      await refreshCombineGroups({
        programmeCode,
        streamCode,
      });

      await refreshTimetableAndAssignments({
        programmeCode,
        streamCode,
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
    setMessage("Confirming all split decisions...");

    try {
      const latestPlanningModules = await listPlanningModulesWithStudentNumbers({
        academicYear,
        programmeCode: programmeCode || undefined,
        streamCode: streamCode || undefined,
      });

      const latestManualGroups = await listManualCombineGroups({
        academicYear,
        programmeCode: programmeCode || undefined,
        streamCode: streamCode || undefined,
      });

      const latestTimetableModules = await listTimetableModules({
        academicYear,
        programmeCode: programmeCode || undefined,
        streamCode: streamCode || undefined,
      });

      const latestStudentRows = await getStudentNumberInputRows({
        academicYear,
        planningModules: latestPlanningModules,
      });

      const decidedCombineGroupIds = new Set(
        latestTimetableModules
          .map((module) => module.combine_group_id)
          .filter((id): id is string => Boolean(id))
      );

      const pendingCombinedGroups = latestManualGroups.filter(
        (group) => !decidedCombineGroupIds.has(group.id)
      );

      if (pendingCombinedGroups.length > 0) {
        setMessage(
          `Please complete split decisions for ${pendingCombinedGroups.length} combined group(s) before confirming all split decisions.`
        );
        return;
      }

      const manuallyCombinedPlanningModuleIds = new Set(
        latestManualGroups.flatMap((group) =>
          group.details.map((detail) => detail.planning_module_id)
        )
      );

      const decidedPlanningModuleIds = new Set(
        latestTimetableModules
          .map((module) => module.planning_module_id)
          .filter((id): id is string => Boolean(id))
      );

      const pendingSingleModules = latestPlanningModules.filter(
        (module) =>
          !module.manual_combine_group_id &&
          !manuallyCombinedPlanningModuleIds.has(module.id) &&
          !decidedPlanningModuleIds.has(module.id)
      );

      for (const module of pendingSingleModules) {
        const student = latestStudentRows.find((row) =>
          isSameStudentNumberRow(row, module)
        );

        await createNoSplitSingleModule({
          planningModule: module,
          expectedStudentNumber: student?.expected_student_number ?? 0,
          actualStudentNumber: student?.actual_student_number ?? null,
          createdBy: user.id,
        });
      }

      await refreshPlanning();

      await refreshCombineGroups({
        programmeCode,
        streamCode,
      });

      await refreshTimetableAndAssignments({
        programmeCode,
        streamCode,
      });

      setMessage(
        `All split decisions confirmed. ${pendingSingleModules.length} pending single module(s) were marked as No Split.`
      );

      setStep("assignment");
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
        streamCode,
      });

      await refreshTimetableAndAssignments({
        programmeCode,
        streamCode,
      });

      setMessage("Split/no-split decision undone.");
    } catch (error) {
      console.error("[MakeTimetablePage] Undo split decision failed:", error);
      setMessage(error instanceof Error ? error.message : "Undo failed");
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
        streamCode,
      });

      setMessage("Assignment saved.");
    } catch (error) {
      console.error("[MakeTimetablePage] Assignment save failed:", error);
      setMessage(error instanceof Error ? error.message : "Assignment failed");
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
        streamCode,
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

  async function handleExportExcel() {
    if (!user) {
      setMessage("Please login before exporting timetable.");
      return;
    }

    try {
      await downloadTimetableExcel({
        academicYear,
        exportedBy: user.id,
        programmeCode: programmeCode || undefined,
        streamCode: streamCode || undefined,
      });
    } catch (error) {
      console.error("[MakeTimetablePage] Export failed:", error);
      setMessage(error instanceof Error ? error.message : "Export failed");
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function refreshFilteredData() {
      if (!user) {
        setPlanningModules([]);
        setStudentRows([]);
        return;
      }

      try {
        setLoading(true);

        await ensureTimetablePlanningModules({
          academicYear,
          programmeCode: programmeCode || undefined,
          createdBy: user.id,
        });

        if (cancelled) return;

        const data = await listPlanningModulesWithStudentNumbers({
          academicYear,
          programmeCode: programmeCode || undefined,
          streamCode: streamCode || undefined,
        });

        if (cancelled) return;

        setPlanningModules(data);

        const studentData = await getStudentNumberInputRows({
          academicYear,
          planningModules: data,
        });

        if (cancelled) return;

        setStudentRows(studentData);

        if (step === "combine" || step === "split") {
          await refreshCombineGroups({
            programmeCode,
            streamCode,
          });
        }

        if (cancelled) return;

        if (step === "split" || step === "assignment") {
          await refreshTimetableAndAssignments({
            programmeCode,
            streamCode,
          });
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[MakeTimetablePage] Refresh filtered data failed:", error);
          setMessage(error instanceof Error ? error.message : "Refresh failed");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void refreshFilteredData();

    return () => {
      cancelled = true;
    };
  }, [academicYear, programmeCode, streamCode, step, user]);

  return (
    <div className="page-container">
      <PageHeader
        title={t.makeTimetable}
        description="Workflow: planning → student numbers → manual combine → split → assignment."
        actions={
          <button type="button" className="btn btn-primary" onClick={handleExportExcel}>
            {t.downloadTimetableExcel}
          </button>
        }
      />

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      <div className="card mb-4">
        <div className="card-body grid gap-3 md:grid-cols-4">
          <div>
            <label className="form-label">{t.academicYear}</label>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              {academicYear}
            </div>
          </div>

          <div>
            <label className="form-label">{t.programmeCode}</label>
            <select
              className="form-select"
              value={programmeCode}
              onChange={(event) => {
                setProgrammeCode(event.target.value);
                setStreamCode("");
                setStep("planning");
              }}
            >
              <option value="">All Programmes</option>
              {programmeCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">{t.programmeStream}</label>
            <select
              className="form-select"
              value={streamCode}
              onChange={(event) => {
                setStreamCode(event.target.value);
                setStep("planning");
              }}
            >
              <option value="">All Streams</option>
              {[...new Set(streamOptions)].map((stream) => (
                <option key={stream} value={stream}>
                  {stream}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Modules are loaded automatically.
            </div>
          </div>
        </div>
      </div>

      <StepTabs step={step} setStep={setStep} />

      {loading ? (
        <LoadingState />
      ) : (
        <>
          {step === "planning" && (
            <PlanningStep planningModules={planningModules} />
          )}

          {step === "student_numbers" && (
            <StudentNumberStep
              rows={studentRows}
              updateRow={updateStudentRow}
              onSave={handleSaveStudentNumbers}
            />
          )}

          {step === "combine" && (
            <CombineStep
              planningModules={planningModules}
              manualGroups={manualGroups}
              openManualCombineDialog={openManualCombineDialog}
              onDeleteManualCombine={handleDeleteManualCombine}
              onConfirmAllModulesCombined={handleConfirmAllModulesCombined}
            />
          )}

          {step === "split" && (
            <SplitStep
              planningModules={planningModules}
              studentRows={studentRows}
              manualGroups={manualGroups}
              timetableModules={timetableModules}
              assignments={assignments}
              onNoSplitSingle={handleNoSplitSingle}
              onSplitSingle={handleSplitSingle}
              onCombinedSplit={handleCreateCombinedSplit}
              onUndoTimetableModule={handleUndoTimetableModule}
              onConfirmAllSplitDecisions={handleConfirmAllSplitDecisions}
            />
          )}

          {step === "assignment" && (
            <AssignmentStep
              timetableModules={timetableModules}
              teachers={teachers}
              assignments={assignments}
              onSave={handleSaveAssignment}
              onConfirm={handleConfirmAssignments}
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
  onConfirmAllModulesCombined,
}: {
  planningModules: PlanningModuleWithStudentNumber[];
  manualGroups: ManualCombineGroupWithDetails[];
  openManualCombineDialog: (module: PlanningModuleWithStudentNumber) => void;
  onDeleteManualCombine: (groupId: string) => void;
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
              Review manual combine groups. When all modules are ready,
              continue to Split page. Single modules will remain as individual
              modules; combined groups will be handled as combined modules in
              Split page.
            </div>

            <div className="mt-1 text-xs text-blue-600">
              Manual combine groups: {manualGroups.length}. Uncombined eligible
              modules: {manualEligibleModules.length}.
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirmAllModulesCombined}
          >
            Confirm All Modules Are Combined
          </button>
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
  assignments,
  onNoSplitSingle,
  onSplitSingle,
  onCombinedSplit,
  onUndoTimetableModule,
  onConfirmAllSplitDecisions,
}: {
  planningModules: PlanningModuleWithStudentNumber[];
  studentRows: StudentNumberInputRow[];
  manualGroups: ManualCombineGroupWithDetails[];
  timetableModules: TimetableModuleRow[];
  assignments: TeachingAssignmentRow[];
  onNoSplitSingle: (module: TimetablePlanningModuleRow) => void;
  onSplitSingle: (
    module: TimetablePlanningModuleRow,
    numberOfClasses: number
  ) => void;
  onCombinedSplit: (group: CombineGroupRow, numberOfClasses: number) => void;
  onUndoTimetableModule: (row: TimetableModuleRow) => void;
  onConfirmAllSplitDecisions: () => void;
}) {
  const assignmentMap = new Map(
    assignments.map((assignment) => [assignment.timetable_module_id, assignment])
  );

  const manuallyCombinedPlanningModuleIds = new Set(
    manualGroups.flatMap((group) =>
      group.details.map((detail) => detail.planning_module_id)
    )
  );

  const decidedPlanningModuleIds = new Set(
    timetableModules
      .map((module) => module.planning_module_id)
      .filter((id): id is string => Boolean(id))
  );

  const decidedCombineGroupIds = new Set(
    timetableModules
      .map((module) => module.combine_group_id)
      .filter((id): id is string => Boolean(id))
  );

  const singleModules = planningModules.filter(
    (module) =>
      !module.manual_combine_group_id &&
      !manuallyCombinedPlanningModuleIds.has(module.id) &&
      !decidedPlanningModuleIds.has(module.id)
  );

  const pendingManualGroups = manualGroups.filter(
    (group) => !decidedCombineGroupIds.has(group.id)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="font-medium text-blue-900">
            Confirm all split decisions
          </div>
          <div className="text-sm text-blue-700">
            Pending single modules: {singleModules.length}. Pending combined
            groups: {pendingManualGroups.length}. Remaining single modules will
            be marked as No Split.
          </div>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={onConfirmAllSplitDecisions}
        >
          Confirm All Split Decisions
        </button>
      </div>

      <div className="card">
        <div className="card-header font-semibold">
          Generated Timetable Modules
        </div>

        <div className="card-body">
          {timetableModules.length === 0 ? (
            <EmptyState message="No timetable modules generated yet. Confirm split/no-split decisions below." />
          ) : (
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
                  key: "programme",
                  header: "Programme",
                  render: (row) => row.programme_code ?? "-",
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
                  key: "students",
                  header: "Students",
                  render: (row) => (
                    <span>
                      Expected: {row.expected_student_number ?? 0}
                      {row.actual_student_number != null
                        ? ` / Actual: ${row.actual_student_number}`
                        : ""}
                    </span>
                  ),
                },
                {
                  key: "teacher",
                  header: "Default Teacher",
                  render: (row) => {
                    const assignment = assignmentMap.get(row.id);
                    return assignment?.teacher_name ?? "TBC";
                  },
                },
                {
                  key: "status",
                  header: "Status",
                  render: (row) => (
                    <StatusBadge
                      status={row.split_confirmed ? "confirmed" : "draft"}
                    />
                  ),
                },
                {
                  key: "action",
                  header: "Action",
                  render: (row) => (
                    <button
                      type="button"
                      className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
                      onClick={() => onUndoTimetableModule(row)}
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

      <div className="card">
        <div className="card-header font-semibold">
          Combined Modules Ready for Split
        </div>

        <div className="card-body">
          {pendingManualGroups.length === 0 ? (
            <EmptyState message="No pending manual combined groups. Generated combined modules appear above." />
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
                      isSameStudentNumberRow(s, row)
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
                      isSameStudentNumberRow(s, row)
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
