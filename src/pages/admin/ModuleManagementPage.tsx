import { useEffect, useRef, useState } from "react";

import { DataTable } from "../../components/tables/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  deleteModule,
  listModules,
  upsertModule,
  type ModuleInput,
} from "../../services/moduleService";
import type { ModuleRow, ModuleTerm } from "../../types";

const emptyForm: ModuleInput = {
  module_code: "",
  module_name: "",
  module_year: "",
  module_term: "Sep",
  programme_code: "",
  stream_code: "nil",
};

export function ModuleManagementPage() {
  const { t } = useLanguage();

  const formRef = useRef<HTMLFormElement | null>(null);

  const [rows, setRows] = useState<ModuleRow[]>([]);
  const [form, setForm] = useState<ModuleInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

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

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setMessage("");
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

      setForm(emptyForm);
      setEditingId(null);

      await loadRows();

      setMessage(isEditing ? "Module updated." : "Module saved.");
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

      /**
       * If the deleted row is currently being edited,
       * reset the form to avoid editing a deleted record.
       */
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

    setForm({
      id: row.id,
      module_code: row.module_code ?? "",
      module_name: row.module_name ?? "",
      module_year: row.module_year ?? "",
      module_term: row.module_term,
      programme_code: row.programme_code ?? "",
      stream_code: row.stream_code ?? "nil",
    });

    setMessage(`Editing module: ${row.module_code}`);

    /**
     * The old code did update the form,
     * but because the form is above the table, users may not notice it.
     * Scroll to the form so the Edit button visibly responds.
     */
    window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.moduleManagement}
        description="Module unique key: module_code + programme_code + stream_code. module_term is catalog offered term only."
      />

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      <form ref={formRef} className="card mb-4" onSubmit={handleSubmit}>
        <div className="card-body">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {isEditing ? "Edit Module" : "Add Module"}
              </h2>

              <p className="text-sm text-slate-500">
                {isEditing
                  ? "You are editing an existing module. Click Save to update it."
                  : "Fill in the module details and click Save."}
              </p>
            </div>

            {isEditing && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={resetForm}
              >
                Cancel Edit
              </button>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-7">
            <div>
              <label className="form-label">{t.moduleCode}</label>
              <input
                className="form-input"
                value={form.module_code}
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
                placeholder="Year 1"
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
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    programme_code: event.target.value,
                  }))
                }
              />
            </div>

            <div>
              <label className="form-label">{t.programmeStream}</label>
              <input
                className="form-input"
                value={form.stream_code ?? ""}
                placeholder="nil"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    stream_code: event.target.value,
                  }))
                }
              />
            </div>

            <div className="flex items-end gap-2">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={saving}
              >
                {saving ? "Saving..." : isEditing ? "Update" : t.save}
              </button>
            </div>
          </div>
        </div>
      </form>

      {loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
columns={[
  {
    key: "programme",
    header: t.programmeCode,
    render: (row) => (
      <span className="block max-w-[90px] truncate" title={row.programme_code}>
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
      <span className="block max-w-[110px] font-medium" title={row.module_code}>
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
        {row.module_year ?? "-"}
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
      )}
    </div>
  );
}
