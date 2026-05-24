import type { StudyPlanModule, StudyPlanModuleStatus } from "../types";

interface Props {
  modules: StudyPlanModule[];
  onChange: (modules: StudyPlanModule[]) => void;
}

/** React row key (not DB identity). */
function getModuleIdentityKey(module: StudyPlanModule, index: number) {
  return [
    module.planStage,
    module.moduleCode,
    module.programmeCode,
    module.programmeStream || "nil",
    module.studyTerm ?? "",
    index,
  ]
    .map((value) => String(value ?? "").trim())
    .join("|");
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

export default function ModulePlanTable({ modules, onChange }: Props) {
  function updateModule(index: number, patch: Partial<StudyPlanModule>) {
    const next = [...modules];

    const merged = {
      ...next[index],
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

    next[index] = merged;
    onChange(next);
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
          </tr>
        </thead>

        <tbody>
          {modules.length === 0 && (
            <tr>
              <td className="p-3" colSpan={10}>
                No modules loaded.
              </td>
            </tr>
          )}

          {modules.map((module, index) => {
            const offeredTerm = getOfferedTerm(module);

            return (
              <tr
                key={getModuleIdentityKey(module, index)}
                className={`border-t ${getModuleRowClass(module)}`}
              >
                <td className="p-2">{module.planStage}</td>
                <td className="p-2 font-medium">{module.moduleCode}</td>
                <td className="p-2">{module.moduleName}</td>
                <td className="p-2">{module.moduleYear || "-"}</td>
                <td className="p-2">{offeredTerm || "-"}</td>
                <td className="p-2">{module.deliveryMode || "-"}</td>

                <td className="p-2">
                  <select
                    className="border rounded-md px-2 py-1"
                    value={module.status}
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
                    disabled={module.status === "exempted"}
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
                    onChange={(e) =>
                      updateModule(index, {
                        remark: e.target.value,
                      })
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
