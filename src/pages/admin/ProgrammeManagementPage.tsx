import { useEffect, useState } from "react";

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
};

export function ProgrammeManagementPage() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [rows, setRows] = useState<ProgrammeRow[]>([]);
  const [form, setForm] = useState<ProgrammeInput>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const canEdit = user?.role === "admin";

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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!canEdit) return;

    setMessage("");

    try {
      if (!form.programme_type || !form.programme_code) {
        setMessage("Programme Type and Programme Code are required.");
        return;
      }

      await upsertProgramme(form);
      setForm(emptyForm);
      await loadRows();
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    }
  }

  async function handleDelete(id: string) {
    if (!canEdit) return;

    const ok = window.confirm("Delete this programme?");
    if (!ok) return;

    try {
      await deleteProgramme(id);
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed");
    }
  }

  function editRow(row: ProgrammeRow) {
    setForm({
      programme_type: row.programme_type,
      programme_code: row.programme_code,
      programme_name: row.programme_name ?? "",
      programme_stream: row.programme_stream,
      programme_leader: row.programme_leader ?? "",
    });
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.programmeManagement}
        description="Programme unique key: programme_code + programme_stream. Empty stream is stored as nil."
      />

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      {canEdit && (
        <form className="card mb-4" onSubmit={handleSubmit}>
          <div className="card-body grid gap-3 md:grid-cols-5">
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
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    programme_stream: event.target.value,
                  }))
                }
              />
            </div>

            <div className="flex items-end gap-2">
              <button className="btn btn-primary" type="submit">
                {t.save}
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
              key: "actions",
              header: t.action,
              render: (row) =>
                canEdit ? (
                  <div className="flex gap-2">
                    <button
                      className="btn btn-secondary py-1 text-xs"
                      onClick={() => editRow(row)}
                    >
                      {t.edit}
                    </button>
                    <button
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
