import type { StudyPlanModule, StudyPlanStudent } from "../types";
import { summarizeStudyPlan } from "../helpers";
import { getMaxModulesPerTerm } from "../studyPlanRules";

interface Props {
  student: StudyPlanStudent;
  modules: StudyPlanModule[];
}

export default function StudyPlanSummaryPanel({ student, modules }: Props) {
  const summary = summarizeStudyPlan(modules);

  const warnings: string[] = [];

  for (const [term, count] of Object.entries(summary.modulesPerTerm)) {
    const max = getMaxModulesPerTerm(student);

    if (count > max) {
      warnings.push(`${term}: ${count} modules exceeds max ${max}.`);
    }
  }

  return (
    <div className="rounded-md border p-4 space-y-3">
      <h3 className="font-semibold">Study Plan Summary</h3>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <div className="rounded-md bg-muted p-3">
          <div className="text-muted-foreground">Total Modules</div>
          <div className="text-xl font-bold">{summary.totalModules}</div>
        </div>

        <div className="rounded-md bg-muted p-3">
          <div className="text-muted-foreground">Exempted</div>
          <div className="text-xl font-bold">{summary.exemptedModules}</div>
        </div>

        <div className="rounded-md bg-muted p-3">
          <div className="text-muted-foreground">Planned</div>
          <div className="text-xl font-bold">{summary.plannedModules}</div>
        </div>

        <div className="rounded-md bg-muted p-3">
          <div className="text-muted-foreground">Failed</div>
          <div className="text-xl font-bold">{summary.failedModules}</div>
        </div>

        <div className="rounded-md bg-muted p-3">
          <div className="text-muted-foreground">Terms</div>
          <div className="text-xl font-bold">
            {Object.keys(summary.modulesPerTerm).length}
          </div>
        </div>
      </div>

      <div>
        <div className="text-sm font-medium mb-1">Modules Per Term</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(summary.modulesPerTerm).map(([term, count]) => (
            <span
              key={term}
              className="rounded-full bg-muted px-3 py-1 text-xs"
            >
              {term}: {count}
            </span>
          ))}
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-md bg-yellow-100 text-yellow-800 p-3 text-sm">
          <div className="font-semibold mb-1">Warnings</div>
          <ul className="list-disc pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
