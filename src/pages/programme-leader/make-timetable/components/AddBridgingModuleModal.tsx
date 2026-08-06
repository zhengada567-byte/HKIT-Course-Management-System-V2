import { useEffect, useMemo, useState } from "react";

import { LoadingState } from "../../../../components/ui/LoadingState";
import { useAuth } from "../../../../contexts/AuthContext";
import { useLanguage } from "../../../../contexts/LanguageContext";
import { normalizeStream } from "../../../../lib/utils";
import {
  createBridgingModuleOfferings,
  deactivateBridgingModuleOffering,
  listBridgingParentCandidates,
  updateBridgingModuleHours,
  type BridgingParentCandidate,
} from "../../../../services/bridgingModuleService";
import type { ModuleTerm } from "../../../../types";

type HoursDraft = {
  teaching: string;
  tutorial: string;
};

function hoursDraftFromCandidate(candidate: BridgingParentCandidate): HoursDraft {
  const source =
    candidate.existingBridgingModule ?? candidate.parent;

  return {
    teaching: String(source.module_teaching_contact_hours ?? ""),
    tutorial: String(source.module_tutorial_contact_hours ?? ""),
  };
}

export function AddBridgingModuleModal({
  open,
  onClose,
  academicYear,
  programmeCode,
  moduleTerm,
  onCompleted,
}: {
  open: boolean;
  onClose: () => void;
  academicYear: string;
  programmeCode: string;
  moduleTerm: ModuleTerm;
  onCompleted?: () => void;
}) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isAdmin = user?.role === "admin";

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [candidates, setCandidates] = useState<BridgingParentCandidate[]>([]);
  const [selectedParentIds, setSelectedParentIds] = useState<Set<string>>(
    () => new Set()
  );
  const [hoursByParentId, setHoursByParentId] = useState<
    Record<string, HoursDraft>
  >({});

  const selectedCount = selectedParentIds.size;

  const existingActiveCount = useMemo(
    () =>
      candidates.filter((row) => row.existingOffering?.status === "active")
        .length,
    [candidates]
  );

  async function loadCandidates() {
    if (!programmeCode) {
      setCandidates([]);
      setMessage(t.addBridgingModuleSelectProgramme);
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const rows = await listBridgingParentCandidates({
        academicYear,
        programmeCode,
        moduleTerm,
      });

      setCandidates(rows);
      setSelectedParentIds(new Set());
      setHoursByParentId(
        Object.fromEntries(
          rows.map((row) => [row.parent.id, hoursDraftFromCandidate(row)])
        )
      );

      if (rows.length === 0) {
        setMessage(t.addBridgingModuleEmpty);
      }
    } catch (error) {
      setCandidates([]);
      setMessage(
        error instanceof Error ? error.message : t.addBridgingModuleLoadFailed
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void loadCandidates();
  }, [open, academicYear, programmeCode, moduleTerm]);

  function toggleParent(parentId: string, checked: boolean) {
    setSelectedParentIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(parentId);
      else next.delete(parentId);
      return next;
    });
  }

  function updateHours(parentId: string, patch: Partial<HoursDraft>) {
    setHoursByParentId((prev) => ({
      ...prev,
      [parentId]: {
        teaching: prev[parentId]?.teaching ?? "",
        tutorial: prev[parentId]?.tutorial ?? "",
        ...patch,
      },
    }));
  }

  async function handleCreate() {
    if (selectedParentIds.size === 0) {
      setMessage(t.addBridgingModuleSelectParents);
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const hoursPayload: Record<
        string,
        {
          module_teaching_contact_hours: number;
          module_tutorial_contact_hours: number;
        }
      > = {};

      for (const parentId of selectedParentIds) {
        const draft = hoursByParentId[parentId];
        const teaching = Number(draft?.teaching);
        const tutorial = Number(draft?.tutorial);
        if (!Number.isFinite(teaching) || !Number.isFinite(tutorial)) {
          throw new Error(t.addBridgingModuleInvalidHours);
        }
        hoursPayload[parentId] = {
          module_teaching_contact_hours: teaching,
          module_tutorial_contact_hours: tutorial,
        };
      }

      const result = await createBridgingModuleOfferings({
        academicYear,
        moduleTerm,
        parentModuleIds: [...selectedParentIds],
        createdBy: user?.id ?? null,
        hoursByParentId: hoursPayload,
      });

      const parts = [
        t.addBridgingModuleCreated.replace(
          "{count}",
          String(result.created.length)
        ),
        result.reused.length > 0
          ? t.addBridgingModuleReactivated.replace(
              "{count}",
              String(result.reused.length)
            )
          : "",
        result.skippedExisting.length > 0
          ? t.addBridgingModuleSkipped.replace(
              "{count}",
              String(result.skippedExisting.length)
            )
          : "",
      ].filter(Boolean);

      setMessage(parts.join(" "));
      await loadCandidates();
      onCompleted?.();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t.addBridgingModuleCreateFailed
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveHours(candidate: BridgingParentCandidate) {
    const bridgingId = candidate.existingBridgingModule?.id;
    if (!bridgingId) return;

    const draft = hoursByParentId[candidate.parent.id];
    const teaching = Number(draft?.teaching);
    const tutorial = Number(draft?.tutorial);

    if (!Number.isFinite(teaching) || !Number.isFinite(tutorial)) {
      setMessage(t.addBridgingModuleInvalidHours);
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      await updateBridgingModuleHours({
        bridgingModuleId: bridgingId,
        module_teaching_contact_hours: teaching,
        module_tutorial_contact_hours: tutorial,
        updatedBy: user?.id ?? null,
      });
      setMessage(t.addBridgingModuleHoursSaved);
      await loadCandidates();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t.addBridgingModuleHoursFailed
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(candidate: BridgingParentCandidate) {
    const offeringId = candidate.existingOffering?.id;
    if (!offeringId || !isAdmin) return;

    setSaving(true);
    setMessage("");

    try {
      await deactivateBridgingModuleOffering({
        offeringId,
        updatedBy: user?.id ?? null,
        isAdmin,
      });
      setMessage(t.addBridgingModuleDeactivated);
      await loadCandidates();
      onCompleted?.();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : t.addBridgingModuleDeactivateFailed
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const busy = loading || saving;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-bridging-module-title"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2
              id="add-bridging-module-title"
              className="text-lg font-semibold text-slate-900"
            >
              {t.addBridgingModule}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {t.addBridgingModuleHint
                .replace("{term}", moduleTerm)
                .replace("{programme}", programmeCode)}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            {t.cancel}
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          {message && (
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
              {message}
            </div>
          )}

          <p className="text-sm text-slate-600">
            {t.addBridgingModuleActiveCount.replace(
              "{count}",
              String(existingActiveCount)
            )}
          </p>

          {loading ? (
            <LoadingState />
          ) : candidates.length === 0 ? (
            <p className="text-sm text-slate-500">{t.addBridgingModuleEmpty}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="data-table min-w-full text-sm">
                <thead>
                  <tr>
                    <th className="w-10" />
                    <th>{t.moduleCode}</th>
                    <th>{t.addBridgingModuleCode}</th>
                    <th>{t.moduleName}</th>
                    <th>{t.moduleTerm}</th>
                    <th>{t.programmeCode}</th>
                    <th>{t.programmeStream}</th>
                    <th>{t.addBridgingTeachingHours}</th>
                    <th>{t.addBridgingTutorialHours}</th>
                    <th>{t.status}</th>
                    <th>{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => {
                    const parentId = candidate.parent.id;
                    const offering = candidate.existingOffering;
                    const alreadyActive = offering?.status === "active";
                    const hours = hoursByParentId[parentId] ?? {
                      teaching: "",
                      tutorial: "",
                    };

                    return (
                      <tr key={parentId}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedParentIds.has(parentId)}
                            disabled={busy || alreadyActive}
                            title={
                              alreadyActive
                                ? t.addBridgingModuleAlreadyExists
                                : t.addBridgingModule
                            }
                            onChange={(event) =>
                              toggleParent(parentId, event.target.checked)
                            }
                          />
                        </td>
                        <td className="font-mono whitespace-nowrap">
                          {candidate.parent.module_code}
                        </td>
                        <td className="font-mono whitespace-nowrap">
                          {candidate.bridgingModuleCode}
                        </td>
                        <td className="whitespace-nowrap">
                          {candidate.parent.module_name ?? "—"}
                        </td>
                        <td className="whitespace-nowrap">
                          {candidate.parent.module_term}
                        </td>
                        <td className="whitespace-nowrap">
                          {candidate.parent.programme_code}
                        </td>
                        <td className="whitespace-nowrap">
                          {normalizeStream(candidate.parent.stream_code)}
                        </td>
                        <td>
                          <input
                            className="form-input w-20"
                            type="number"
                            min={0}
                            step={1}
                            value={hours.teaching}
                            disabled={busy}
                            onChange={(event) =>
                              updateHours(parentId, {
                                teaching: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="form-input w-20"
                            type="number"
                            min={0}
                            step={1}
                            value={hours.tutorial}
                            disabled={busy}
                            onChange={(event) =>
                              updateHours(parentId, {
                                tutorial: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td className="whitespace-nowrap">
                          {!offering
                            ? t.addBridgingModuleNotCreated
                            : offering.status === "active"
                              ? t.addBridgingModuleStatusActive
                              : t.addBridgingModuleStatusInactive}
                        </td>
                        <td className="whitespace-nowrap">
                          <div className="flex flex-wrap gap-2">
                            {candidate.existingBridgingModule && (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                disabled={busy}
                                onClick={() =>
                                  void handleSaveHours(candidate)
                                }
                              >
                                {t.addBridgingModuleSaveHours}
                              </button>
                            )}
                            {isAdmin && alreadyActive && (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                disabled={busy}
                                onClick={() =>
                                  void handleDeactivate(candidate)
                                }
                              >
                                {t.addBridgingModuleDeactivate}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <p className="text-sm text-slate-600">
            {t.addBridgingModuleSelectedCount.replace(
              "{count}",
              String(selectedCount)
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={onClose}
            >
              {t.cancel}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || selectedCount === 0}
              onClick={() => void handleCreate()}
            >
              {saving ? t.loading : t.addBridgingModuleCreate}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
