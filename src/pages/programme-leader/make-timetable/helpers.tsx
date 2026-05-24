export function normalizeDisplayText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

export function isCommonStreamDisplay(streamCode: string | null | undefined) {
  const text = normalizeDisplayText(streamCode).toLowerCase();

  return text === "" || text === "nil";
}

export function displayStream(streamCode: string | null | undefined) {
  return isCommonStreamDisplay(streamCode)
    ? "All Streams"
    : normalizeDisplayText(streamCode);
}

export function normalizeCompareText(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export function renderModuleCodeAndName(row: {
  module_code?: string | null;
  module_name?: string | null;
}) {
  return (
    <div>
      <div className="font-medium">{row.module_code ?? "-"}</div>
      <div className="text-xs text-slate-500">{row.module_name ?? "-"}</div>
    </div>
  );
}

export function renderModuleInstanceAndName(row: {
  module_instance_code?: string | null;
  module_name?: string | null;
}) {
  return (
    <div>
      <div className="font-medium">{row.module_instance_code ?? "-"}</div>
      <div className="text-xs text-slate-500">{row.module_name ?? "-"}</div>
    </div>
  );
}
