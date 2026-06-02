import type { Step } from "../types";

export function StepTabs({
  step,
  setStep,
}: {
  step: Step;
  setStep: (step: Step) => void;
}) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: "student_numbers", label: "1. 同步學生人數" },
    { key: "combine", label: "2. 合班" },
    { key: "split", label: "3. 分班" },
    { key: "assignment", label: "4. 分配教師" },
    { key: "schedule", label: "5. 排課（教室/日期）" },
  ];

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {steps.map((item) => (
        <button
          key={item.key}
          type="button"
          className={
            step === item.key
              ? "btn btn-primary py-1 text-xs"
              : "btn btn-secondary py-1 text-xs"
          }
          onClick={() => setStep(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
