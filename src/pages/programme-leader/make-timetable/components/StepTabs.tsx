import type { Step } from "../types";

function stepRequiresProgramme(target: Step) {
  return target !== "student_numbers";
}

export function StepTabs({
  step,
  programmeSelected,
  onStepChange,
}: {
  step: Step;
  programmeSelected: boolean;
  onStepChange: (next: Step) => void;
}) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: "student_numbers", label: "1. 同步學生人數" },
    { key: "combine", label: "2. 合班" },
    { key: "split", label: "3. 分班" },
    { key: "schedule", label: "4. 排課（教室/日期）" },
  ];

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {steps.map((item) => {
        const locked =
          !programmeSelected && stepRequiresProgramme(item.key);

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
              locked
                ? "Select a programme in step 1 before opening this step."
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
