import { useEffect, useMemo, useState } from "react";

import type { StudyPlanModule, StudyPlanStudent } from "../types";

import {
  listProgrammeOptions,
  loadProgrammeModules,
  saveStudyPlan,
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

  const isDegree = useMemo(
    () => isDegreeProgramme(student.programmeCode),
    [student.programmeCode]
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
        item.programmeStream === student.programmeStream
    );
  }, [programmeOptions, student.programmeCode, student.programmeStream]);

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

      setModules(loaded);

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

      alert(`Loaded ${loaded.length} module(s).`);
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

  if (modules.length === 0) {
    alert("No modules loaded. Please click Load Programme Modules first.");
    return;
  }

  let effectiveStartTerm = student.intakeTerm;

  if (isDegree) {
    effectiveStartTerm = getDegreeStartTermAfterBridging(
      modules,
      student.intakeTerm
    );
  }

  const generated = generateStudyPlanForStudent({
    student,
    modules,
    startTerm: effectiveStartTerm,
  });

  setModules(generated);

  const assignedCount = generated.filter(
    (module) => module.status === "planned" && !!module.studyTerm
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

      const message =
        error instanceof Error
          ? error.message
          : "Unknown error while saving study plan.";

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
    setStudent((prev) => ({
      ...prev,
      programmeCode,
      programmeStream: "",
      intakeLevel:
        prev.intakeLevel && prev.intakeLevel !== ""
          ? prev.intakeLevel
          : isDegreeProgramme(programmeCode)
            ? "Year 3"
            : "Year 1",
    }));

    setModules([]);
  }

  function handleProgrammeStreamChange(programmeStream: string) {
    setStudent((prev) => ({
      ...prev,
      programmeStream,
    }));

    setModules([]);
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
                updateStudent("intakeTerm", event.target.value)
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

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="px-4 py-2 rounded-md bg-muted text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleLoadModules}
            disabled={
              loadingModules ||
              !student.programmeCode ||
              !student.programmeStream
            }
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
