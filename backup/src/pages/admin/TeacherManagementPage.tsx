import { useEffect, useState } from "react";

import { DataTable } from "../../components/tables/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  deleteTeacher,
  listTeachers,
  upsertTeacher,
  type TeacherInput,
} from "../../services/teacherService";
import type { EmploymentType, TeacherRow } from "../../types";

export function TeacherManagementPage() {
  const { academicYear } = useAcademicYear();
  const { t } = useLanguage();

  const [rows, setRows] = useState<TeacherRow[]>([]);
  const [form, setForm] = useState<TeacherInput>({
    title: "",
    family_name: "",
    other_name: "",
    employment_type: "",
    academic_year: academicYear,
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadRows() {
    setLoading(true);
    setMessage("");

    try {
      const data = await listTeachers(academicYear);
      setRows(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      academic_year: academicYear,
    }));
    void loadRows();
  }, [academicYear]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    try {
      if (!form.family_name.trim()) {
        setMessage("Family Name is required.");
        return;
      }

      await upsertTeacher({
        ...form,
        academic_year: academicYear,
      });

      setForm({
        title: "",
        family_name: "",
        other_name: "",
        employment_type: "",
        academic_year: academicYear,
      });

      await loadRows();
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    }
  }

  async function handleDelete(id: string) {
    const ok = window.confirm("Delete this teacher?");
    if (!ok) return;

    try {
      await deleteTeacher(id);
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed");
    }
  }

  function editRow(row: TeacherRow) {
    setForm({
      title: row.title ?? "",
      family_name: row.family_name,
      other_name: row.other_name ?? "",
      employment_type: row.employment_type ?? "",
      academic_year: row.academic_year,
    });
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.teacherManagement}
        description="Teacher name is generated from title + family name + other name. TBC is not stored here."
      />

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      <form className="card mb-4" onSubmit={handleSubmit}>
        <div className="card-body grid gap-3 md:grid-cols-6">
          <div>
            <label className="form-label">{t.teacherTitle}</label>
            <input
              className="form-input"
              value={form.title ?? ""}
              placeholder="Dr / Mr / Ms"
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  title: event.target.value,
                }))
              }
            />
          </div>

          <div>
            <label className="form-label">{t.teacherFamilyName}</label>
            <input
              className="form-input"
              value={form.family_name}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  family_name: event.target.value,
                }))
              }
            />
          </div>

          <div>
            <label className="form-label">{t.teacherOtherName}</label>
            <input
              className="form-input"
              value={form.other_name ?? ""}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  other_name: event.target.value,
                }))
              }
            />
          </div>

          <div>
            <label className="form-label">{t.teacherEmploymentStatus}</label>
            <select
              className="form-select"
              value={form.employment_type ?? ""}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  employment_type: event.target.value as EmploymentType,
                }))
              }
            >
              <option value="">-</option>
              <option value="FT">FT</option>
              <option value="PT">PT</option>
            </select>
          </div>

          <div>
            <label className="form-label">{t.academicYear}</label>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              {academicYear}
            </div>
          </div>

          <div className="flex items-end gap-2">
            <button className="btn btn-primary" type="submit">
              {t.save}
            </button>
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
              key: "name",
              header: t.teacherName,
              render: (row) => row.teacher_name,
            },
            {
              key: "title",
              header: t.teacherTitle,
              render: (row) => row.title ?? "-",
            },
            {
              key: "family",
              header: t.teacherFamilyName,
              render: (row) => row.family_name,
            },
            {
              key: "other",
              header: t.teacherOtherName,
              render: (row) => row.other_name ?? "-",
            },
            {
              key: "employment",
              header: t.teacherEmploymentStatus,
              render: (row) => row.employment_type ?? "-",
            },
            {
              key: "actions",
              header: t.action,
              render: (row) => (
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
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
