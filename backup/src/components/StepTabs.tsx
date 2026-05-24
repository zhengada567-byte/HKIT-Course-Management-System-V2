import type { Step } from "../types";

export function StepTabs({
  step,
  setStep,
}: {
  step: Step;
  setStep: (step: Step) => void;
}) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: "planning", label: "1. Planning" },
    { key: "student_numbers", label: "2. Student Numbers" },
    { key: "combine", label: "3. Combine" },
    { key: "split", label: "4. Split" },
    { key: "assignment", label: "5. Assignment" },
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
