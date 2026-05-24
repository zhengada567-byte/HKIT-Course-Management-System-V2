import { useEffect, useState } from "react";

import { DataTable } from "../../components/tables/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  calculateAnnualApprovedLoading,
  confirmApprovedLoading,
  listApprovedLoading,
  updateApprovedLoadingValues,
} from "../../services/approvedLoadingService";
import { downloadApprovedLoadingPdf } from "../../services/exportService";
import type { ApprovedLoadingRow } from "../../types";

export function ApprovedLoadingPage() {
  const { user } = useAuth();
  const { academicYear } = useAcademicYear();
  const { t } = useLanguage();

  const [rows, setRows] = useState<ApprovedLoadingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadRows() {
    setLoading(true);
    setMessage("");

    try {
      const data = await listApprovedLoading(academicYear);
      setRows(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, [academicYear]);

  async function handleValueChange(
    row: ApprovedLoadingRow,
    field: "sep" | "feb" | "jun",
    value: string
  ) {
    if (!user) return;

    const nextSep =
      field === "sep"
        ? Number(value || 0)
        : Number(row.sep_term_approved_max_loading ?? 0);

    const nextFeb =
      field === "feb"
        ? Number(value || 0)
        : Number(row.feb_term_approved_max_loading ?? 0);

    const nextJun =
      field === "jun"
        ? Number(value || 0)
        : Number(row.jun_term_approved_max_loading ?? 0);

    await updateApprovedLoadingValues({
      id: row.id,
      sep: nextSep,
      feb: nextFeb,
      jun: nextJun,
      updatedBy: user.id,
    });

    await loadRows();
  }

  async function handleConfirm() {
    if (!user) return;

    setMessage("");

    try {
      await confirmApprovedLoading({
        academicYear,
        updatedBy: user.id,
      });

      await loadRows();
      setMessage("Approved loading confirmed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Confirm failed");
    }
  }

  async function handleDownloadPdf() {
    if (!user) return;

    setMessage("");

    try {
      await downloadApprovedLoadingPdf({
        academicYear,
        exportedBy: user.id,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PDF export failed");
    }
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.approvedLoading}
        description="President can edit and confirm approved teaching loading."
        actions={
          <>
            <button className="btn btn-success" onClick={handleConfirm}>
              Confirm Approved Loading
            </button>
            <button className="btn btn-primary" onClick={handleDownloadPdf}>
              {t.downloadApprovedLoadingPdf}
            </button>
          </>
        }
      />

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState message="No approved loading uploaded by Admin." />
      ) : (
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "teacher",
              header: t.teacherName,
              render: (row) => row.teacher_name,
            },
            {
              key: "title",
              header: t.teacherTitle,
              render: (row) => row.teacher_title ?? "-",
            },
            {
              key: "family",
              header: t.teacherFamilyName,
              render: (row) => row.teacher_family_name,
            },
            {
              key: "other",
              header: t.teacherOtherName,
              render: (row) => row.teacher_other_name ?? "-",
            },
            {
              key: "sep",
              header: "Sep",
              render: (row) => (
                <input
                  className="form-input w-24"
                  type="number"
                  min={0}
                  defaultValue={row.sep_term_approved_max_loading ?? 0}
                  onBlur={(event) =>
                    handleValueChange(row, "sep", event.target.value)
                  }
                />
              ),
            },
            {
              key: "feb",
              header: "Feb",
              render: (row) => (
                <input
                  className="form-input w-24"
                  type="number"
                  min={0}
                  defaultValue={row.feb_term_approved_max_loading ?? 0}
                  onBlur={(event) =>
                    handleValueChange(row, "feb", event.target.value)
                  }
                />
              ),
            },
            {
              key: "jun",
              header: "Jun",
              render: (row) => (
                <input
                  className="form-input w-24"
                  type="number"
                  min={0}
                  defaultValue={row.jun_term_approved_max_loading ?? 0}
                  onBlur={(event) =>
                    handleValueChange(row, "jun", event.target.value)
                  }
                />
              ),
            },
            {
              key: "annual",
              header: t.annualApprovedLoading,
              render: (row) => calculateAnnualApprovedLoading(row),
            },
            {
              key: "confirmed",
              header: t.status,
              render: (row) => (
                <StatusBadge status={row.confirmed ? "confirmed" : "pending"} />
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
