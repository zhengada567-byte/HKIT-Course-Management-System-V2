import { useEffect, useRef, useState } from "react";

import { DataTable } from "../../components/tables/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  formatModuleTeachingHoursDefaultHint,
  formatModuleTutorialHoursDefaultHint,
  normalizeModuleContactHours,
  normalizeModuleTutorialContactHours,
  resolveDefaultModuleTeachingTutorialHours,
} from "../../lib/moduleContactHours";
import {
  deleteModule,
  listModules,
  normalizeModuleType,
  normalizeUsesComputerFlag,
  upsertModule,
  type ModuleInput,
} from "../../services/moduleService";
import { formatProgrammeYearDisplay } from "../../lib/programmeYear";
import type {
  ModuleRow,
  ModuleTerm,
  ModuleType,
  ModuleUsesComputerFlag,
} from "../../types";

const emptyForm: ModuleInput = {
  module_code: "",
  module_name: "",
  module_year: "",
  module_term: "Sep",
  programme_code: "",
  stream_code: "nil",
  uses_computer: "N",
  module_type: "core",
  module_teaching_contact_hours: null,
  module_tutorial_contact_hours: null,
};

export function ModuleManagementPage() {
  const { t } = useLanguage();

  const formRef = useRef<HTMLFormElement | null>(null);

  const [rows, setRows] = useState<ModuleRow[]>([]);
  const [form, setForm] = useState<ModuleInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState("");

  const isEditing = Boolean(editingId);

  async function loadRows() {
    setLoading(true);
    setMessage("");

    try {
      const data = await listModules();
      setRows(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  function scrollToForm() {
    window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
    setMessage("");
  }

  function handleNew() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
    setMessage("");
    scrollToForm();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    try {
      if (!form.module_code || !form.module_term || !form.programme_code) {
        setMessage("Module Code, Module Term and Programme Code are required.");
        return;
      }

      setSaving(true);
      setMessage("");

      await upsertModule({
        ...form,
        id: editingId ?? undefined,
      });

      resetForm();
      await loadRows();
      setMessage(isEditing ? "Module updated." : "Module created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = window.confirm("Delete this module?");
    if (!ok) return;

    try {
      setMessage("");

      await deleteModule(id);

      if (editingId === id) {
        resetForm();
      }

      await loadRows();
      setMessage("Module deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed");
    }
  }

  function editRow(row: ModuleRow) {
    setEditingId(row.id);
    setShowForm(true);

    setForm({
      id: row.id,
      module_code: row.module_code ?? "",
      module_name: row.module_name ?? "",
      module_year: row.module_year ?? "",
      module_term: row.module_term,
      programme_code: row.programme_code ?? "",
      stream_code: row.stream_code ?? "nil",
      uses_computer: normalizeUsesComputerFlag(row.uses_computer),
      module_type: normalizeModuleType(row.module_type),
      module_teaching_contact_hours: row.module_teaching_contact_hours,
      module_tutorial_contact_hours: row.module_tutorial_contact_hours,
    });

    setMessage(`Editing module: ${row.module_code}`);
    scrollToForm();
  }

  return (
    <div className="page-container page-container--fill">
      <PageHeader
        title={t.moduleManagement}
        description="Module unique key: module_code + programme_code + stream_code. module_term is catalog offered term only."
      />

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <button type="button" className="btn btn-primary" onClick={handleNew}>
          {t.create}
        </button>
      </div>

      {showForm && (
        <form ref={formRef} className="card mb-4" onSubmit={handleSubmit}>
          <div className="card-body">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {isEditing ? t.edit : t.create}
                </h2>

                <p className="text-sm text-slate-500">
                  {isEditing
                    ? "Update the module details and click Save."
                    : "Fill in the module details and click Create."}
                </p>
              </div>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={resetForm}
              >
                {t.cancel}
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-8">
              <div>
                <label className="form-label">{t.moduleCode}</label>
                <input
                  className="form-input"
                  value={form.module_code}
                  disabled={isEditing}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      module_code: event.target.value,
                    }))
                  }
                />
              </div>

              <div>
                <label className="form-label">{t.moduleName}</label>
                <input
                  className="form-input"
                  value={form.module_name ?? ""}
                  onChange={(event) =>
                    setForm((prev) => ({
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
                  value={form.module_year ?? ""}
                  placeholder="Y1"
                  onChange={(event) =>
                    setForm((prev) => ({
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
                  value={form.module_term}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      module_term: event.target.value as ModuleTerm,
                    }))
                  }
                >
                  <option value="Sep">Sep</option>
                  <option value="Feb">Feb</option>
                  <option value="Jun">Jun</option>
                </select>
              </div>

              <div>
                <label className="form-label">{t.programmeCode}</label>
                <input
                  className="form-input"
                  value={form.programme_code}
                  disabled={isEditing}
                  onChange={(event) => {
                    const programmeCode = event.target.value;
                    const defaults = resolveDefaultModuleTeachingTutorialHours({
                      programmeCode,
                    });

                    setForm((prev) => ({
                      ...prev,
                      programme_code: programmeCode,
                      ...(isEditing
                        ? {}
                        : {
                            module_teaching_contact_hours:
                              defaults.module_teaching_contact_hours,
                            module_tutorial_contact_hours:
                              defaults.module_tutorial_contact_hours,
                          }),
                    }));
                  }}
                />
              </div>

              <div>
                <label className="form-label">{t.programmeStream}</label>
                <input
                  className="form-input"
                  value={form.stream_code ?? ""}
                  placeholder="nil"
                  disabled={isEditing}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      stream_code: event.target.value,
                    }))
                  }
                />
              </div>

              <div>
                <label className="form-label">{t.moduleTeachingContactHours}</label>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  step={1}
                  value={form.module_teaching_contact_hours ?? ""}
                  placeholder={
                    form.programme_code
                      ? formatModuleTeachingHoursDefaultHint(form.programme_code)
                      : "36"
                  }
                  onChange={(event) =>
                    setForm((prev) => ({
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
                  value={form.module_tutorial_contact_hours ?? ""}
                  placeholder={
                    form.programme_code
                      ? formatModuleTutorialHoursDefaultHint(form.programme_code)
                      : "21"
                  }
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      module_tutorial_contact_hours: normalizeModuleTutorialContactHours(
                        event.target.value
                      ),
                    }))
                  }
                />
                <p className="mt-1 text-xs text-slate-500">
                  {t.moduleTeachingTutorialHoursHint}
                </p>
              </div>

              <div>
                <label className="form-label">Uses computer room</label>
                <select
                  className="form-select"
                  value={form.uses_computer ?? "N"}
                  title="Uses computer room"
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      uses_computer: event.target.value as ModuleUsesComputerFlag,
                    }))
                  }
                >
                  <option value="N">N — No</option>
                  <option value="Y">Y — Yes</option>
                </select>
              </div>

              <div>
                <label className="form-label">{t.moduleType}</label>
                <select
                  className="form-select"
                  value={form.module_type ?? "core"}
                  title={t.moduleType}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      module_type: event.target.value as ModuleType,
                    }))
                  }
                >
                  <option value="core">{t.moduleTypeCore}</option>
                  <option value="optional">{t.moduleTypeOptional}</option>
                </select>
              </div>

              <div className="flex items-end gap-2">
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? t.loading : isEditing ? t.save : t.create}
                </button>
              </div>
            </div>
          </div>
        </form>
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
            rowKey={(row) => row.id}
          columns={[
            {
              key: "programme",
              header: t.programmeCode,
              render: (row) => (
                <span
                  className="block max-w-[90px] truncate"
                  title={row.programme_code}
                >
                  {row.programme_code}
                </span>
              ),
            },
            {
              key: "stream",
              header: t.programmeStream,
              render: (row) => (
                <span
                  className="block max-w-[130px] truncate"
                  title={row.stream_code ?? ""}
                >
                  {row.stream_code}
                </span>
              ),
            },
            {
              key: "code",
              header: t.moduleCode,
              render: (row) => (
                <span
                  className="block max-w-[110px] font-medium"
                  title={row.module_code}
                >
                  {row.module_code}
                </span>
              ),
            },
            {
              key: "name",
              header: t.moduleName,
              render: (row) => (
                <span
                  className="block max-w-[320px] whitespace-normal break-words leading-snug"
                  title={row.module_name ?? ""}
                >
                  {row.module_name ?? "-"}
                </span>
              ),
            },
            {
              key: "year",
              header: t.moduleYear,
              render: (row) => (
                <span className="block w-[70px] whitespace-nowrap">
                  {formatProgrammeYearDisplay(row.module_year)}
                </span>
              ),
            },
            {
              key: "term",
              header: t.moduleTerm,
              render: (row) => (
                <span className="block w-[55px] whitespace-nowrap">
                  {row.module_term}
                </span>
              ),
            },
            {
              key: "teachingHours",
              header: t.moduleTeachingContactHours,
              render: (row) => (
                <span className="block w-[40px] whitespace-nowrap font-medium">
                  {row.module_teaching_contact_hours}
                </span>
              ),
            },
            {
              key: "tutorialHours",
              header: t.moduleTutorialContactHours,
              render: (row) => (
                <span className="block w-[40px] whitespace-nowrap font-medium">
                  {row.module_tutorial_contact_hours}
                </span>
              ),
            },
            {
              key: "computer",
              header: "Computer",
              render: (row) => (
                <span className="block w-[40px] whitespace-nowrap font-medium">
                  {normalizeUsesComputerFlag(row.uses_computer)}
                </span>
              ),
            },
            {
              key: "moduleType",
              header: t.moduleType,
              render: (row) => (
                <span className="block w-[70px] whitespace-nowrap font-medium">
                  {row.module_type === "optional"
                    ? t.moduleTypeOptional
                    : t.moduleTypeCore}
                </span>
              ),
            },
            {
              key: "actions",
              header: t.action,
              render: (row) => (
                <div className="flex w-[120px] flex-nowrap gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary py-1 text-xs"
                    onClick={() => editRow(row)}
                  >
                    {t.edit}
                  </button>

                  <button
                    type="button"
                    className="btn btn-danger py-1 text-xs"
                    onClick={() => handleDelete(row.id)}
                  >
                    {t.delete}
                  </button>
                </div>
              ),
            },
          ]}
          />
        </div>
      )}
    </div>
  );
}
