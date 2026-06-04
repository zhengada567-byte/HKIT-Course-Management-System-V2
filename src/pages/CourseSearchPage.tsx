import { useEffect, useMemo, useRef, useState } from "react";

import { DataTable } from "../components/tables/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { PageHeader } from "../components/ui/PageHeader";
import { useAcademicYear } from "../contexts/AcademicYearContext";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../contexts/LanguageContext";
import {
  normalizeModuleContactHours,
  normalizeModuleTutorialContactHours,
  resolveDefaultModuleTeachingTutorialHours,
} from "../lib/moduleContactHours";
import { listProgrammes } from "../services/programmeService";
import {
  normalizeUsesComputerFlag,
  upsertModule,
  type ModuleInput,
} from "../services/moduleService";
import {
  buildCourseSearchDraft,
  buildModuleCatalogBreakdown,
  deleteCourseSearchModule,
  saveCourseSearchModule,
  searchCourses,
  type CourseSearchModuleDraft,
  type CourseSearchRow,
} from "../services/courseSearchService";
import type { ModuleTerm, ProgrammeRow } from "../types";

const termOptions: ModuleTerm[] = ["Sep", "Feb", "Jun"];

function defaultNewModuleForm(
  programmeCode: string,
  streamCode: string,
  programmeType?: string | null
): ModuleInput {
  return {
    module_code: "",
    module_name: "",
    module_year: "Year 1",
    module_term: "Sep",
    programme_code: programmeCode,
    stream_code: streamCode || "nil",
    uses_computer: "N",
    ...(programmeCode
      ? resolveDefaultModuleTeachingTutorialHours({
          programmeCode,
          programmeType,
        })
      : {
          module_teaching_contact_hours: null,
          module_tutorial_contact_hours: null,
        }),
  };
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function isCommonStreamModule(streamCode: string | null | undefined) {
  return normalizeText(streamCode) === "";
}

function draftsFromRows(rows: CourseSearchRow[]) {
  return Object.fromEntries(
    rows.map((row) => [row.module_id, buildCourseSearchDraft(row)])
  );
}

export function CourseSearchPage() {
  const { user, role } = useAuth();
  const { academicYear } = useAcademicYear();
  const { t } = useLanguage();

  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [programmeCode, setProgrammeCode] = useState("");
  const [streamCode, setStreamCode] = useState("");
  const [rows, setRows] = useState<CourseSearchRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, CourseSearchModuleDraft>>(
    {}
  );
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [creatingModule, setCreatingModule] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newModuleForm, setNewModuleForm] = useState<ModuleInput>(
    defaultNewModuleForm("", "")
  );
  const [message, setMessage] = useState("");
  const addFormRef = useRef<HTMLFormElement | null>(null);

  const isBusy =
    savingAll || Boolean(savingId) || Boolean(deletingId) || creatingModule;

  const canEdit = role === "programme_leader" || role === "admin";
  const canManageModules =
    canEdit && (role === "admin" || Boolean(programmeCode));

  async function loadProgrammes() {
    const data = await listProgrammes();
    setProgrammes(data);
  }

  async function loadRows() {
    setLoading(true);
    setMessage("");

    try {
      const data = await searchCourses({
        academicYear,
        programmeCode: programmeCode || undefined,
        streamCode: streamCode || undefined,
      });

      setRows(data);
      setDrafts(draftsFromRows(data));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProgrammes();
  }, []);

  useEffect(() => {
    void loadRows();
  }, [academicYear]);

  const programmeCodes = useMemo(
    () =>
      [
        ...new Set(
          programmes
            .map((p) => normalizeText(p.programme_code))
            .filter(Boolean)
        ),
      ],
    [programmes]
  );

  const programmeTypeByCode = useMemo(() => {
    const map = new Map<string, string | null>();

    for (const programme of programmes) {
      const code = normalizeText(programme.programme_code);

      if (!code || map.has(code)) continue;

      map.set(code, programme.programme_type ?? null);
    }

    return map;
  }, [programmes]);

  const streamOptions = programmes
    .filter((p) => !programmeCode || p.programme_code === programmeCode)
    .map((p) => normalizeText(p.programme_stream))
    .filter(Boolean);

  const moduleBreakdown = useMemo(() => {
    if (!programmeCode) {
      return null;
    }

    const breakdownRows = rows.map((row) => {
      const draft = drafts[row.module_id];

      return {
        module_year: draft?.module_year ?? row.final_module_year,
        module_term: draft?.module_term ?? row.final_module_term,
      };
    });

    return buildModuleCatalogBreakdown(breakdownRows);
  }, [drafts, programmeCode, rows]);

  function updateDraft(
    moduleId: string,
    patch: Partial<CourseSearchModuleDraft>
  ) {
    setDrafts((current) => {
      const existing = current[moduleId];

      if (!existing) return current;

      return {
        ...current,
        [moduleId]: {
          ...existing,
          ...patch,
        },
      };
    });
  }

  async function handleSave(row: CourseSearchRow) {
    if (!user || !canManageModules) return;

    const draft = drafts[row.module_id];

    if (!draft) return;

    setSavingId(row.module_id);
    setMessage("");

    try {
      await saveCourseSearchModule({
        draft,
        academicYear,
        updatedBy: user.id,
      });

      await loadRows();
      setMessage(`Saved module ${row.module_code}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleSaveAll() {
    if (!user || !canManageModules || rows.length === 0) return;

    setSavingAll(true);
    setMessage("");

    const failures: string[] = [];
    let savedCount = 0;

    try {
      for (const row of rows) {
        const draft = drafts[row.module_id];

        if (!draft) continue;

        try {
          await saveCourseSearchModule({
            draft,
            academicYear,
            updatedBy: user.id,
          });
          savedCount += 1;
        } catch (error) {
          failures.push(
            `${row.module_code}: ${
              error instanceof Error ? error.message : "Save failed"
            }`
          );
        }
      }

      await loadRows();

      if (failures.length === 0) {
        setMessage(`Saved all ${savedCount} module(s).`);
      } else if (savedCount > 0) {
        setMessage(
          `Saved ${savedCount} module(s). Failed: ${failures.join("; ")}`
        );
      } else {
        setMessage(`Save all failed: ${failures.join("; ")}`);
      }
    } finally {
      setSavingAll(false);
    }
  }

  function openAddModuleForm() {
    if (!programmeCode) return;

    setNewModuleForm(
      defaultNewModuleForm(
        programmeCode,
        streamCode,
        programmeTypeByCode.get(programmeCode)
      )
    );
    setShowAddForm(true);
    setMessage("");

    window.requestAnimationFrame(() => {
      addFormRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  async function handleCreateModule(event: React.FormEvent) {
    event.preventDefault();

    if (!canManageModules) return;

    if (
      !newModuleForm.module_code.trim() ||
      !newModuleForm.programme_code.trim() ||
      !newModuleForm.module_term
    ) {
      setMessage("Module Code, Programme Code and Module Term are required.");
      return;
    }

    setCreatingModule(true);
    setMessage("");

    try {
      await upsertModule({
        module_code: newModuleForm.module_code.trim(),
        module_name: newModuleForm.module_name?.trim() || null,
        module_year: newModuleForm.module_year?.trim() || null,
        module_term: newModuleForm.module_term,
        programme_code: newModuleForm.programme_code.trim(),
        stream_code: newModuleForm.stream_code || "nil",
        uses_computer: newModuleForm.uses_computer,
        module_teaching_contact_hours: newModuleForm.module_teaching_contact_hours,
        module_tutorial_contact_hours: newModuleForm.module_tutorial_contact_hours,
      });

      setShowAddForm(false);
      setNewModuleForm(
      defaultNewModuleForm(
        programmeCode,
        streamCode,
        programmeTypeByCode.get(programmeCode)
      )
    );
      await loadRows();
      setMessage(`Created module ${newModuleForm.module_code.trim()}.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to create module."
      );
    } finally {
      setCreatingModule(false);
    }
  }

  async function handleDelete(row: CourseSearchRow) {
    if (!canManageModules) return;

    const ok = window.confirm(
      `Delete module ${row.module_code} (${row.programme_code} / ${row.stream_code || "nil"}) from the system?\n\nThis removes the module catalogue row and related enrollment / default-teacher rows for this module identity.`
    );

    if (!ok) return;

    setDeletingId(row.module_id);
    setMessage("");

    try {
      await deleteCourseSearchModule(row);
      await loadRows();
      setMessage(`Deleted module ${row.module_code}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="page-container page-container--fill">
      <PageHeader
        title={t.courseSearch}
        description="Search module catalogue by programme. Programme leaders: select a programme, then edit and Save, or Delete mistaken modules."
      />

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      {canEdit && role === "programme_leader" && !programmeCode && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Select a <strong>Programme Code</strong> before editing or deleting
          modules.
        </div>
      )}

      <div className="card mb-4">
        <div className="card-body grid gap-3 md:grid-cols-4">
          <div>
            <label className="form-label">{t.programmeCode}</label>
            <select
              className="form-select"
              value={programmeCode}
              onChange={(event) => {
                setProgrammeCode(event.target.value);
                setStreamCode("");
              }}
            >
              <option value="">All</option>
              {programmeCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">{t.programmeStream}</label>
            <select
              className="form-select"
              value={streamCode}
              onChange={(event) => setStreamCode(event.target.value)}
            >
              <option value="">All</option>
              {[...new Set(streamOptions)].map((stream) => (
                <option key={stream} value={stream}>
                  {stream}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={isBusy}
              onClick={() => void loadRows()}
            >
              {t.displayModules}
            </button>

            {canManageModules && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isBusy || loading || !programmeCode}
                onClick={openAddModuleForm}
              >
                {t.addNewModule}
              </button>
            )}

            {canManageModules && rows.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isBusy || loading}
                onClick={() => void handleSaveAll()}
              >
                {savingAll ? t.loading : t.saveAll}
              </button>
            )}
          </div>
        </div>
      </div>

      {canManageModules && showAddForm && programmeCode && (
        <form
          ref={addFormRef}
          className="card mb-4"
          onSubmit={(event) => void handleCreateModule(event)}
        >
          <div className="card-body space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {t.addNewModule}
                </h2>
                <p className="text-sm text-slate-500">
                  Adds a row to the module catalogue for {programmeCode}.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={creatingModule}
                onClick={() => setShowAddForm(false)}
              >
                {t.cancel}
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-4 lg:grid-cols-8">
              <div>
                <label className="form-label">{t.moduleCode}</label>
                <input
                  className="form-input font-mono"
                  value={newModuleForm.module_code}
                  required
                  onChange={(event) =>
                    setNewModuleForm((prev) => ({
                      ...prev,
                      module_code: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="md:col-span-2">
                <label className="form-label">{t.moduleName}</label>
                <input
                  className="form-input"
                  value={newModuleForm.module_name ?? ""}
                  onChange={(event) =>
                    setNewModuleForm((prev) => ({
                      ...prev,
                      module_name: event.target.value,
                    }))
                  }
                />
              </div>

              <div>
                <label className="form-label">{t.moduleYear}</label>
                <input
                  className="form-input"
                  value={newModuleForm.module_year ?? ""}
                  placeholder="Year 1"
                  onChange={(event) =>
                    setNewModuleForm((prev) => ({
                      ...prev,
                      module_year: event.target.value,
                    }))
                  }
                />
              </div>

              <div>
                <label className="form-label">{t.moduleTerm}</label>
                <select
                  className="form-select"
                  value={newModuleForm.module_term}
                  required
                  onChange={(event) =>
                    setNewModuleForm((prev) => ({
                      ...prev,
                      module_term: event.target.value as ModuleTerm,
                    }))
                  }
                >
                  {termOptions.map((term) => (
                    <option key={term} value={term}>
                      {term}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">{t.programmeCode}</label>
                <input
                  className="form-input bg-slate-50"
                  value={newModuleForm.programme_code}
                  readOnly
                />
              </div>

              <div>
                <label className="form-label">{t.programmeStream}</label>
                {streamCode ? (
                  <input
                    className="form-input bg-slate-50"
                    value={newModuleForm.stream_code ?? "nil"}
                    readOnly
                  />
                ) : (
                  <select
                    className="form-select"
                    value={newModuleForm.stream_code ?? "nil"}
                    onChange={(event) =>
                      setNewModuleForm((prev) => ({
                        ...prev,
                        stream_code: event.target.value,
                      }))
                    }
                  >
                    <option value="nil">nil (all streams)</option>
                    {[...new Set(streamOptions)].map((stream) => (
                      <option key={stream} value={stream}>
                        {stream}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="form-label">{t.moduleTeachingContactHours}</label>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  step={1}
                  value={newModuleForm.module_teaching_contact_hours ?? ""}
                  onChange={(event) =>
                    setNewModuleForm((prev) => ({
                      ...prev,
                      module_teaching_contact_hours: normalizeModuleContactHours(
                        event.target.value
                      ),
                    }))
                  }
                />
              </div>

              <div>
                <label className="form-label">{t.moduleTutorialContactHours}</label>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  step={1}
                  value={newModuleForm.module_tutorial_contact_hours ?? ""}
                  onChange={(event) =>
                    setNewModuleForm((prev) => ({
                      ...prev,
                      module_tutorial_contact_hours: normalizeModuleTutorialContactHours(
                        event.target.value
                      ),
                    }))
                  }
                />
              </div>

              <div>
                <label className="form-label">Uses Computer</label>
                <select
                  className="form-select"
                  value={newModuleForm.uses_computer ?? "N"}
                  onChange={(event) =>
                    setNewModuleForm((prev) => ({
                      ...prev,
                      uses_computer: normalizeUsesComputerFlag(
                        event.target.value
                      ),
                    }))
                  }
                >
                  <option value="N">N</option>
                  <option value="Y">Y</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creatingModule}
                >
                  {creatingModule ? t.loading : t.create}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {programmeCode && moduleBreakdown && !loading && (
        <div className="card mb-4">
          <div className="card-body space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">
                Module breakdown
              </div>
              <div className="text-sm text-slate-600">
                {programmeCode}
                {streamCode ? ` · ${streamCode}` : " · All streams"}
                {" · "}
                <span className="font-semibold text-slate-900">
                  {moduleBreakdown.total} modules
                </span>
              </div>
            </div>

            {moduleBreakdown.buckets.length === 0 ? (
              <p className="text-sm text-slate-500">
                No modules with year and term for this selection.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {moduleBreakdown.buckets.map((bucket) => (
                  <span
                    key={bucket.label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700"
                  >
                    <span className="font-medium">{bucket.label}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-900 shadow-sm">
                      {bucket.count}
                    </span>
                  </span>
                ))}
              </div>
            )}

            {moduleBreakdown.unclassified > 0 && (
              <p className="text-xs text-amber-800">
                {moduleBreakdown.unclassified} module(s) missing year or term are
                not included in the breakdown above.
              </p>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="page-fill-panel">
          <DataTable
            viewportSize="fill"
            rows={rows}
            rowKey={(row) => row.module_id}
          columns={[
            {
              key: "programme",
              header: t.programmeCode,
              render: (row) => row.programme_code,
            },
            {
              key: "stream",
              header: t.programmeStream,
              render: (row) =>
                isCommonStreamModule(row.stream_code) ? (
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                    All Streams
                  </span>
                ) : (
                  row.stream_code
                ),
            },
            {
              key: "moduleCode",
              header: t.moduleCode,
              render: (row) => (
                <span className="font-mono text-sm">{row.module_code}</span>
              ),
            },
            {
              key: "moduleName",
              header: t.moduleName,
              render: (row) =>
                canManageModules ? (
                  <input
                    className="form-input min-w-40"
                    value={drafts[row.module_id]?.module_name ?? ""}
                    onChange={(event) =>
                      updateDraft(row.module_id, {
                        module_name: event.target.value,
                      })
                    }
                  />
                ) : (
                  row.module_name ?? "-"
                ),
            },
            {
              key: "moduleYear",
              header: t.moduleYear,
              render: (row) =>
                canManageModules ? (
                  <div className="space-y-1">
                    <input
                      className="form-input min-w-24"
                      value={drafts[row.module_id]?.module_year ?? ""}
                      placeholder="Year 1"
                      onChange={(event) =>
                        updateDraft(row.module_id, {
                          module_year: event.target.value,
                        })
                      }
                    />
                    {row.adjusted_module_year &&
                      row.adjusted_module_year !== row.original_module_year && (
                        <div className="text-xs text-slate-500">
                          Display {academicYear}: {row.final_module_year}
                        </div>
                      )}
                  </div>
                ) : (
                  row.final_module_year ?? "-"
                ),
            },
            {
              key: "moduleTerm",
              header: t.moduleTerm,
              render: (row) =>
                canManageModules ? (
                  <div className="space-y-1">
                    <select
                      className="form-select min-w-24"
                      value={drafts[row.module_id]?.module_term ?? "Sep"}
                      onChange={(event) =>
                        updateDraft(row.module_id, {
                          module_term: event.target.value as ModuleTerm,
                        })
                      }
                    >
                      {termOptions.map((term) => (
                        <option key={term} value={term}>
                          {term}
                        </option>
                      ))}
                    </select>
                    {row.adjusted_module_term &&
                      row.adjusted_module_term !== row.original_module_term && (
                        <div className="text-xs text-slate-500">
                          Display {academicYear}: {row.final_module_term}
                        </div>
                      )}
                  </div>
                ) : (
                  row.final_module_term
                ),
            },
            {
              key: "teachingHours",
              header: t.moduleTeachingContactHours,
              render: (row) =>
                canManageModules ? (
                  <input
                    className="form-input min-w-20"
                    type="number"
                    min={1}
                    step={1}
                    value={drafts[row.module_id]?.module_teaching_contact_hours ?? ""}
                    onChange={(event) =>
                      updateDraft(row.module_id, {
                        module_teaching_contact_hours:
                          normalizeModuleContactHours(event.target.value) ??
                          row.module_teaching_contact_hours,
                      })
                    }
                  />
                ) : (
                  row.module_teaching_contact_hours
                ),
            },
            {
              key: "tutorialHours",
              header: t.moduleTutorialContactHours,
              render: (row) =>
                canManageModules ? (
                  <input
                    className="form-input min-w-20"
                    type="number"
                    min={1}
                    step={1}
                    value={drafts[row.module_id]?.module_tutorial_contact_hours ?? ""}
                    onChange={(event) =>
                      updateDraft(row.module_id, {
                        module_tutorial_contact_hours:
                          normalizeModuleTutorialContactHours(event.target.value) ??
                          row.module_tutorial_contact_hours,
                      })
                    }
                  />
                ) : (
                  row.module_tutorial_contact_hours
                ),
            },
            {
              key: "usesComputer",
              header: "Uses Computer",
              render: (row) =>
                canManageModules ? (
                  <select
                    className="form-select min-w-20"
                    value={drafts[row.module_id]?.uses_computer ?? "N"}
                    onChange={(event) =>
                      updateDraft(row.module_id, {
                        uses_computer: normalizeUsesComputerFlag(
                          event.target.value
                        ),
                      })
                    }
                  >
                    <option value="N">N</option>
                    <option value="Y">Y</option>
                  </select>
                ) : (
                  row.uses_computer
                ),
            },
            ...(canManageModules
              ? [
                  {
                    key: "actions",
                    header: t.action,
                    render: (row: CourseSearchRow) => (
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="btn btn-primary py-1 text-xs"
                          disabled={isBusy}
                          onClick={() => void handleSave(row)}
                        >
                          {savingId === row.module_id ? t.loading : t.save}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger py-1 text-xs"
                          disabled={isBusy}
                          onClick={() => void handleDelete(row)}
                        >
                          {deletingId === row.module_id ? t.loading : t.delete}
                        </button>
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
          />
        </div>
      )}
    </div>
  );
}
