import { useEffect, useMemo, useState } from "react";

import type { StudyPlanModule, StudyPlanStudent } from "../types";

import {
  listProgrammeOptions,
  loadProgrammeModules,
  loadBridgingModuleOptionsForDegree,
  saveStudyPlan,
  formatStudyPlanSaveError,
  type ProgrammeOption,
} from "../../../../services/studyPlanService";

import {
  getDegreeStartTermAfterBridging,
  generateStudyPlanForStudent,
} from "../studyPlanRules";

import ModulePlanTable from "./ModulePlanTable";
import StudyPlanSummaryPanel from "./StudyPlanSummaryPanel";
import { isDegreeProgramme } from "../helpers";

interface Props {
  initialStudent: StudyPlanStudent;
  initialModules: StudyPlanModule[];
  onSaved: () => Promise<void>;
}

interface BridgingRow {
  moduleKey: string;
  studyTerm: string;
}

function createEmptyBridgingRows(): BridgingRow[] {
  return Array.from({ length: 7 }, () => ({
    moduleKey: "",
    studyTerm: "",
  }));
}

function normalizeStreamForCompare(value?: string | null): string {
  return String(value ?? "nil").trim() || "nil";
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
  onSaved,
}: Props) {
  const [student, setStudent] = useState<StudyPlanStudent>(initialStudent);
  const [modules, setModules] = useState<StudyPlanModule[]>(initialModules);

  const [saving, setSaving] = useState(false);
  const [loadingModules, setLoadingModules] = useState(false);

  const [programmeOptions, setProgrammeOptions] = useState<ProgrammeOption[]>(
    []
  );
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
}, [initialStudent, initialModules]);


  const selectedProgrammeType = useMemo(() => {
    return programmeOptions.find(
      (item) => item.programmeCode === student.programmeCode
    )?.programmeType;
  }, [programmeOptions, student.programmeCode]);

  const isDegree = useMemo(
    () => isDegreeProgramme(student.programmeCode, selectedProgrammeType),
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

useEffect(() => {
  console.log("[StudyPlan] Stream select debug:", {
    initialStudentProgrammeCode: initialStudent.programmeCode,
    initialStudentProgrammeStream: initialStudent.programmeStream,

    studentProgrammeCode: student.programmeCode,
    studentProgrammeStream: student.programmeStream,

    programmeOptionsCount: programmeOptions.length,

    programmeOptionsForHDC: programmeOptions
      .filter(
        (option) =>
          String(option.programmeCode ?? "").trim().toUpperCase() === "HDC"
      )
      .map((option) => ({
        programmeCode: option.programmeCode,
        programmeStream: option.programmeStream,
        programmeName: option.programmeName,
        codeLength: String(option.programmeCode ?? "").length,
        streamLength: String(option.programmeStream ?? "").length,
      })),

    streamOptions: streamOptions.map((option) => ({
      programmeCode: option.programmeCode,
      programmeStream: option.programmeStream,
      programmeName: option.programmeName,
      equal:
        option.programmeStream === student.programmeStream,
      normalizedEqual:
        normalizeStreamForCompare(option.programmeStream) ===
        normalizeStreamForCompare(student.programmeStream),
    })),

    selectedProgrammeOption,
    selectValue:
      selectedProgrammeOption?.programmeStream ??
      student.programmeStream ??
      "",
  });
}, [
  initialStudent,
  student.programmeCode,
  student.programmeStream,
  programmeOptions,
  streamOptions,
  selectedProgrammeOption,
]);


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
    if (!isDegree || bridgingOptions.length === 0) return;

    const existingBridgingModules = modules.filter(
      (module) => module.planStage === "bridging"
    );

    if (existingBridgingModules.length === 0) return;

    const nextRows = createEmptyBridgingRows();

    existingBridgingModules.slice(0, 7).forEach((module, index) => {
      nextRows[index] = {
        moduleKey: buildModuleOptionKey(module),
        studyTerm: module.studyTerm ?? "",
      };
    });

    setBridgingRows(nextRows);
  }, [isDegree, bridgingOptions.length, modules]);

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
      const loaded = await loadProgrammeModules(
        student.programmeCode,
        student.programmeStream
      );

      console.log("[StudyPlan] Loaded modules:", loaded);

      /**
       * Important for Degree:
       * Loading programme modules should not remove confirmed bridging modules.
       */
      if (isDegree) {
        setModules((prev) => {
          const existingBridgingModules = prev.filter(
            (module) => module.planStage === "bridging"
          );

          return [...existingBridgingModules, ...loaded];
        });
      } else {
        setModules(loaded);
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

    for (let index = 0; index < bridgingRows.length; index += 1) {
      const row = bridgingRows[index];

      const moduleKey = row.moduleKey.trim();
      const studyTerm = row.studyTerm.trim().toUpperCase();

      if (!moduleKey && !studyTerm) {
        continue;
      }

      if (moduleKey && !studyTerm) {
        alert(`Bridging module ${index + 1} has module code but no study term.`);
        return;
      }

      if (!moduleKey && studyTerm) {
        alert(`Bridging module ${index + 1} has study term but no module code.`);
        return;
      }

      if (!/^T\d{4}[ABC]$/i.test(studyTerm)) {
        alert(
          `Bridging module ${index + 1} has invalid study term "${studyTerm}". Expected format like T2027A.`
        );
        return;
      }

      const matched = bridgingOptions.find(
        (module) => buildModuleOptionKey(module) === moduleKey
      );

      if (!matched) {
        alert(`Bridging module ${index + 1} is not a valid option.`);
        return;
      }

      selectedModules.push({
        ...matched,

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

      return [...selectedModules, ...nonBridgingModules];
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
      ? [...existingBridgingModules, ...generatedProgrammeModules]
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

  async function handleSave() {
    if (!student.studentId || !student.studentName || !student.programmeCode) {
      alert("Student ID, Student Name and Programme Code are required.");
      return;
    }

    if (!student.programmeStream) {
      alert("Programme Stream is required.");
      return;
    }

    if (!student.intakeTerm) {
      alert("Intake Term is required.");
      return;
    }

    const invalid = modules.find(
      (module) => module.status === "planned" && !module.studyTerm
    );

    if (invalid) {
      alert(`Module ${invalid.moduleCode} is planned but has no study term.`);
      return;
    }

    setSaving(true);

    try {
      await saveStudyPlan(student, modules);
      await onSaved();
    } catch (error) {
      console.error("[StudyPlan] Failed to save study plan:", error);

      const message = formatStudyPlanSaveError(error);

      alert(`Failed to save study plan:\n\n${message}`);
    } finally {
      setSaving(false);
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

    setStudent((prev) => ({
      ...prev,
      programmeCode,
      programmeStream: "",
      programmeType,
      intakeLevel:
        prev.intakeLevel && prev.intakeLevel !== ""
          ? prev.intakeLevel
          : isDegreeProgramme(programmeCode, programmeType)
            ? "Year 3"
            : "Year 1",
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
              value={student.intakeLevel ?? (isDegree ? "Year 3" : "Year 1")}
              onChange={(event) =>
                updateStudent("intakeLevel", event.target.value)
              }
            >
              <option value="Year 1">Year 1</option>
              <option value="Year 2">Year 2</option>
              <option value="Year 3">Year 3</option>
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
        </div>

        {isDegree && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-blue-900">
                Bridging Modules
              </h3>

              <p className="text-xs text-blue-800">
                Select up to 7 bridging modules before generating Degree
                modules. Module options are loaded from the articulated HD
                programme and stream.
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
                  No bridging module options found. Please check whether any HD
                  programme stream has{" "}
                  <span className="font-mono">programmes.articulation</span>{" "}
                  pointing to this Degree programme, and whether related HD
                  modules exist.
                </div>
              )}

            <div className="space-y-2">
              {bridgingRows.map((row, index) => (
                <div
                  key={`bridging-${index}`}
                  className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_180px_80px] items-center"
                >
                  <select
                    className="w-full rounded-md border px-3 py-2 text-sm bg-white"
                    value={row.moduleKey}
                    disabled={
                      loadingBridgingOptions || bridgingOptions.length === 0
                    }
                    onChange={(event) => {
                      const value = event.target.value;

                      setBridgingRows((prev) =>
                        prev.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                moduleKey: value,
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
                  </select>

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
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Study Plan"}
          </button>
        </div>
      </div>

      <StudyPlanSummaryPanel student={student} modules={modules} />

      <ModulePlanTable modules={modules} onChange={setModules} />
    </div>
  );
}
