import { useEffect, useRef, useState } from "react";

import { DataTable } from "../../components/tables/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  deleteProgramme,
  listProgrammes,
  upsertProgramme,
  type ProgrammeInput,
} from "../../services/programmeService";
import type { ProgrammeRow } from "../../types";

const emptyForm: ProgrammeInput = {
  programme_type: "",
  programme_code: "",
  programme_name: "",
  programme_stream: "nil",
  programme_leader: "",
  articulation: "",
};

export function ProgrammeManagementPage() {
  const { user, role } = useAuth();
  const { t } = useLanguage();
  const pageTitle =
    role === "programme_leader" ? t.programmeOverview : t.programmeManagement;
  const formRef = useRef<HTMLFormElement | null>(null);

  const [rows, setRows] = useState<ProgrammeRow[]>([]);
  const [form, setForm] = useState<ProgrammeInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const canEdit = user?.role === "admin";
  const isEditing = Boolean(editingId);

  async function loadRows() {
    setLoading(true);
    setMessage("");

    try {
      const data = await listProgrammes();
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

    if (!canEdit) return;

    setMessage("");

    try {
      if (!form.programme_type || !form.programme_code) {
        setMessage("Programme Type and Programme Code are required.");
        return;
      }

      setSaving(true);

      await upsertProgramme({
        ...form,
        id: editingId ?? undefined,
      });

      resetForm();
      await loadRows();
      setMessage(isEditing ? "Programme updated." : "Programme created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!canEdit) return;

    const ok = window.confirm("Delete this programme?");
    if (!ok) return;

    try {
      if (editingId === id) {
        resetForm();
      }

      await deleteProgramme(id);
      await loadRows();
      setMessage("Programme deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed");
    }
  }

  function editRow(row: ProgrammeRow) {
    setEditingId(row.id);
    setShowForm(true);

    setForm({
      id: row.id,
      programme_type: row.programme_type,
      programme_code: row.programme_code,
      programme_name: row.programme_name ?? "",
      programme_stream: row.programme_stream,
      programme_leader: row.programme_leader ?? "",
      articulation: row.articulation ?? "",
    });

    setMessage(`Editing programme: ${row.programme_code}`);
    scrollToForm();
  }

  return (
    <div className="page-container">
      <PageHeader
        title={pageTitle}
        description="Programme unique key: programme_code + programme_stream. HD rows may set Articulation (target Degree codes, e.g. UWLCS)."
      />

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      {canEdit && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleNew}
          >
            {t.create}
          </button>
        </div>
      )}

      {canEdit && showForm && (
        <form ref={formRef} className="card mb-4" onSubmit={handleSubmit}>
          <div className="card-body">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {isEditing ? t.edit : t.create}
                </h2>
                <p className="text-sm text-slate-500">
                  {isEditing
                    ? "Update the programme details and click Save."
                    : "Fill in the programme details and click Create."}
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

            <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
              <div>
                <label className="form-label">{t.programmeType}</label>
                <select
                  className="form-select"
                  value={form.programme_type}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      programme_type: event.target.value,
                    }))
                  }
                >
                  <option value="">Select</option>
                  <option value="HD">HD</option>
                  <option value="Degree">Degree</option>
                </select>
              </div>

              <div>
                <label className="form-label">{t.programmeCode}</label>
                <input
                  className="form-input"
                  value={form.programme_code}
                  disabled={isEditing}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      programme_code: event.target.value,
                    }))
                  }
                />
              </div>

              <div>
                <label className="form-label">{t.programmeName}</label>
                <input
                  className="form-input"
                  value={form.programme_name ?? ""}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      programme_name: event.target.value,
                    }))
                  }
                />
              </div>

              <div>
                <label className="form-label">{t.programmeStream}</label>
                <input
                  className="form-input"
                  value={form.programme_stream ?? ""}
                  placeholder="nil"
                  disabled={isEditing}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      programme_stream: event.target.value,
                    }))
                  }
                />
              </div>

              <div>
                <label className="form-label">{t.programmeLeader}</label>
                <input
                  className="form-input"
                  value={form.programme_leader ?? ""}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      programme_leader: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="md:col-span-3 lg:col-span-2">
                <label className="form-label">{t.articulation}</label>
                <input
                  className="form-input"
                  value={form.articulation ?? ""}
                  placeholder="e.g. UWLCS or UWLBS/WUBM"
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      articulation: event.target.value,
                    }))
                  }
                />
                <p className="mt-1 text-xs text-slate-500">{t.articulationHint}</p>
              </div>

              <div className="flex items-end gap-2">
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? t.loading : isEditing ? t.save : t.create}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => setForm(emptyForm)}
                >
                  {t.reset}
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
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "type",
              header: t.programmeType,
              render: (row) => row.programme_type,
            },
            {
              key: "code",
              header: t.programmeCode,
              render: (row) => row.programme_code,
            },
            {
              key: "name",
              header: t.programmeName,
              render: (row) => row.programme_name ?? "-",
            },
            {
              key: "stream",
              header: t.programmeStream,
              render: (row) => row.programme_stream,
            },
            {
              key: "leader",
              header: t.programmeLeader,
              render: (row) => row.programme_leader ?? "-",
            },
            {
              key: "articulation",
              header: t.articulation,
              render: (row) => row.articulation ?? "-",
            },
            {
              key: "actions",
              header: t.action,
              render: (row) =>
                canEdit ? (
                  <div className="flex gap-2">
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
                ) : (
                  "-"
                ),
            },
          ]}
        />
      )}
    </div>
  );
}
