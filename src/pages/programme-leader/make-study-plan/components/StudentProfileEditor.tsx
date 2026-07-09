import { useEffect, useMemo, useState } from "react";

import type { StudyPlanModule, StudyPlanStudent } from "../types";

import {
  listProgrammeOptions,
  loadProgrammeModules,
  loadBridgingModuleOptionsForDegree,
  buildStudyPlanModuleFieldsFromCode,
  buildStudyPlanModulePersistKey,
  deleteStudyPlanModuleById,
  saveStudyPlanModules,
  saveStudyPlanStudentProfile,
  sortModulesForStudyPlan,
  upsertStudyPlanModuleRow,
  attachProgrammeTypeToStudent,
  formatStudyPlanSaveError,
  type ProgrammeOption,
} from "../../../../services/studyPlanService";

import { downloadStudyPlanCsv } from "../../../../services/studyPlanExportService";
import {
  loadEnrollmentInstanceCatalog,
  type EnrollmentInstanceOption,
} from "../../../../services/studyPlanEnrollmentService";
import { studyTermToAcademicYear } from "../helpers";

import {
  getDegreeStartTermAfterBridging,
  generateStudyPlanForStudent,
} from "../studyPlanRules";

import ModulePlanTable from "./ModulePlanTable";
import StudyPlanSummaryPanel from "./StudyPlanSummaryPanel";
import {
  INTAKE_LEVEL_OPTIONS,
  normalizeIntakeLevel,
} from "../../../../lib/programmeYear";
import { isDegreeProgramme, isHDProgramme } from "../helpers";

interface Props {
  initialStudent: StudyPlanStudent;
  initialModules: StudyPlanModule[];
  /** Only reload local state from props when this changes (open student / after Save). */
  editorReloadVersion: number;
  onSaved: () => Promise<void>;
}

interface BridgingRow {
  moduleKey: string;
  customModuleCode: string;
  studyTerm: string;
}

const MANUAL_BRIDGING_MODULE_KEY = "__manual__";

function createEmptyBridgingRows(): BridgingRow[] {
  return Array.from({ length: 7 }, () => ({
    moduleKey: "",
    customModuleCode: "",
    studyTerm: "",
  }));
}

function normalizeStreamForCompare(value?: string | null): string {
  return String(value ?? "nil").trim() || "nil";
}

function isGeneralProgrammeStream(value?: string | null): boolean {
  return normalizeStreamForCompare(value) === "nil";
}

function resolveDefaultProgrammeStream(
  programmeCode: string,
  options: ProgrammeOption[]
): string {
  const streams = options.filter((item) => item.programmeCode === programmeCode);

  if (streams.length === 0) {
    return "";
  }

  if (streams.length === 1) {
    return streams[0].programmeStream ?? "nil";
  }

  if (streams.every((item) => isGeneralProgrammeStream(item.programmeStream))) {
    return streams[0].programmeStream ?? "nil";
  }

  return "";
}

/**
 * Merge catalogue row with an existing DB row when reloading programme modules.
 * Resets failed/exempted progress so re-enrollment can start fresh study terms.
 */
function mergeLoadedProgrammeModule(
  template: StudyPlanModule,
  existing: StudyPlanModule | undefined,
  student: StudyPlanStudent
): StudyPlanModule {
  const merged: StudyPlanModule = {
    ...template,
    programmeCode: template.programmeCode || student.programmeCode,
    programmeStream: template.programmeStream || student.programmeStream,
    studentId: student.studentId,
    studentProfileId: student.id,
    planStage: template.planStage ?? "programme",
  };

  if (!existing) {
    return merged;
  }

  return {
    ...merged,
    id: existing.id,
    moduleCode: existing.moduleCode || merged.moduleCode,
    status: "planned",
    studyTerm: undefined,
    isExempted: false,
    isFailed: false,
    isLocked: existing.isLocked ?? false,
    remark: existing.remark,
    enrolledModuleInstanceCode: existing.enrolledModuleInstanceCode,
  };
}

