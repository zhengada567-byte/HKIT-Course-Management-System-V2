import { useRef, useState, type Dispatch, type SetStateAction } from "react";

import { getBaseModuleCode } from "../../../../lib/studyPlanModuleCode";
import { lookupStudyPlanModuleMetadataByCode } from "../../../../services/studyPlanService";
import type { StudyPlanModule, StudyPlanModuleStatus } from "../types";

interface Props {
  modules: StudyPlanModule[];
  onChange: Dispatch<SetStateAction<StudyPlanModule[]>>;
  programmeCode: string;
  programmeStream?: string;
  onUpdateRow?: (index: number) => Promise<void>;
  onDeleteRow?: (index: number) => Promise<void>;
  rowActionIndex?: number | null;
  /** Whole-table save in progress — skip blur metadata writes. */
  saving?: boolean;
}

/** Stable React row key — must not include moduleCode (changes while typing). */
function getModuleRowKey(module: StudyPlanModule, index: number) {
  if (module.id) {
    return module.id;
  }

  return `draft-${module.planStage}-${index}`;
}

function getOfferedTerm(module: StudyPlanModule) {
  return module.moduleTerm || module.moduleTermPattern || "";
}

function getModuleRowClass(module: StudyPlanModule) {
  if (module.status === "failed") {
    return "bg-yellow-100";
  }

  if (module.status === "exempted") {
    return "bg-slate-100 text-slate-500";
  }

  const year = String(module.moduleYear ?? "")
    .trim()
    .toLowerCase();

  const term = getOfferedTerm(module)
    .trim()
    .toLowerCase();

  const yearNumberMatch = year.match(/\d+/);
  const yearNumber = yearNumberMatch?.[0];

  const isSep =
    term === "sep" ||
    term === "sept" ||
    term === "september" ||
    term.includes("sep") ||
    term.endsWith("a");

  const isFeb =
    term === "feb" ||
    term === "february" ||
    term.includes("feb") ||
    term.endsWith("b");

  if (yearNumber === "1" && isSep) return "module-row-y1-t1";
  if (yearNumber === "1" && isFeb) return "module-row-y1-t2";

  if (yearNumber === "2" && isSep) return "module-row-y2-t1";
  if (yearNumber === "2" && isFeb) return "module-row-y2-t2";

  if (yearNumber === "3" && isSep) return "module-row-y3-t1";
  if (yearNumber === "3" && isFeb) return "module-row-y3-t2";

  if (yearNumber === "4" && isSep) return "module-row-y4-t1";
  if (yearNumber === "4" && isFeb) return "module-row-y4-t2";

  return "";
}

