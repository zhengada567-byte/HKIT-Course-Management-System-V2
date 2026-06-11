import type { Step } from "../types";

function stepRequiresProgramme(target: Step) {
  return target !== "student_numbers";
}

export function StepTabs({
  step,
  programmeSelected,
  teachersConfirmed,
  onStepChange,
}: {
  step: Step;
  programmeSelected: boolean;
  teachersConfirmed?: boolean;
  onStepChange: (next: Step) => void;
}) {
  const steps: Array<{ key: Step; label: string; locked?: boolean }> = [
    { key: "student_numbers", label: "1. 同步學生人數" },
    { key: "combine", label: "2. 合班" },
    { key: "split", label: "3. 分班" },
    { key: "teachers", label: "4. 確認老師" },
    {
      key: "schedule",
      label: "5. 排課（教室/日期）",
      locked: !teachersConfirmed,
    },
  ];

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {steps.map((item) => {
        const lockedByProgramme =
          !programmeSelected && stepRequiresProgramme(item.key);
        const locked = lockedByProgramme || Boolean(item.locked);

        return (
          <button
            key={item.key}
            type="button"
            className={
              step === item.key
                ? "btn btn-primary py-1 text-xs"
                : "btn btn-secondary py-1 text-xs"
            }
            disabled={locked}
            title={
              lockedByProgramme
                ? "Select a programme in step 1 before opening this step."
                : item.locked
                  ? "Confirm all teachers in step 4 before opening scheduling."
                  : undefined
            }
            onClick={() => onStepChange(item.key)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
