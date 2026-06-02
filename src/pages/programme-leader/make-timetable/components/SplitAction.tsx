import { useState } from "react";

export function SplitAction({
  expected,
  onNoSplit,
  onSplit,
}: {
  expected: number;
  onNoSplit: () => void;
  onSplit: (count: number) => void;
}) {
  const [count, setCount] = useState(2);
  const allowSplit = expected > 40;

  const safeCount = Number.isFinite(count) && count >= 2 ? count : 2;

  return (
    <div className="flex items-center gap-2">
      {allowSplit && (
        <>
          <input
            className="form-input w-20 py-1"
            type="number"
            min={2}
            value={count}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setCount(Number(event.target.value))}
          />

          <button
            type="button"
            className="btn btn-primary py-1 text-xs"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSplit(safeCount);
            }}
          >
            Split
          </button>
        </>
      )}

      <button
        type="button"
        className="btn btn-secondary py-1 text-xs"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onNoSplit();
        }}
      >
        No Split
      </button>
    </div>
  );
}