export default function ModulePlanTable({
  modules,
  onChange,
  programmeCode,
  programmeStream,
  onUpdateRow,
  onDeleteRow,
  rowActionIndex = null,
  saving = false,
}: Props) {
  const [resolvingIndex, setResolvingIndex] = useState<number | null>(null);
  const resolveGenerationRef = useRef(0);

  function mergeModulePatch(
    row: StudyPlanModule,
    patch: Partial<StudyPlanModule>
  ): StudyPlanModule {
    const merged = {
      ...row,
      ...patch,
    };

    if (patch.status === "exempted") {
      merged.studyTerm = undefined;
      merged.isExempted = true;
      merged.isFailed = false;
    }

    if (patch.status === "planned") {
      merged.isExempted = false;
      merged.isFailed = false;
    }

    if (patch.status === "failed") {
      merged.isExempted = false;
      merged.isFailed = true;
    }

    return merged;
  }

  /** Functional update — avoids stale `modules` after save/reload. */
  function updateModule(index: number, patch: Partial<StudyPlanModule>) {
    onChange((prev) => {
      const row = prev[index];

      if (!row) {
        return prev;
      }

      const next = [...prev];
      next[index] = mergeModulePatch(row, patch);
      return next;
    });
  }

  /**
   * Apply metadata only if the row still matches (by id when present, else index + code).
   */
  function updateModuleIfRowMatches(
    index: number,
    rowId: string | undefined,
    expectedCode: string,
    patch:
      | Partial<StudyPlanModule>
      | ((row: StudyPlanModule) => Partial<StudyPlanModule>)
  ) {
    const normalizedExpected = expectedCode.trim().toUpperCase();

    onChange((prev) => {
      const resolvedIndex =
        rowId !== undefined && rowId !== ""
          ? prev.findIndex((row) => row.id === rowId)
          : index;

      if (resolvedIndex < 0) {
        return prev;
      }

      const row = prev[resolvedIndex];

      if (!row) {
        return prev;
      }

      const normalizedCurrent = String(row.moduleCode ?? "")
        .trim()
        .toUpperCase();

      if (normalizedCurrent !== normalizedExpected) {
        return prev;
      }

      const patchValue = typeof patch === "function" ? patch(row) : patch;
      const next = [...prev];
      next[resolvedIndex] = mergeModulePatch(row, {
        ...patchValue,
        moduleCode: normalizedExpected,
      });
      return next;
    });
  }

  async function resolveModuleMetadata(
    index: number,
    rowId: string | undefined,
    rawCode: string
  ) {
    if (saving || rowActionIndex !== null) {
      return;
    }

    const trimmed = String(rawCode ?? "").trim();

    /** Blur with empty code must not clear the row — validation happens on Update/Save. */
    if (!trimmed) {
      return;
    }

    const storedCode = trimmed.toUpperCase();
    const generation = ++resolveGenerationRef.current;

    setResolvingIndex(index);

    try {
      let metadata = await lookupStudyPlanModuleMetadataByCode({
        moduleCode: storedCode,
        programmeCode,
        programmeStream,
      });

      if (!metadata) {
        const baseCode = getBaseModuleCode(storedCode);
        if (baseCode && baseCode !== storedCode) {
          metadata = await lookupStudyPlanModuleMetadataByCode({
            moduleCode: baseCode,
            programmeCode,
            programmeStream,
          });
        }
      }

      if (generation !== resolveGenerationRef.current) {
        return;
      }

      if (!metadata) {
        updateModuleIfRowMatches(index, rowId, storedCode, {
          moduleName: "",
          moduleYear: undefined,
          moduleTerm: undefined,
          moduleTermPattern: undefined,
          sourceModuleId: undefined,
        });
        return;
      }

      updateModuleIfRowMatches(index, rowId, storedCode, (current) => ({
        moduleName: metadata!.moduleName,
        moduleYear: metadata!.moduleYear,
        moduleTerm: metadata!.moduleTerm,
        moduleTermPattern:
          metadata!.moduleTermPattern ?? metadata!.moduleTerm,
        sourceModuleId: metadata!.sourceModuleId,
        deliveryMode: metadata!.deliveryMode ?? current.deliveryMode,
        programmeCode: metadata!.programmeCode ?? current.programmeCode,
        programmeStream: metadata!.programmeStream ?? current.programmeStream,
      }));
    } finally {
      if (generation === resolveGenerationRef.current) {
        setResolvingIndex(null);
      }
    }
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="p-2 text-left">Stage</th>
            <th className="p-2 text-left">Module Code</th>
            <th className="p-2 text-left">Module Name</th>
            <th className="p-2 text-left">Year</th>
            <th className="p-2 text-left">Offered Term</th>
            <th className="p-2 text-left">Delivery</th>
            <th className="p-2 text-left">Status</th>
            <th className="p-2 text-left">Study Term</th>
            <th className="p-2 text-left">Locked</th>
            <th className="p-2 text-left">Remark</th>
            <th className="p-2 text-left">Actions</th>
          </tr>
        </thead>

        <tbody>
          {modules.length === 0 && (
            <tr>
              <td className="p-3" colSpan={11}>
                No modules loaded.
              </td>
            </tr>
          )}

          {modules.map((module, index) => {
            const offeredTerm = getOfferedTerm(module);
            const hasCatalogMetadata = Boolean(
              String(module.moduleName ?? "").trim() ||
                module.moduleYear ||
                offeredTerm
            );
            const rowBusy =
              saving ||
              rowActionIndex === index ||
              resolvingIndex === index;

            return (
              <tr
                key={getModuleRowKey(module, index)}
                className={`border-t ${getModuleRowClass(module)}`}
              >
                <td className="p-2">{module.planStage}</td>
                <td className="p-2">
                  <input
                    className="border rounded-md px-2 py-1 w-28 font-medium uppercase"
                    value={module.moduleCode ?? ""}
                    placeholder="HD401"
                    disabled={rowBusy}
                    onChange={(e) =>
                      updateModule(index, {
                        moduleCode: e.target.value.toUpperCase(),
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    onBlur={(e) => {
                      void resolveModuleMetadata(
                        index,
                        module.id,
                        e.target.value
                      );
                    }}
                  />
                </td>
                <td className="p-2">
                  {hasCatalogMetadata ? module.moduleName : "-"}
                </td>
                <td className="p-2">
                  {hasCatalogMetadata ? module.moduleYear || "-" : "-"}
                </td>
                <td className="p-2">
                  {hasCatalogMetadata ? offeredTerm || "-" : "-"}
                </td>
                <td className="p-2">
                  {hasCatalogMetadata ? module.deliveryMode || "-" : "-"}
                </td>

                <td className="p-2">
                  <select
                    className="border rounded-md px-2 py-1"
                    value={module.status}
                    disabled={saving}
                    onChange={(e) =>
                      updateModule(index, {
                        status: e.target.value as StudyPlanModuleStatus,
                      })
                    }
                  >
                    <option value="planned">Study Term</option>
                    <option value="exempted">Exempted</option>
                    <option value="failed">Failed</option>
                  </select>
                </td>

                <td className="p-2">
                  <input
                    className="border rounded-md px-2 py-1 w-28"
                    value={module.studyTerm ?? ""}
                    disabled={module.status === "exempted" || saving}
                    placeholder="T2026A"
                    onChange={(e) =>
                      updateModule(index, {
                        studyTerm: e.target.value || undefined,
                      })
                    }
                  />
                </td>

                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={module.isLocked}
                    disabled={saving}
                    onChange={(e) =>
                      updateModule(index, {
                        isLocked: e.target.checked,
                      })
                    }
                  />
                </td>

                <td className="p-2">
                  <input
                    className="border rounded-md px-2 py-1 min-w-40"
                    value={module.remark ?? ""}
                    disabled={rowBusy}
                    onChange={(e) =>
                      updateModule(index, {
                        remark: e.target.value,
                      })
                    }
                  />
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="rounded-md border px-2 py-1 text-xs disabled:opacity-50"
                      disabled={rowBusy || !onUpdateRow}
                      onMouseDown={(e) => {
                        e.preventDefault();
                      }}
                      onClick={() => {
                        void onUpdateRow?.(index);
                      }}
                    >
                      Update
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
                      disabled={rowBusy || !onDeleteRow}
                      onMouseDown={(e) => {
                        e.preventDefault();
                      }}
                      onClick={() => {
                        void onDeleteRow?.(index);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
