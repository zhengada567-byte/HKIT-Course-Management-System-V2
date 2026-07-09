import { useState } from "react";

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
  const { academicYear } = useAcademicYear();
  const { t } = useLanguage();

  const [employmentType, setEmploymentType] = useState<TeachingStatus>("FT");
  const [rows, setRows] = useState<TeacherLoadingSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function loadRows() {
    setLoading(true);
    setSearched(true);

    try {
      const data = await getTeacherLoadingSummary({
        academicYear,
        employmentType,
      });

      setRows(data);
    } finally {
      setLoading(false);
    }
  }

  const termColumns = (term: "sep" | "feb" | "jun") => {
    const termLabel =
      term === "sep"
        ? t.teacherLoadingTermSep
        : term === "feb"
          ? t.teacherLoadingTermFeb
          : t.teacherLoadingTermJun;

    return [
      {
        key: `${term}Modules`,
        header: `${termLabel} ${t.teacherLoadingModules}`,
        render: (row: TeacherLoadingSummaryRow) =>
          row[`${term}_actual_loading`],
      },
      {
        key: `${term}Hd`,
        header: `${termLabel} ${t.teacherLoadingHdModules}`,
        render: (row: TeacherLoadingSummaryRow) =>
          row[`${term}_hd_module_count`],
      },
      {
        key: `${term}Degree`,
        header: `${termLabel} ${t.teacherLoadingDegreeModules}`,
        render: (row: TeacherLoadingSummaryRow) =>
          row[`${term}_degree_module_count`],
      },
    ];
  };

  return (
    <div className="page-container">
      <PageHeader
        title={t.teacherLoading}
        description={t.teacherLoadingDescription}
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
            <label className="form-label">{t.teacherEmploymentStatus}</label>
            <select
              className="form-select"
              value={employmentType}
              onChange={(event) =>
                setEmploymentType(event.target.value as TeachingStatus)
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
      ) : !searched ? (
        <EmptyState message={t.teacherLoadingSearchHint} />
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
            ...termColumns("sep"),
            ...termColumns("feb"),
            ...termColumns("jun"),
            {
              key: "annualModules",
              header: `${t.annualActualLoading} (${t.teacherLoadingModules})`,
              render: (row) => row.annual_actual_loading,
            },
            {
              key: "annualHd",
              header: `${t.annualActualLoading} (${t.teacherLoadingHdModules})`,
              render: (row) => row.hd_module_count,
            },
            {
              key: "annualDegree",
              header: `${t.annualActualLoading} (${t.teacherLoadingDegreeModules})`,
              render: (row) => row.degree_module_count,
            },
          ]}
        />
      )}
    </div>
  );
}
