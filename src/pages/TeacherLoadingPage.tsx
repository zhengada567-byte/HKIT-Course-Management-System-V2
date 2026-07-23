import { Fragment, useState } from "react";

import { DataTable } from "../components/tables/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { PageHeader } from "../components/ui/PageHeader";
import { useAcademicYear } from "../contexts/AcademicYearContext";
import { useLanguage } from "../contexts/LanguageContext";
import {
  getTeacherLoadingSummary,
  downloadTeacherLoadingSummaryCsv,
  type TeacherLoadingSummaryRow,
} from "../services/loadingService";
import {
  formatContactHoursDisplay,
  getTeacherContactHoursSummary,
  downloadTeacherContactHoursCsv,
  type TeacherContactHoursRow,
  type TeacherContactHoursTermFilter,
} from "../services/teacherContactHoursService";
import type { TeachingStatus } from "../types";

type TeacherLoadingView = "moduleCounts" | "contactHours";

export function TeacherLoadingPage() {
  const { academicYear } = useAcademicYear();
  const { t } = useLanguage();

  const [view, setView] = useState<TeacherLoadingView>("moduleCounts");
  const [employmentType, setEmploymentType] = useState<TeachingStatus>("FT");
  const [termFilter, setTermFilter] =
    useState<TeacherContactHoursTermFilter>("All");
  const [moduleRows, setModuleRows] = useState<TeacherLoadingSummaryRow[]>([]);
  const [hoursRows, setHoursRows] = useState<TeacherContactHoursRow[]>([]);
  const [expandedTeachers, setExpandedTeachers] = useState<Set<string>>(
    () => new Set()
  );
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  function switchView(next: TeacherLoadingView) {
    setView(next);
    setSearched(false);
    setModuleRows([]);
    setHoursRows([]);
    setExpandedTeachers(new Set());
  }

  async function loadRows() {
    setLoading(true);
    setSearched(true);
    setExpandedTeachers(new Set());

    try {
      if (view === "moduleCounts") {
        const data = await getTeacherLoadingSummary({
          academicYear,
          employmentType,
        });
        setModuleRows(data);
        setHoursRows([]);
      } else {
        const data = await getTeacherContactHoursSummary({
          academicYear,
          employmentType,
          term: termFilter,
        });
        setHoursRows(data);
        setModuleRows([]);
      }
    } finally {
      setLoading(false);
    }
  }

  function toggleTeacherExpanded(teacherName: string) {
    setExpandedTeachers((current) => {
      const next = new Set(current);
      if (next.has(teacherName)) {
        next.delete(teacherName);
      } else {
        next.add(teacherName);
      }
      return next;
    });
  }

  function handleDownload() {
    if (view === "moduleCounts") {
      if (moduleRows.length === 0) return;
      downloadTeacherLoadingSummaryCsv({
        rows: moduleRows,
        academicYear,
        employmentType,
      });
      return;
    }

    if (hoursRows.length === 0) return;
    downloadTeacherContactHoursCsv({
      rows: hoursRows,
      academicYear,
      employmentType,
      term: termFilter,
    });
  }

  const canDownload =
    searched &&
    !loading &&
    (view === "moduleCounts" ? moduleRows.length > 0 : hoursRows.length > 0);

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

  const description =
    view === "moduleCounts"
      ? t.teacherLoadingDescription
      : t.teacherContactHoursDescription;

  const searchHint =
    view === "moduleCounts"
      ? t.teacherLoadingSearchHint
      : t.teacherContactHoursSearchHint;

  return (
    <div className="page-container">
      <PageHeader title={t.teacherLoading} description={description} />

      <div className="card mb-4">
        <div className="card-body space-y-4">
          <div>
            <label className="form-label">{t.teacherLoadingView}</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className={`rounded-lg border px-3 py-3 text-sm font-medium transition ${
                  view === "moduleCounts"
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                }`}
                onClick={() => switchView("moduleCounts")}
              >
                {t.teacherLoadingViewModules}
              </button>
              <button
                type="button"
                className={`rounded-lg border px-3 py-3 text-sm font-medium transition ${
                  view === "contactHours"
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                }`}
                onClick={() => switchView("contactHours")}
              >
                {t.teacherLoadingViewContactHours}
              </button>
            </div>
          </div>

          <div
            className={`grid gap-3 ${
              view === "contactHours" ? "sm:grid-cols-4" : "sm:grid-cols-3"
            }`}
          >
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

            {view === "contactHours" ? (
              <div>
                <label className="form-label">{t.moduleTerm}</label>
                <select
                  className="form-select"
                  value={termFilter}
                  onChange={(event) =>
                    setTermFilter(
                      event.target.value as TeacherContactHoursTermFilter
                    )
                  }
                >
                  <option value="All">{t.teacherContactHoursTermAll}</option>
                  <option value="Sep">{t.teacherLoadingTermSep}</option>
                  <option value="Feb">{t.teacherLoadingTermFeb}</option>
                  <option value="Jun">{t.teacherLoadingTermJun}</option>
                </select>
              </div>
            ) : null}

            <div className="flex items-end gap-2">
              <button className="btn btn-primary" onClick={() => void loadRows()}>
                {t.search}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!canDownload}
                onClick={handleDownload}
              >
                {t.exportCsv}
              </button>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingState />
      ) : !searched ? (
        <EmptyState message={searchHint} />
      ) : view === "moduleCounts" ? (
        moduleRows.length === 0 ? (
          <EmptyState />
        ) : (
          <DataTable
            rows={moduleRows}
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
        )
      ) : hoursRows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-10" />
                <th>{t.teacherName}</th>
                <th>{t.teacherEmploymentStatus}</th>
                <th>{t.teacherContactHoursSessions}</th>
                <th>{t.teacherContactHoursLecture}</th>
                <th>{t.teacherContactHoursTutorial}</th>
                <th>{t.teacherContactHoursTotal}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {hoursRows.map((row) => {
                const expanded = expandedTeachers.has(row.teacher_name);

                return (
                  <Fragment key={row.teacher_name}>
                    <tr className="hover:bg-slate-50">
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary px-2 py-1 text-xs"
                          onClick={() => toggleTeacherExpanded(row.teacher_name)}
                          aria-expanded={expanded}
                        >
                          {expanded ? "−" : "+"}
                        </button>
                      </td>
                      <td>{row.teacher_name}</td>
                      <td>{row.teacher_employment_type ?? "-"}</td>
                      <td>{row.session_count}</td>
                      <td>{formatContactHoursDisplay(row.lecture_hours)}</td>
                      <td>{formatContactHoursDisplay(row.tutorial_hours)}</td>
                      <td className="font-medium">
                        {formatContactHoursDisplay(row.total_hours)}
                      </td>
                    </tr>
                    {expanded
                      ? row.modules.map((module) => (
                          <tr
                            key={`${row.teacher_name}:${module.timetable_module_id}`}
                            className="bg-slate-50/80 text-sm text-slate-700"
                          >
                            <td />
                            <td colSpan={2}>
                              <div className="pl-2">
                                <div className="font-medium text-slate-900">
                                  {module.module_instance_code ||
                                    module.module_code}
                                  {module.module_name
                                    ? ` — ${module.module_name}`
                                    : ""}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {[
                                    module.programme_code,
                                    module.module_term,
                                    module.module_code !==
                                    module.module_instance_code
                                      ? module.module_code
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </div>
                              </div>
                            </td>
                            <td>{module.session_count}</td>
                            <td>
                              {formatContactHoursDisplay(module.lecture_hours)}
                            </td>
                            <td>
                              {formatContactHoursDisplay(module.tutorial_hours)}
                            </td>
                            <td>
                              {formatContactHoursDisplay(module.total_hours)}
                            </td>
                          </tr>
                        ))
                      : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