function buildModuleOptionKey(module: StudyPlanModule): string {
  return [
    module.moduleCode,
    module.programmeCode,
    module.programmeStream ?? "nil",
    module.moduleTerm ?? module.moduleTermPattern ?? "",
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .join("|");
}

export default function StudentProfileEditor({
  initialStudent,
  initialModules,
  editorReloadVersion,
  onSaved,
}: Props) {
  const [student, setStudent] = useState<StudyPlanStudent>(initialStudent);
  const [modules, setModules] = useState<StudyPlanModule[]>(initialModules);

  const [savingModules, setSavingModules] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [rowActionIndex, setRowActionIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [loadingModules, setLoadingModules] = useState(false);
  const [enrollmentInstances, setEnrollmentInstances] = useState<
    EnrollmentInstanceOption[]
  >([]);

  const [programmeOptions, setProgrammeOptions] = useState<ProgrammeOption[]>(
    []
  );

  const moduleStudyTermsKey = useMemo(
    () =>
      modules
        .map((module) => String(module.studyTerm ?? "").trim())
        .filter(Boolean)
        .sort()
        .join("|"),
    [modules]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadEnrollmentOptions() {
      const academicYears = Array.from(
        new Set(
          modules
            .map((module) => studyTermToAcademicYear(String(module.studyTerm ?? "")))
            .map((year) => String(year ?? "").trim())
            .filter(Boolean)
        )
      );

      if (academicYears.length === 0) {
        if (!cancelled) {
          setEnrollmentInstances([]);
        }
        return;
      }

      try {
        const catalogs = await Promise.all(
          academicYears.map((academicYear) =>
            loadEnrollmentInstanceCatalog({ academicYear })
          )
        );

        if (!cancelled) {
          setEnrollmentInstances(catalogs.flat());
        }
      } catch {
        if (!cancelled) {
          setEnrollmentInstances([]);
        }
      }
    }

    void loadEnrollmentOptions();

    return () => {
      cancelled = true;
    };
  }, [moduleStudyTermsKey, modules]);
  const [loadingProgrammes, setLoadingProgrammes] = useState(false);

  const [bridgingOptions, setBridgingOptions] = useState<StudyPlanModule[]>([]);
  const [loadingBridgingOptions, setLoadingBridgingOptions] = useState(false);
  const [bridgingRows, setBridgingRows] = useState<BridgingRow[]>(
    createEmptyBridgingRows()
  );

  useEffect(() => {
    setStudent(initialStudent);
    setModules(initialModules);
    setBridgingRows(createEmptyBridgingRows());
    setBridgingOptions([]);
  }, [editorReloadVersion, initialStudent, initialModules]);


  const selectedProgrammeType = useMemo(() => {
    return programmeOptions.find(
      (item) => item.programmeCode === student.programmeCode
    )?.programmeType;
  }, [programmeOptions, student.programmeCode]);

  const isDegree = useMemo(
    () => isDegreeProgramme(student.programmeCode, selectedProgrammeType),
    [student.programmeCode, selectedProgrammeType]
  );

  const isHd = useMemo(
    () => isHDProgramme(student.programmeCode, selectedProgrammeType),
    [student.programmeCode, selectedProgrammeType]
  );

  const programmeCodeOptions = useMemo(() => {
    const map = new Map<
      string,
      {
        programmeCode: string;
        programmeName?: string;
      }
    >();

    for (const item of programmeOptions) {
      if (!item.programmeCode) continue;

      if (!map.has(item.programmeCode)) {
        map.set(item.programmeCode, {
          programmeCode: item.programmeCode,
          programmeName: item.programmeName,
        });
      }
    }

    return Array.from(map.values());
  }, [programmeOptions]);

  const streamOptions = useMemo(() => {
    if (!student.programmeCode) return [];

    return programmeOptions.filter(
      (item) => item.programmeCode === student.programmeCode
    );
  }, [programmeOptions, student.programmeCode]);

  const selectedProgrammeOption = useMemo(() => {
    if (!student.programmeCode || !student.programmeStream) {
      return undefined;
    }

    return programmeOptions.find(
      (item) =>
        item.programmeCode === student.programmeCode &&
        normalizeStreamForCompare(item.programmeStream) ===
          normalizeStreamForCompare(student.programmeStream)
    );
  }, [programmeOptions, student.programmeCode, student.programmeStream]);

  const confirmedBridgingModules = useMemo(() => {
    return modules.filter((module) => module.planStage === "bridging");
  }, [modules]);

  const canLoadProgrammeModules = useMemo(() => {
    return (
      !loadingModules &&
      String(student.programmeCode ?? "").trim() !== "" &&
      String(student.programmeStream ?? "").trim() !== ""
    );
  }, [loadingModules, student.programmeCode, student.programmeStream]);

  useEffect(() => {
    async function loadProgrammes() {
      setLoadingProgrammes(true);

      try {
        const options = await listProgrammeOptions();
        setProgrammeOptions(options);
      } catch (error) {
        console.error("[StudyPlan] Failed to load programmes:", error);

        const message =
          error instanceof Error
            ? error.message
            : "Unknown error while loading programmes.";

        alert(`Failed to load programmes:\n\n${message}`);
      } finally {
        setLoadingProgrammes(false);
      }
    }

    void loadProgrammes();
  }, []);

  useEffect(() => {
    if (!student.programmeCode || String(student.programmeStream ?? "").trim()) {
      return;
    }

    const defaultStream = resolveDefaultProgrammeStream(
      student.programmeCode,
      programmeOptions
    );

    if (!defaultStream) {
      return;
    }

    setStudent((prev) => ({
      ...prev,
      programmeStream: defaultStream,
    }));
  }, [programmeOptions, student.programmeCode, student.programmeStream]);

  /**
   * Load allowed bridging module options when a Degree programme + stream is selected.
   */
  useEffect(() => {
    async function loadBridgingOptions() {
      if (!isDegree || !student.programmeCode || !student.programmeStream) {
        setBridgingOptions([]);
        return;
      }

      setLoadingBridgingOptions(true);

      try {
        const options = await loadBridgingModuleOptionsForDegree({
          degreeProgrammeCode: student.programmeCode,
          degreeProgrammeStream: student.programmeStream,
        });

        setBridgingOptions(options);
      } catch (error) {
        console.error(
          "[StudyPlan] Failed to load bridging module options:",
          error
        );

        const message =
          error instanceof Error
            ? error.message
            : "Unknown error while loading bridging module options.";

        alert(`Failed to load bridging module options:\n\n${message}`);

        setBridgingOptions([]);
      } finally {
        setLoadingBridgingOptions(false);
      }
    }

    void loadBridgingOptions();
  }, [isDegree, student.programmeCode, student.programmeStream]);

  /**
   * When editing an existing Degree study plan, populate the bridging editor
   * from existing saved bridging modules.
   */
  useEffect(() => {
    if (!isDegree) return;

    const existingBridgingModules = modules.filter(
      (module) => module.planStage === "bridging"
    );

    if (existingBridgingModules.length === 0) return;

    const nextRows = createEmptyBridgingRows();

    existingBridgingModules.slice(0, 7).forEach((module, index) => {
      const moduleKey = buildModuleOptionKey(module);
      const matchedOption = bridgingOptions.find(
        (option) => buildModuleOptionKey(option) === moduleKey
      );

      if (matchedOption) {
        nextRows[index] = {
          moduleKey,
          customModuleCode: "",
          studyTerm: module.studyTerm ?? "",
        };
        return;
      }

      nextRows[index] = {
        moduleKey: MANUAL_BRIDGING_MODULE_KEY,
        customModuleCode: module.moduleCode,
        studyTerm: module.studyTerm ?? "",
      };
    });

    setBridgingRows(nextRows);
  }, [isDegree, bridgingOptions, modules]);

  async function handleLoadModules() {
    if (!student.programmeCode) {
      alert("Please select Programme Code first.");
      return;
    }

    if (!student.programmeStream) {
      alert("Please select Programme Stream first.");
      return;
    }

    console.log("[StudyPlan] Loading programme modules with:", {
      programmeCode: student.programmeCode,
      programmeStream: student.programmeStream,
      includedStreams: [student.programmeStream, "nil"],
    });

    setLoadingModules(true);

    try {
      const hadExistingModules = modules.length > 0;

      if (
        hadExistingModules &&
        !window.confirm(
          [
            "载入 programme modules 会替换当前列表中的 programme 阶段模块。",
            "",
            "若学生为重新入学：请先确认 intake / bridging，再按 Generate 分配 study term，最后 Save。",
            "不在列表中的旧修课记录会在 Save 时从数据库删除。",
            "",
            "是否继续载入？",
          ].join("\n")
        )
      ) {
        return;
      }

      const loaded = await loadProgrammeModules(
        student.programmeCode,
        student.programmeStream
      );

      /**
       * Important for Degree:
       * Loading programme modules should not remove confirmed bridging modules.
       */
      if (isDegree) {
        setModules((prev) => {
          const existingBridgingModules = prev.filter(
            (module) => module.planStage === "bridging"
          );

          const existingProgrammeByKey = new Map(
            prev
              .filter((module) => module.planStage === "programme")
              .map((module) => [
                buildStudyPlanModulePersistKey({
                  moduleCode: module.moduleCode,
                  programmeCode:
                    module.programmeCode || student.programmeCode,
                  programmeStream:
                    module.programmeStream || student.programmeStream,
                  planStage: "programme",
                }),
                module,
              ] as const)
          );

          const mergedProgrammeModules = loaded.map((template) =>
            mergeLoadedProgrammeModule(
              template,
              existingProgrammeByKey.get(
                buildStudyPlanModulePersistKey({
                  moduleCode: template.moduleCode,
                  programmeCode:
                    template.programmeCode || student.programmeCode,
                  programmeStream:
                    template.programmeStream || student.programmeStream,
                  planStage: "programme",
                })
              ),
              student
            )
          );

          return sortModulesForStudyPlan([
            ...existingBridgingModules,
            ...mergedProgrammeModules,
          ]);
        });
      } else {
        setModules((prev) => {
          const existingByKey = new Map(
            prev.map((module) => [
              buildStudyPlanModulePersistKey({
                moduleCode: module.moduleCode,
                programmeCode:
                  module.programmeCode || student.programmeCode,
                programmeStream:
                  module.programmeStream || student.programmeStream,
                planStage: module.planStage ?? "programme",
              }),
              module,
            ])
          );

          return sortModulesForStudyPlan(
            loaded.map((template) =>
              mergeLoadedProgrammeModule(
                template,
                existingByKey.get(
                  buildStudyPlanModulePersistKey({
                    moduleCode: template.moduleCode,
                    programmeCode:
                      template.programmeCode || student.programmeCode,
                    programmeStream:
                      template.programmeStream || student.programmeStream,
                    planStage: template.planStage ?? "programme",
                  })
                ),
                student
              )
            )
          );
        });
      }

      if (loaded.length === 0) {
        alert(
          [
            "No modules found for the selected Programme Code and Stream.",
            "",
            `Programme Code: ${student.programmeCode}`,
            `Programme Stream: ${
              selectedProgrammeOption?.programmeStream ??
              student.programmeStream
            }`,
            "",
            "Please check whether the selected programme and stream have modules configured.",
          ].join("\n")
        );
        return;
      }

      alert(`Loaded ${loaded.length} programme module(s).`);
    } catch (error) {
      console.error("[StudyPlan] Failed to load programme modules:", error);

      const message =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String((error as { message?: unknown }).message)
            : "Unknown error while loading programme modules.";

      alert(`Failed to load programme modules:\n\n${message}`);
    } finally {
      setLoadingModules(false);
    }
  }

  function handleConfirmBridgingModules() {
    if (!isDegree) return;

    const selectedModules: StudyPlanModule[] = [];
    const seenModuleCodes = new Set<string>();

    for (let index = 0; index < bridgingRows.length; index += 1) {
      const row = bridgingRows[index];

      const isManual = row.moduleKey === MANUAL_BRIDGING_MODULE_KEY;
      const studyTerm = row.studyTerm.trim().toUpperCase();
      const manualModuleCode = row.customModuleCode.trim().toUpperCase();
      const catalogModuleKey = row.moduleKey.trim();

      if (isManual) {
        if (!manualModuleCode && !studyTerm) {
          continue;
        }
      } else if (!catalogModuleKey && !studyTerm) {
        continue;
      }

      let resolvedModuleCode = manualModuleCode;

      if (isManual) {
        if (manualModuleCode && !studyTerm) {
          alert(`Bridging module ${index + 1} has module code but no study term.`);
          return;
        }

        if (!manualModuleCode && studyTerm) {
          alert(`Bridging module ${index + 1} has study term but no module code.`);
          return;
        }
      } else {
        if (catalogModuleKey && !studyTerm) {
          alert(`Bridging module ${index + 1} has module code but no study term.`);
          return;
        }

        if (!catalogModuleKey && studyTerm) {
          alert(`Bridging module ${index + 1} has study term but no module code.`);
          return;
        }
      }

      if (!/^T\d{4}[ABC]$/i.test(studyTerm)) {
        alert(
          `Bridging module ${index + 1} has invalid study term "${studyTerm}". Expected format like T2027A.`
        );
        return;
      }

      let matched: StudyPlanModule | undefined;

      if (isManual) {
        if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/i.test(manualModuleCode)) {
          alert(
            `Bridging module ${index + 1} has invalid module code "${manualModuleCode}".`
          );
          return;
        }

        resolvedModuleCode = manualModuleCode;
      } else {
        matched = bridgingOptions.find(
          (module) => buildModuleOptionKey(module) === catalogModuleKey
        );

        if (!matched) {
          alert(`Bridging module ${index + 1} is not a valid option.`);
          return;
        }

        resolvedModuleCode = matched.moduleCode.trim().toUpperCase();
      }

      if (seenModuleCodes.has(resolvedModuleCode)) {
        alert(
          `Bridging module ${index + 1} duplicates module code "${resolvedModuleCode}".`
        );
        return;
      }

      seenModuleCodes.add(resolvedModuleCode);

      if (isManual) {
        selectedModules.push({
          moduleCode: resolvedModuleCode,
          moduleName: resolvedModuleCode,
          programmeCode: student.programmeCode,
          programmeStream: student.programmeStream,
          studentId: student.studentId,
          studentProfileId: student.id,
          planStage: "bridging",
          status: "planned",
          studyTerm,
          isExempted: false,
          isFailed: false,
          isLocked: false,
        });
        continue;
      }

      selectedModules.push({
        ...matched!,

        id: undefined,
        studentId: student.studentId,
        studentProfileId: student.id,

        planStage: "bridging",
        status: "planned",
        studyTerm,

        isExempted: false,
        isFailed: false,
        isLocked: false,
      });
    }

    setModules((prev) => {
      const nonBridgingModules = prev.filter(
        (module) => module.planStage !== "bridging"
      );

      return sortModulesForStudyPlan([...selectedModules, ...nonBridgingModules]);
    });

    alert(`Confirmed ${selectedModules.length} bridging module(s).`);
  }

  async function handleGenerate() {
    if (!student.programmeCode) {
      alert("Please select Programme Code first.");
      return;
    }

    if (!student.programmeStream) {
      alert("Please select Programme Stream first.");
      return;
    }

    if (!student.intakeTerm) {
      alert("Please enter Intake Term first.");
      return;
    }

    const existingBridgingModules = modules.filter(
      (module) => module.planStage === "bridging"
    );

    const programmeModules = modules.filter(
      (module) => module.planStage === "programme"
    );

    if (programmeModules.length === 0) {
      alert(
        "No programme modules loaded. Please click Load Programme Modules first."
      );
      return;
    }

    let effectiveStartTerm = student.intakeTerm;

    if (isDegree) {
      effectiveStartTerm = getDegreeStartTermAfterBridging(
        existingBridgingModules,
        student.intakeTerm
      );
    }

    const generatedProgrammeModules = generateStudyPlanForStudent({
      student,
      modules: programmeModules,
      startTerm: effectiveStartTerm,
    });

    const generated = isDegree
      ? sortModulesForStudyPlan([
          ...existingBridgingModules,
          ...generatedProgrammeModules,
        ])
      : generatedProgrammeModules;

    setModules(generated);

    const assignedCount = generated.filter(
      (module) => module.status === "planned" && !!module.studyTerm
    ).length;

    const programmeAssignedCount = generated.filter(
      (module) =>
        module.planStage === "programme" &&
        module.status === "planned" &&
        !!module.studyTerm
    ).length;

    if (assignedCount === 0) {
      alert(
        [
          "Generate completed, but no study terms were assigned.",
          "",
          "Please check:",
          "- Intake Term format, e.g. T2026A / T2026C",
          "- modules.module_year values",
          "- modules.module_term values, e.g. Sep / Feb / Jun",
          "- whether the selected programme has modules configured",
        ].join("\n")
      );
      return;
    }

    if (isDegree) {
      alert(
        [
          "Degree study plan generated.",
          "",
          `Degree start term: ${effectiveStartTerm}`,
          `Confirmed bridging modules: ${existingBridgingModules.length}`,
          `Assigned degree programme modules: ${programmeAssignedCount}`,
        ].join("\n")
      );
      return;
    }

    alert(`Study plan generated. Assigned ${assignedCount} module(s).`);
  }

  async function handleExportStudyPlan() {
    if (!student.id) {
      alert("Please save this student study plan before exporting.");
      return;
    }

    setExporting(true);

    try {
      const result = await downloadStudyPlanCsv({
        scope: "student",
        studentProfileId: student.id,
      });

      alert(`Exported study plan to ${result.fileName}.`);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown error while exporting study plan.";

      alert(`Failed to export study plan:\n\n${message}`);
    } finally {
      setExporting(false);
    }
  }

  async function handleUpdateModuleRow(index: number) {
    let current: StudyPlanModule | undefined;

    setModules((prev) => {
      current = prev[index];
      return prev;
    });

    if (!current) return;

    const userModuleCode = String(current.moduleCode ?? "")
      .trim()
      .toUpperCase();

    if (!student.id) {
      alert("Save the student profile before updating a module row.");
      return;
    }

    if (!userModuleCode) {
      alert("Module code is required.");
      return;
    }

    if (current.status === "planned" && !current.studyTerm) {
      alert(`Module ${userModuleCode} is planned but has no study term.`);
      return;
    }

    const rowSnapshot = current;
    const rowId = rowSnapshot.id;
    setRowActionIndex(index);

    try {
      const fields = await buildStudyPlanModuleFieldsFromCode({
        moduleCode: userModuleCode,
        programmeCode: student.programmeCode,
        programmeStream: student.programmeStream,
        current: rowSnapshot,
      });

      const merged: StudyPlanModule = {
        ...rowSnapshot,
        ...fields,
        moduleCode: userModuleCode,
        status: rowSnapshot.status,
        studyTerm: rowSnapshot.studyTerm,
        isLocked: rowSnapshot.isLocked,
        isExempted: rowSnapshot.isExempted,
        isFailed: rowSnapshot.isFailed,
        remark: rowSnapshot.remark,
        planStage: rowSnapshot.planStage,
        id: rowSnapshot.id,
      };

      const { id: savedId, module: savedModule } =
        await upsertStudyPlanModuleRow(student, merged);

      setModules((prev) => {
        const resolvedIndex =
          rowId !== undefined && rowId !== ""
            ? prev.findIndex((module) => module.id === rowId)
            : index;

        if (resolvedIndex < 0) {
          return prev;
        }

        return prev.map((module, rowIndex) =>
          rowIndex === resolvedIndex
            ? {
                ...savedModule,
                id: savedId,
                moduleCode: userModuleCode,
                status: rowSnapshot.status,
                studyTerm: rowSnapshot.studyTerm,
                isLocked: rowSnapshot.isLocked,
                isExempted: rowSnapshot.isExempted,
                isFailed: rowSnapshot.isFailed,
                remark: rowSnapshot.remark,
              }
            : module
        );
      });
    } catch (error) {
      console.error("[StudyPlan] Failed to update module row:", error);
      alert(
        `Failed to update module row:\n\n${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    } finally {
      setRowActionIndex(null);
    }
  }

  async function handleDeleteModuleRow(index: number) {
    const current = modules[index];

    if (!current) return;

    if (current.isLocked) {
      alert("Locked modules cannot be deleted.");
      return;
    }

    const label = current.moduleCode || "this module";

    if (!window.confirm(`Remove ${label} from this study plan?`)) {
      return;
    }

    setRowActionIndex(index);

    try {
      if (current.id) {
        await deleteStudyPlanModuleById(current.id);
      }

      setModules((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
    } catch (error) {
      console.error("[StudyPlan] Failed to delete module row:", error);
      alert(
        `Failed to delete module row:\n\n${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    } finally {
      setRowActionIndex(null);
    }
  }

  function validateStudentProfileFields(): boolean {
    if (!student.studentId || !student.studentName || !student.programmeCode) {
      alert("Student ID, Student Name and Programme Code are required.");
      return false;
    }

    if (!student.programmeStream) {
      alert("Programme Stream is required.");
      return false;
    }

    if (!student.intakeTerm) {
      alert("Intake Term is required.");
      return false;
    }

    return true;
  }

  async function handleSaveProfile() {
    if (!validateStudentProfileFields()) {
      return;
    }

    setSavingProfile(true);

    try {
      const studentWithType = await attachProgrammeTypeToStudent({
        ...student,
        programmeType: selectedProgrammeType ?? student.programmeType,
      });

      const saved = await saveStudyPlanStudentProfile(studentWithType);
      setStudent(saved);
      alert("學生檔案已保存。");
    } catch (error) {
      console.error("[StudyPlan] Failed to save student profile:", error);
      alert(
        `Failed to save student profile:\n\n${formatStudyPlanSaveError(error)}`
      );
    } finally {
      setSavingProfile(false);
    }
  }

  function validateStudyPlanModuleFields(): boolean {
    const emptyCode = modules.find(
      (module) => !String(module.moduleCode ?? "").trim()
    );

    if (emptyCode) {
      alert("Each module row must have a module code before saving.");
      return false;
    }

    const invalid = modules.find(
      (module) => module.status === "planned" && !module.studyTerm
    );

    if (invalid) {
      alert(`Module ${invalid.moduleCode} is planned but has no study term.`);
      return false;
    }

    return true;
  }

  async function handleSaveModules() {
    if (!validateStudentProfileFields()) {
      return;
    }

    if (!validateStudyPlanModuleFields()) {
      return;
    }

    setSavingModules(true);
    setRowActionIndex(null);

    try {
      const studentWithType = await attachProgrammeTypeToStudent({
        ...student,
        programmeType: selectedProgrammeType ?? student.programmeType,
      });

      const saved = await saveStudyPlanModules(studentWithType, modules);
      setStudent(saved);
      await onSaved();
    } catch (error) {
      console.error("[StudyPlan] Failed to save study plan modules:", error);

      alert(
        `Failed to save study plan:\n\n${formatStudyPlanSaveError(error)}`
      );
    } finally {
      setSavingModules(false);
    }
  }

  function updateStudent<K extends keyof StudyPlanStudent>(
    key: K,
    value: StudyPlanStudent[K]
  ) {
    setStudent((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function handleProgrammeCodeChange(programmeCode: string) {
    const programmeType = programmeOptions.find(
      (item) => item.programmeCode === programmeCode
    )?.programmeType;
    const defaultStream = resolveDefaultProgrammeStream(
      programmeCode,
      programmeOptions
    );

    setStudent((prev) => ({
      ...prev,
      programmeCode,
      programmeStream: defaultStream,
      programmeType,
      intakeLevel:
        prev.intakeLevel && prev.intakeLevel !== ""
          ? prev.intakeLevel
          : isDegreeProgramme(programmeCode, programmeType)
            ? "Y3"
            : "Y1",
    }));

    setModules([]);
    setBridgingRows(createEmptyBridgingRows());
    setBridgingOptions([]);
  }

  function handleProgrammeStreamChange(programmeStream: string) {
    const programmeType =
      selectedProgrammeOption?.programmeType ??
      programmeOptions.find((item) => item.programmeCode === student.programmeCode)
        ?.programmeType;

    setStudent((prev) => ({
      ...prev,
      programmeStream,
      programmeType: programmeType ?? prev.programmeType,
    }));

    setModules([]);
    setBridgingRows(createEmptyBridgingRows());
    setBridgingOptions([]);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border p-4 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Student Profile</h2>
          <p className="text-sm text-muted-foreground">
            Edit student profile and load programme modules.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="space-y-1">
            <span className="text-sm font-medium">Student ID</span>
            <input
              className="w-full border rounded-md px-3 py-2"
              value={student.studentId}
              onChange={(event) =>
                updateStudent("studentId", event.target.value)
              }
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium">Student Name</span>
            <input
              className="w-full border rounded-md px-3 py-2"
              value={student.studentName}
              onChange={(event) =>
                updateStudent("studentName", event.target.value)
              }
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium">Intake Term</span>
            <input
              className="w-full border rounded-md px-3 py-2"
              value={student.intakeTerm ?? ""}
              onChange={(event) =>
                updateStudent("intakeTerm", event.target.value.toUpperCase())
              }
              placeholder="T2026A"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium">Intake Level</span>
            <select
              className="w-full border rounded-md px-3 py-2"
              value={
                normalizeIntakeLevel(student.intakeLevel) ??
                (isDegree ? "Y3" : "Y1")
              }
              onChange={(event) =>
                updateStudent("intakeLevel", event.target.value)
              }
            >
              {INTAKE_LEVEL_OPTIONS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium">Study Mode</span>
            <select
              className="w-full border rounded-md px-3 py-2"
              value={student.studyMode}
              onChange={(event) =>
                updateStudent("studyMode", event.target.value as "FT" | "PT")
              }
            >
              <option value="FT">FT</option>
              <option value="PT">PT</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium">Programme Code</span>
            <select
              className="w-full border rounded-md px-3 py-2"
              value={student.programmeCode}
              onChange={(event) =>
                handleProgrammeCodeChange(event.target.value)
              }
              disabled={loadingProgrammes}
            >
              <option value="">
                {loadingProgrammes
                  ? "Loading programmes..."
                  : "Select Programme"}
              </option>

              {programmeCodeOptions.map((item) => (
                <option
                  key={item.programmeCode}
                  value={item.programmeCode}
                >
                  {item.programmeName
                    ? `${item.programmeCode} - ${item.programmeName}`
                    : item.programmeCode}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium">Programme Stream</span>
            <select
              className="w-full border rounded-md px-3 py-2"
              value={student.programmeStream ?? ""}
              onChange={(event) =>
                handleProgrammeStreamChange(event.target.value)
              }
              disabled={!student.programmeCode || loadingProgrammes}
            >
              <option value="">
                {!student.programmeCode
                  ? "Select Programme first"
                  : "Select Programme Stream"}
              </option>

              {streamOptions.map((option) => (
                <option
                  key={`${option.programmeCode}-${option.programmeStream}`}
                  value={option.programmeStream}
                >
                  {option.programmeStream && option.programmeStream !== "nil"
                    ? option.programmeStream
                    : "General"}
                </option>
              ))}
            </select>
          </label>

          {isHd && (
            <label className="space-y-1">
              <span className="text-sm font-medium">
                原校升學{" "}
                <span className="font-normal text-muted-foreground">
                  Articulation
                </span>
              </span>
              <select
                className="w-full border rounded-md px-3 py-2"
                value={student.okToArticulate !== false ? "yes" : "no"}
                onChange={(event) =>
                  updateStudent(
                    "okToArticulate",
                    event.target.value === "yes"
                  )
                }
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
              <p className="text-xs text-muted-foreground">
                No 時不計入 Degree 新入學報表（原校升學人數）；不影響修課計劃與其他匯出。
              </p>
            </label>
          )}

          <label className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium">remark1</span>
            <input
              className="w-full border rounded-md px-3 py-2"
              value={student.remark1 ?? ""}
              onChange={(event) =>
                updateStudent("remark1", event.target.value)
              }
              placeholder="Optional note for this student"
            />
          </label>

          <label className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium">remark2</span>
            <input
              className="w-full border rounded-md px-3 py-2"
              value={student.remark2 ?? ""}
              onChange={(event) =>
                updateStudent("remark2", event.target.value)
              }
              placeholder="Optional second note"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <button
            type="button"
            className="px-4 py-2 rounded-md bg-slate-700 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSaveProfile}
            disabled={savingProfile || savingModules}
          >
            {savingProfile ? "保存中..." : "保存學生檔案"}
          </button>
          <p className="text-xs text-muted-foreground">
            僅保存上方學生資料；修改修課表後請用下方「保存修課計劃」。
          </p>
        </div>

        {isDegree && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-blue-900">
                Bridging Modules
              </h3>

              <p className="text-xs text-blue-800">
                Select up to 7 bridging modules before generating Degree
                modules. Choose from the articulated HD list, or enter a module
                code manually when it is not listed.
              </p>

              <p className="mt-1 text-xs text-blue-800">
                If no bridging module is selected, Degree modules will start
                from the student&apos;s intake term. If bridging modules are
                selected, Degree modules will start after the last bridging
                study term.
              </p>
            </div>

            {loadingBridgingOptions && (
              <div className="text-xs text-blue-700">
                Loading bridging module options...
              </div>
            )}

            {!loadingBridgingOptions &&
              student.programmeCode &&
              student.programmeStream &&
              bridgingOptions.length === 0 && (
                <div className="rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                  No bridging module options found from articulated HD
                  programmes. You can still enter module codes manually below.
                </div>
              )}

            <div className="space-y-2">
              {bridgingRows.map((row, index) => (
                <div
                  key={`bridging-${index}`}
                  className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_180px_80px] items-center"
                >
                  <div className="space-y-2">
                    <select
                      className="w-full rounded-md border px-3 py-2 text-sm bg-white"
                      value={row.moduleKey}
                      disabled={loadingBridgingOptions}
                      onChange={(event) => {
                        const value = event.target.value;

                        setBridgingRows((prev) =>
                          prev.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  moduleKey: value,
                                  customModuleCode:
                                    value === MANUAL_BRIDGING_MODULE_KEY
                                      ? item.customModuleCode
                                      : "",
                                }
                              : item
                          )
                        );
                      }}
                    >
                      <option value="">
                        Bridging module {index + 1} - Select module
                      </option>

                      {bridgingOptions.map((module) => {
                        const key = buildModuleOptionKey(module);

                        return (
                          <option key={key} value={key}>
                            {module.moduleCode} - {module.moduleName}
                            {module.moduleTerm ? ` (${module.moduleTerm})` : ""}
                            {module.programmeCode
                              ? ` [${module.programmeCode}${
                                  module.programmeStream
                                    ? ` / ${module.programmeStream}`
                                    : ""
                                }]`
                              : ""}
                          </option>
                        );
                      })}

                      <option value={MANUAL_BRIDGING_MODULE_KEY}>
                        Enter module code manually
                      </option>
                    </select>

                    {row.moduleKey === MANUAL_BRIDGING_MODULE_KEY && (
                      <input
                        className="w-full rounded-md border px-3 py-2 text-sm bg-white"
                        value={row.customModuleCode}
                        placeholder="e.g. AF401"
                        onChange={(event) => {
                          const value = event.target.value.toUpperCase();

                          setBridgingRows((prev) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    customModuleCode: value,
                                  }
                                : item
                            )
                          );
                        }}
                      />
                    )}
                  </div>

                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm bg-white"
                    value={row.studyTerm}
                    placeholder="e.g. T2027A"
                    onChange={(event) => {
                      const value = event.target.value.toUpperCase();

                      setBridgingRows((prev) =>
                        prev.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                studyTerm: value,
                              }
                            : item
                        )
                      );
                    }}
                  />

                  <button
                    type="button"
                    className="rounded-md bg-white border px-3 py-2 text-xs hover:bg-gray-50"
                    onClick={() => {
                      setBridgingRows((prev) =>
                        prev.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                moduleKey: "",
                                customModuleCode: "",
                                studyTerm: "",
                              }
                            : item
                        )
                      );
                    }}
                  >
                    Clear
                  </button>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded-md bg-blue-700 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleConfirmBridgingModules}
                disabled={loadingBridgingOptions}
              >
                Confirm Bridging Modules
              </button>

              <div className="text-xs text-blue-800 self-center">
                Confirm bridging modules first, then click Load Programme
                Modules and Generate Study Plan.
              </div>
            </div>

            {confirmedBridgingModules.length > 0 && (
              <div className="rounded border border-blue-100 bg-white px-3 py-2 text-xs text-blue-900">
                Confirmed bridging modules:{" "}
                <span className="font-semibold">
                  {confirmedBridgingModules.length}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="px-4 py-2 rounded-md bg-muted text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleLoadModules}
            disabled={!canLoadProgrammeModules}
          >
            {loadingModules ? "Loading modules..." : "Load Programme Modules"}
          </button>

          <button
            type="button"
            className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm"
            onClick={handleGenerate}
          >
            Generate Study Plan
          </button>

          <button
            type="button"
            className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleExportStudyPlan}
            disabled={exporting || !student.id}
          >
            {exporting ? "Exporting..." : "Export CSV"}
          </button>

        </div>
      </div>

      <StudyPlanSummaryPanel student={student} modules={modules} />

      <ModulePlanTable
        modules={modules}
        onChange={setModules}
        programmeCode={student.programmeCode}
        programmeStream={student.programmeStream}
        enrollmentInstances={enrollmentInstances}
        onUpdateRow={handleUpdateModuleRow}
        onDeleteRow={handleDeleteModuleRow}
        rowActionIndex={rowActionIndex}
        saving={savingModules || savingProfile}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleSaveModules}
          disabled={savingModules || savingProfile}
        >
          {savingModules ? "保存中..." : "保存修課計劃"}
        </button>
        <p className="text-xs text-muted-foreground">
          保存模組列表並依模組重算學習狀態；亦會寫入目前畫面上的學生資料。只改檔案時用「保存學生檔案」即可。
        </p>
      </div>
    </div>
  );
}
