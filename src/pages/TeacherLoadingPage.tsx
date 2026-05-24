import { useEffect, useState } from "react";

import { DataTable } from "../components/tables/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { PageHeader } from "../components/ui/PageHeader";
import { useAcademicYear } from "../contexts/AcademicYearContext";
import { useLanguage } from "../contexts/LanguageContext";
import {
  getTeacherLoadingSummary,
  type TeacherLoadingSummaryRow,
} from "../services/loadingService";
import type { TeachingStatus } from "../types";

export function TeacherLoadingPage() {
  const { academicYear, previousAcademicYear } = useAcademicYear();
  const { t } = useLanguage();

  const [teachingStatus, setTeachingStatus] =
    useState<TeachingStatus>("FT");
  const [rows, setRows] = useState<TeacherLoadingSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadRows() {
    setLoading(true);

    try {
      const data = await getTeacherLoadingSummary({
        academicYear,
        previousAcademicYear,
        teachingStatus,
      });

      setRows(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, [academicYear, previousAcademicYear, teachingStatus]);

  return (
    <div className="page-container">
      <PageHeader
        title={t.teacherLoading}
        description="Actual loading uses teaching status. FT view shows approved loading; PT view does not."
      />

      <div className="card mb-4">
        <div className="card-body grid gap-3 sm:grid-cols-3">
          <div>
            <label className="form-label">{t.academicYear}</label>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              {academicYear}
            </div>
          </div>

          <div>
            <label className="form-label">
              {t.teachingStatusForThisModule}
            </label>
            <select
              className="form-select"
              value={teachingStatus}
              onChange={(event) =>
                setTeachingStatus(event.target.value as TeachingStatus)
              }
            >
              <option value="FT">FT</option>
              <option value="PT">PT</option>
            </select>
          </div>

          <div className="flex items-end">
            <button className="btn btn-primary" onClick={loadRows}>
              {t.search}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <DataTable
          rows={rows}
          rowKey={(row) => row.teacher_name}
          columns={[
            {
              key: "teacher",
              header: t.teacherName,
              render: (row) => row.teacher_name,
            },
            {
              key: "employment",
              header: t.teacherEmploymentStatus,
              render: (row) => row.teacher_employment_type ?? "-",
            },
            {
              key: "sepActual",
              header: "Sep Actual",
              render: (row) => row.sep_actual_loading,
            },
            ...(teachingStatus === "FT"
              ? [
                  {
                    key: "sepApproved",
                    header: "Sep Approved",
                    render: (row: TeacherLoadingSummaryRow) =>
                      row.sep_approved_loading ?? 0,
                  },
                ]
              : []),
            {
              key: "febActual",
              header: "Feb Actual",
              render: (row) => row.feb_actual_loading,
            },
            ...(teachingStatus === "FT"
              ? [
                  {
                    key: "febApproved",
                    header: "Feb Approved",
                    render: (row: TeacherLoadingSummaryRow) =>
                      row.feb_approved_loading ?? 0,
                  },
                ]
              : []),
            {
              key: "junActual",
              header: "Jun Actual",
              render: (row) => row.jun_actual_loading,
            },
            ...(teachingStatus === "FT"
              ? [
                  {
                    key: "junApproved",
                    header: "Jun Approved",
                    render: (row: TeacherLoadingSummaryRow) =>
                      row.jun_approved_loading ?? 0,
                  },
                ]
              : []),
            {
              key: "annualActual",
              header: t.annualActualLoading,
              render: (row) => row.annual_actual_loading,
            },
            ...(teachingStatus === "FT"
              ? [
                  {
                    key: "annualApproved",
                    header: t.annualApprovedLoading,
                    render: (row: TeacherLoadingSummaryRow) =>
                      row.annual_approved_loading ?? 0,
                  },
                ]
              : []),
            {
              key: "previous",
              header: t.previousYearActualLoading,
              render: (row) => row.previous_year_annual_actual_loading,
            },
            {
              key: "hd",
              header: "HD",
              render: (row) => row.hd_module_count,
            },
            {
              key: "degree",
              header: "Degree",
              render: (row) => row.degree_module_count,
            },
          ]}
        />
      )}
    </div>
  );
}
