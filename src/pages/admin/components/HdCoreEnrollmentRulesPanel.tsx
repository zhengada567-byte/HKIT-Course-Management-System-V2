import { useEffect, useMemo, useState } from "react";

import { useLanguage } from "../../../contexts/LanguageContext";
import {
  applyHdCoreEnrollmentRules,
  listModuleInstanceCodes,
  listOfferedModulesForEnrollment,
  loadEnrollmentRules,
  loadHdCoreEnrollmentActualCounts,
  loadHdCoreEnrollmentStudentCounts,
  saveEnrollmentRules,
} from "../../../services/studyPlanCoreEnrollmentService";
import type { ModuleTerm } from "../../../types/common";

type HdCoreEnrollmentRulesPanelProps = {
  academicYear: string;
  offeredTerm: ModuleTerm;
};

function ruleStateKey(moduleCode: string, programmeCode: string) {
  return `${moduleCode}|${programmeCode}`;
}

type CoreModuleGroup = {
  id: string;
  label: string;
  moduleCodes: readonly string[];
};

export function HdCoreEnrollmentRulesPanel({
  academicYear,
  offeredTerm,
}: HdCoreEnrollmentRulesPanelProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [programmeCodesByModule, setProgrammeCodesByModule] = useState<
    Record<string, string[]>
  >({});
  const [moduleLabels, setModuleLabels] = useState<Record<string, string>>({});
  const [instanceCodesByModule, setInstanceCodesByModule] = useState<
    Record<string, string[]>
  >({});
  const [allowedByKey, setAllowedByKey] = useState<Record<string, string[]>>(
    {}
  );
  const [studentCountByKey, setStudentCountByKey] = useState<
    Record<string, number>
  >({});
  const [actualCountByKey, setActualCountByKey] = useState<
    Record<string, { ft: number; pt: number }>
  >({});

  const coreModuleGroups = useMemo<CoreModuleGroup[]>(() => {
    const moduleCodes = Object.keys(programmeCodesByModule).sort((a, b) =>
      a.localeCompare(b)
    );

    const has404 = moduleCodes.includes("HD404");
    const has408 = moduleCodes.includes("HD408");

    const groups: CoreModuleGroup[] = [];
    const seen = new Set<string>();

    for (const moduleCode of moduleCodes) {
      if (seen.has(moduleCode)) continue;

      if ((moduleCode === "HD404" || moduleCode === "HD408") && has404 && has408) {
        groups.push({
          id: "HD404_HD408",
          label: "HD404/HD408",
          moduleCodes: ["HD404", "HD408"],
        });
        seen.add("HD404");
        seen.add("HD408");
        continue;
      }

      groups.push({
        id: moduleCode,
        label: moduleLabels[moduleCode] ?? moduleCode,
        moduleCodes: [moduleCode],
      });
      seen.add(moduleCode);
    }

    return groups;
  }, [moduleLabels, programmeCodesByModule]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!academicYear.trim() || !offeredTerm) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setMessage("");
      setWarnings([]);

      try {
        const offered = await listOfferedModulesForEnrollment({
          academicYear,
          offeredTerm,
        });

        const moduleCodes = offered.map((row) => row.moduleCode);
        const programmesByModule: Record<string, string[]> = {};
        const labels: Record<string, string> = {};
        for (const row of offered) {
          programmesByModule[row.moduleCode] = row.programmeCodes;
          labels[row.moduleCode] = row.moduleName
            ? `${row.moduleCode} - ${row.moduleName}`
            : row.moduleCode;
        }

        const [instancesByModule, rules, studentCounts, actualCounts] = await Promise.all([
          listModuleInstanceCodes({
            academicYear,
            offeredTerm,
            moduleCodes,
          }),
          loadEnrollmentRules({
            academicYear,
            offeredTerm,
          }),
          loadHdCoreEnrollmentStudentCounts({
            academicYear,
            offeredTerm,
          }),
          loadHdCoreEnrollmentActualCounts({
            academicYear,
            offeredTerm,
          }),
        ]);

        if (cancelled) return;

        const savedRuleKeys = new Set(
          rules.map((rule) => ruleStateKey(rule.moduleCode, rule.programmeCode))
        );

        const nextAllowed: Record<string, string[]> = {};
        for (const rule of rules) {
          nextAllowed[ruleStateKey(rule.moduleCode, rule.programmeCode)] =
            rule.allowedInstanceCodes;
        }

        for (const moduleCode of moduleCodes) {
          const instances = instancesByModule[moduleCode] ?? [];
          for (const programmeCode of programmesByModule[moduleCode] ?? []) {
            const key = ruleStateKey(moduleCode, programmeCode);
            if (!savedRuleKeys.has(key)) {
              nextAllowed[key] = [...instances];
            }
          }
        }

        setProgrammeCodesByModule(programmesByModule);
        setModuleLabels(labels);
        setInstanceCodesByModule(instancesByModule);
        setAllowedByKey(nextAllowed);
        setStudentCountByKey(studentCounts);
        setActualCountByKey(actualCounts);
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error ? error.message : t.hdCoreEnrollmentLoadFailed
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [academicYear, offeredTerm, t.hdCoreEnrollmentLoadFailed]);

  function toggleAllowed(params: {
    moduleCodes: readonly string[];
    programmeCode: string;
    instanceCode: string;
    checked: boolean;
  }) {
    const next = { ...allowedByKey };

    for (const moduleCode of params.moduleCodes) {
      const key = ruleStateKey(moduleCode, params.programmeCode);
      const current = new Set(next[key] ?? []);

      if (params.checked) {
        current.add(params.instanceCode);
      } else {
        current.delete(params.instanceCode);
      }

      next[key] = [...current].sort();
    }

    setAllowedByKey(next);
  }

  function getGroupInstances(group: CoreModuleGroup) {
    return [
      ...new Set(
        group.moduleCodes.flatMap(
          (moduleCode) => instanceCodesByModule[moduleCode] ?? []
        )
      ),
    ].sort();
  }

  function getGroupProgrammeCodes(group: CoreModuleGroup) {
    return [
      ...new Set(
        group.moduleCodes.flatMap(
          (moduleCode) => programmeCodesByModule[moduleCode] ?? []
        )
      ),
    ].sort();
  }

  function getApplicableModuleCodesForProgramme(params: {
    group: CoreModuleGroup;
    programmeCode: string;
  }) {
    const programme = params.programmeCode;
    return params.group.moduleCodes.filter((moduleCode) =>
      (programmeCodesByModule[moduleCode] ?? []).includes(programme)
    );
  }

  function getGroupExpectedStudentNumber(group: CoreModuleGroup, programmeCode: string) {
    return group.moduleCodes.reduce((sum, moduleCode) => {
      const key = ruleStateKey(moduleCode, programmeCode);
      return sum + Number(studentCountByKey[key] ?? 0);
    }, 0);
  }

  function getGroupActual(group: CoreModuleGroup, programmeCode: string) {
    return group.moduleCodes.reduce(
      (sum, moduleCode) => {
        const key = ruleStateKey(moduleCode, programmeCode);
        const row = actualCountByKey[key] ?? { ft: 0, pt: 0 };
        return {
          ft: sum.ft + Number(row.ft ?? 0),
          pt: sum.pt + Number(row.pt ?? 0),
        };
      },
      { ft: 0, pt: 0 }
    );
  }

  async function handleSaveRules() {
    setSaving(true);
    setMessage("");
    setWarnings([]);

    try {
      const rules = coreModuleGroups.flatMap((group) =>
        group.moduleCodes.flatMap((moduleCode) =>
          (programmeCodesByModule[moduleCode] ?? []).map((programmeCode) => ({
            academicYear,
            moduleTerm: offeredTerm,
            moduleCode,
            programmeCode,
            allowedInstanceCodes:
              allowedByKey[ruleStateKey(moduleCode, programmeCode)] ?? [],
          }))
        )
      );

      await saveEnrollmentRules({
        academicYear,
        offeredTerm,
        rules,
      });

      setMessage(t.hdCoreEnrollmentSaved);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t.hdCoreEnrollmentSaveFailed
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleApplyRules() {
    const ok = window.confirm(t.hdCoreEnrollmentApplyConfirm);
    if (!ok) return;

    setApplying(true);
    setMessage("");
    setWarnings([]);

    try {
      const result = await applyHdCoreEnrollmentRules({
        academicYear,
        offeredTerm,
      });

      setMessage(
        `${t.hdCoreEnrollmentApplied}: ${result.assignedCount} · ${t.studyPlanEnrollmentWarnings}: ${result.warningCount}`
      );
      setWarnings(result.warnings.slice(0, 100));
      const studentCounts = await loadHdCoreEnrollmentStudentCounts({
        academicYear,
        offeredTerm,
      });
      setStudentCountByKey(studentCounts);
      const actualCounts = await loadHdCoreEnrollmentActualCounts({
        academicYear,
        offeredTerm,
      });
      setActualCountByKey(actualCounts);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t.hdCoreEnrollmentApplyFailed
      );
    } finally {
      setApplying(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
        {t.loading}
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card p-4 space-y-4">
      <div>
        <h2 className="text-base font-semibold">{t.hdCoreEnrollmentTitle}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.hdCoreEnrollmentDescription}
        </p>
      </div>

      <div className="space-y-6">
        {coreModuleGroups.map((group) => {
          const instances = getGroupInstances(group);

          return (
            <div key={group.id} className="space-y-3">
              <h3 className="text-sm font-semibold">{group.label}</h3>

              {instances.length === 0 ? (
                <p className="text-sm text-amber-700">
                  {t.hdCoreEnrollmentNoInstances}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">
                          {t.programmeCode}
                        </th>
                        <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                          {t.expectedStudentNumber}
                        </th>
                        <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                          {t.hdCoreEnrollmentActualFt}
                        </th>
                        <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                          {t.hdCoreEnrollmentActualPt}
                        </th>
                        {instances.map((instanceCode) => (
                          <th
                            key={instanceCode}
                            className="px-3 py-2 text-left font-medium font-mono text-xs"
                          >
                            {instanceCode}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {getGroupProgrammeCodes(group).map((programmeCode) => {
                        const applicableModuleCodes = getApplicableModuleCodesForProgramme({
                          group,
                          programmeCode,
                        });
                        const ruleModuleCode = applicableModuleCodes[0] ?? group.moduleCodes[0] ?? "";
                        const key = ruleStateKey(ruleModuleCode, programmeCode);
                        const selected = new Set(allowedByKey[key] ?? []);
                        const studentCount = getGroupExpectedStudentNumber(group, programmeCode);
                        const actual = getGroupActual(group, programmeCode);

                        return (
                          <tr key={key} className="border-t">
                            <td className="px-3 py-2 font-medium">
                              {programmeCode}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                              {studentCount}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                              {actual.ft}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                              {actual.pt}
                            </td>
                            {instances.map((instanceCode) => (
                              <td key={instanceCode} className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={selected.has(instanceCode)}
                                  onChange={(event) =>
                                    toggleAllowed({
                                      moduleCodes: applicableModuleCodes.length > 0
                                        ? applicableModuleCodes
                                        : group.moduleCodes,
                                      programmeCode,
                                      instanceCode,
                                      checked: event.target.checked,
                                    })
                                  }
                                  aria-label={`${programmeCode} ${instanceCode}`}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={saving || applying || !academicYear.trim()}
          onClick={() => void handleSaveRules()}
        >
          {saving ? t.processing : t.hdCoreEnrollmentSaveRules}
        </button>

        <button
          type="button"
          className="btn btn-primary"
          disabled={saving || applying || !academicYear.trim()}
          onClick={() => void handleApplyRules()}
        >
          {applying ? t.processing : t.hdCoreEnrollmentApply}
        </button>
      </div>

      {message ? (
        <p className="text-sm font-medium whitespace-pre-wrap">{message}</p>
      ) : null}

      {warnings.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-1 max-h-64 overflow-y-auto">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
