import { useEffect, useState } from "react";

import { DataTable } from "../components/tables/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { PageHeader } from "../components/ui/PageHeader";
import { useAcademicYear } from "../contexts/AcademicYearContext";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../contexts/LanguageContext";
import { listProgrammes } from "../services/programmeService";
import {
  saveModuleAdjustment,
  searchCourses,
  type CourseSearchRow,
} from "../services/courseSearchService";
import type { ModuleTerm, ProgrammeRow } from "../types";

const termOptions: ModuleTerm[] = ["Sep", "Feb", "Jun"];

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function isCommonStreamModule(streamCode: string | null | undefined) {
  return normalizeText(streamCode) === "";
}

export function CourseSearchPage() {
  const { user } = useAuth();
  const { academicYear } = useAcademicYear();
  const { t } = useLanguage();

  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [programmeCode, setProgrammeCode] = useState("");
  const [streamCode, setStreamCode] = useState("");
  const [rows, setRows] = useState<CourseSearchRow[]>([]);
  const [loading, setLoading] = useState(false);

  const canEdit = user?.role === "programme_leader" || user?.role === "admin";

  async function loadProgrammes() {
    const data = await listProgrammes();
    setProgrammes(data);
  }

  async function loadRows() {
    setLoading(true);

    try {
      const data = await searchCourses({
        academicYear,
        programmeCode: programmeCode || undefined,
        streamCode: streamCode || undefined,
      });

      setRows(data);
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

  const programmeCodes = [
    ...new Set(
      programmes
        .map((p) => normalizeText(p.programme_code))
        .filter(Boolean)
    ),
  ];

  const streamOptions = programmes
    .filter((p) => !programmeCode || p.programme_code === programmeCode)
    .map((p) => normalizeText(p.programme_stream))
    .filter(Boolean);

  async function handleAdjustmentChange(
    row: CourseSearchRow,
    field: "year" | "term",
    value: string
  ) {
    if (!user) return;

    const nextYear =
      field === "year"
        ? value
        : row.adjusted_module_year ?? row.final_module_year;

    const nextTerm =
      field === "term"
        ? (value as ModuleTerm)
        : row.adjusted_module_term ?? row.final_module_term;

    await saveModuleAdjustment({
      moduleId: row.module_id,
      academicYear,
      adjustedModuleYear: nextYear,
      adjustedModuleTerm: nextTerm,
      updatedBy: user.id,
    });

    await loadRows();
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.courseSearch}
        description="Display module master data with PL adjusted module year / term applied."
      />

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

          <div className="flex items-end">
            <button className="btn btn-primary" onClick={loadRows}>
              {t.displayModules}
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
              render: (row) => row.module_code,
            },
            {
              key: "moduleName",
              header: t.moduleName,
              render: (row) => row.module_name ?? "-",
            },
            {
              key: "moduleYear",
              header: t.moduleYear,
              render: (row) =>
                canEdit ? (
                  <input
                    className="form-input min-w-24"
                    defaultValue={row.final_module_year ?? ""}
                    onBlur={(event) =>
                      handleAdjustmentChange(row, "year", event.target.value)
                    }
                  />
                ) : (
                  row.final_module_year ?? "-"
                ),
            },
            {
              key: "moduleTerm",
              header: t.moduleTerm,
              render: (row) =>
                canEdit ? (
                  <select
                    className="form-select min-w-24"
                    value={row.final_module_term}
                    onChange={(event) =>
                      handleAdjustmentChange(row, "term", event.target.value)
                    }
                  >
                    {termOptions.map((term) => (
                      <option key={term} value={term}>
                        {term}
                      </option>
                    ))}
                  </select>
                ) : (
                  row.final_module_term
                ),
            },
          ]}
        />
      )}
    </div>
  );
}
