import { useEffect, useMemo, useState } from "react";

import { useAcademicYear } from "../../../../contexts/AcademicYearContext";
import {
  cn,
  getDefaultQuotaPlanningAcademicYear,
  getNextAcademicYear,
  getPreviousAcademicYear,
} from "../../../../lib/utils";
import {
  downloadModuleEnrollmentReportCsv,
  downloadStudentHeadcountReportCsv,
  getModuleEnrollmentReport,
  getStudentHeadcountReport,
  listModuleEnrollmentStudyTerms,
  type ModuleEnrollmentReportRow,
  type StudentHeadcountGroupBy,
  type StudentHeadcountReportRow,
} from "../../../../services/studyPlanReportService";
import {
  downloadNewIntakeReportCsv,
  getNewIntakeReport,
  type NewIntakeReport,
} from "../../../../services/newIntakeReportService";
import { listProgrammes } from "../../../../services/programmeService";

type ReportTab = "students" | "modules" | "new_intake";

export default function ReportsTab() {
  const { academicYear: currentAcademicYear } = useAcademicYear();
  const [activeTab, setActiveTab] = useState<ReportTab>("students");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [studentGroupBy, setStudentGroupBy] =
    useState<StudentHeadcountGroupBy>("programme_type");
  const [includeIntakeTerm, setIncludeIntakeTerm] = useState(false);
  const [studentRows, setStudentRows] = useState<StudentHeadcountReportRow[]>(
    []
  );

  const [includeBridging, setIncludeBridging] = useState(false);
  const [moduleProgrammeCode, setModuleProgrammeCode] = useState("");
  const [moduleStudyTerm, setModuleStudyTerm] = useState("");
  const [moduleStudyTerms, setModuleStudyTerms] = useState<string[]>([]);
  const [moduleRows, setModuleRows] = useState<ModuleEnrollmentReportRow[]>([]);

  const defaultPlanningYear = useMemo(
    () => getDefaultQuotaPlanningAcademicYear(currentAcademicYear),
    [currentAcademicYear]
  );

  const academicYearOptions = useMemo(() => {
    return [
      currentAcademicYear,
      getNextAcademicYear(currentAcademicYear),
      getPreviousAcademicYear(currentAcademicYear),
    ].filter((value, index, array) => array.indexOf(value) === index);
  }, [currentAcademicYear]);

  const [newIntakeAcademicYear, setNewIntakeAcademicYear] =
    useState(defaultPlanningYear);
  const [newIntakeProgrammeCode, setNewIntakeProgrammeCode] = useState("");
  const [newIntakeProgrammeOptions, setNewIntakeProgrammeOptions] = useState<
    { code: string; name: string | null; type: string | null }[]
  >([]);
  const [newIntakeReport, setNewIntakeReport] = useState<NewIntakeReport | null>(
    null
  );

  const totalStudentCount = useMemo(() => {
    return studentRows.reduce((sum, row) => sum + row.studentCount, 0);
  }, [studentRows]);

  const totalModuleEnrollmentCount = useMemo(() => {
    return moduleRows.reduce((sum, row) => sum + row.studentCount, 0);
  }, [moduleRows]);

  const moduleProgrammeCodes = useMemo(() => {
    return Array.from(
      new Set(moduleRows.map((row) => row.programmeCode).filter(Boolean))
    ).sort();
  }, [moduleRows]);

  const moduleRowBackgroundByIndex = useMemo(() => {
    const backgrounds: string[] = [];
    let useAltBackground = false;
    let previousModuleCode = "";

    for (const row of moduleRows) {
      if (row.moduleCode !== previousModuleCode) {
        useAltBackground = !useAltBackground;
        previousModuleCode = row.moduleCode;
      }

      backgrounds.push(useAltBackground ? "bg-slate-50" : "bg-white");
    }

    return backgrounds;
  }, [moduleRows]);

  async function loadStudentReport() {
    setLoading(true);

    try {
      const data = await getStudentHeadcountReport({
        groupBy: studentGroupBy,
        includeIntakeTerm,
      });

      setStudentRows(data);
    } finally {
      setLoading(false);
    }
  }

  async function loadModuleReport() {
    setLoading(true);

    try {
      const data = await getModuleEnrollmentReport({
        includeBridging,
        programmeCode: moduleProgrammeCode || undefined,
        studyTerm: moduleStudyTerm || undefined,
      });

      setModuleRows(data);
    } finally {
      setLoading(false);
    }
  }

  async function loadReports() {
    if (activeTab === "students") {
      await loadStudentReport();
      return;
    }

    if (activeTab === "modules") {
      await loadModuleReport();
      return;
    }

    await loadNewIntakeReport();
  }

  async function loadNewIntakeReport() {
    if (!newIntakeProgrammeCode) {
      setNewIntakeReport(null);
      return;
    }

    setLoading(true);
    try {
      const result = await getNewIntakeReport({
        academicYear: newIntakeAcademicYear,
        programmeCode: newIntakeProgrammeCode,
      });
      setNewIntakeReport(result);
    } finally {
      setLoading(false);
    }
  }

  async function handleExportNewIntake() {
    if (!newIntakeProgrammeCode) {
      return;
    }

    setExporting(true);

    try {
      const result = await downloadNewIntakeReportCsv({
        academicYear: newIntakeAcademicYear,
        programmeCode: newIntakeProgrammeCode,
      });

      alert(`Exported ${result.rowCount} row(s) to ${result.fileName}.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to export report.";

      alert(`Export failed:\n\n${message}`);
    } finally {
      setExporting(false);
    }
  }

  async function handleExportStudents() {
    setExporting(true);

    try {
      const result = await downloadStudentHeadcountReportCsv({
        groupBy: studentGroupBy,
        includeIntakeTerm,
      });

      alert(`Exported ${result.rowCount} row(s) to ${result.fileName}.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to export report.";

      alert(`Export failed:\n\n${message}`);
    } finally {
      setExporting(false);
    }
  }

  async function handleExportModules() {
    setExporting(true);

    try {
      const result = await downloadModuleEnrollmentReportCsv({
        includeBridging,
        programmeCode: moduleProgrammeCode || undefined,
        studyTerm: moduleStudyTerm || undefined,
      });

      alert(`Exported ${result.rowCount} row(s) to ${result.fileName}.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to export report.";

      alert(`Export failed:\n\n${message}`);
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    if (activeTab !== "modules") {
      return;
    }

    void listModuleEnrollmentStudyTerms()
      .then(setModuleStudyTerms)
      .catch(() => setModuleStudyTerms([]));
  }, [activeTab]);

  useEffect(() => {
    void loadReports();
  }, [
    activeTab,
    studentGroupBy,
    includeIntakeTerm,
    includeBridging,
    moduleProgrammeCode,
    moduleStudyTerm,
    newIntakeAcademicYear,
    newIntakeProgrammeCode,
  ]);

  useEffect(() => {
    if (activeTab !== "new_intake") return;

    void (async () => {
      try {
        const programmes = await listProgrammes();
        const map = new Map<
          string,
          { code: string; name: string | null; type: string | null }
        >();

        for (const row of programmes ?? []) {
          const code = String(row.programme_code ?? "").trim();
          if (!code) continue;
          if (!map.has(code)) {
            map.set(code, {
              code,
              name: row.programme_name ?? null,
              type: row.programme_type ?? null,
            });
          }
        }

        setNewIntakeProgrammeOptions(
          Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code))
        );
      } catch {
        setNewIntakeProgrammeOptions([]);
      }
    })();
  }, [activeTab]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Reports</h2>
        <p className="text-sm text-muted-foreground">
          Student headcount and module enrollment statistics from saved study
          plans.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`px-4 py-2 rounded-md text-sm ${
            activeTab === "students"
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
          onClick={() => setActiveTab("students")}
        >
          Student Headcount
        </button>

        <button
          type="button"
          className={`px-4 py-2 rounded-md text-sm ${
            activeTab === "modules"
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
          onClick={() => setActiveTab("modules")}
        >
          Module Enrollment
        </button>

        <button
          type="button"
          className={`px-4 py-2 rounded-md text-sm ${
            activeTab === "new_intake"
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
          onClick={() => setActiveTab("new_intake")}
        >
          New Intake
        </button>
      </div>

      {activeTab === "students" && (
        <div className="space-y-4">
          <div className="rounded-md border bg-white p-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label
                  htmlFor="student-report-group-by"
                  className="mb-1 block text-sm font-medium"
                >
                  Group By
                </label>
                <select
                  id="student-report-group-by"
                  value={studentGroupBy}
                  onChange={(event) =>
                    setStudentGroupBy(
                      event.target.value as StudentHeadcountGroupBy
                    )
                  }
                  disabled={loading}
                  className="w-full rounded border px-3 py-2 text-sm"
                >
                  <option value="programme_type">Programme Type</option>
                  <option value="programme_code">Programme Code</option>
                  <option value="programme_stream">
                    Programme Code + Stream
                  </option>
                </select>
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeIntakeTerm}
                    onChange={(event) =>
                      setIncludeIntakeTerm(event.target.checked)
                    }
                    disabled={loading}
                  />
                  Break down by Intake Term
                </label>
              </div>

              <div className="flex items-end gap-2">
                <button
                  type="button"
                  className="px-4 py-2 rounded-md bg-muted text-sm"
                  onClick={loadReports}
                  disabled={loading}
                >
                  Refresh
                </button>

                <button
                  type="button"
                  className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm disabled:opacity-50"
                  onClick={handleExportStudents}
                  disabled={loading || exporting}
                >
                  Export CSV
                </button>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              Total students in report:{" "}
              <span className="font-medium text-foreground">
                {totalStudentCount}
              </span>
            </p>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-2 text-left">Programme Type</th>
                  {(studentGroupBy === "programme_code" ||
                    studentGroupBy === "programme_stream") && (
                    <th className="p-2 text-left">Programme Code</th>
                  )}
                  {studentGroupBy === "programme_stream" && (
                    <th className="p-2 text-left">Programme Stream</th>
                  )}
                  {includeIntakeTerm && (
                    <th className="p-2 text-left">Intake Term</th>
                  )}
                  <th className="p-2 text-left">Student Count</th>
                </tr>
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td className="p-3" colSpan={6}>
                      Loading...
                    </td>
                  </tr>
                )}

                {!loading && studentRows.length === 0 && (
                  <tr>
                    <td className="p-3" colSpan={6}>
                      No report data found.
                    </td>
                  </tr>
                )}

                {!loading &&
                  studentRows.map((row, index) => (
                    <tr key={index} className="border-t">
                      <td className="p-2">{row.programmeType || "-"}</td>
                      {(studentGroupBy === "programme_code" ||
                        studentGroupBy === "programme_stream") && (
                        <td className="p-2">{row.programmeCode || "-"}</td>
                      )}
                      {studentGroupBy === "programme_stream" && (
                        <td className="p-2">{row.programmeStream || "-"}</td>
                      )}
                      {includeIntakeTerm && (
                        <td className="p-2">{row.intakeTerm || "-"}</td>
                      )}
                      <td className="p-2 font-semibold">{row.studentCount}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "modules" && (
        <div className="space-y-4">
          <div className="rounded-md border bg-white p-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label
                  htmlFor="module-report-programme-code"
                  className="mb-1 block text-sm font-medium"
                >
                  Programme Code Filter
                </label>
                <select
                  id="module-report-programme-code"
                  value={moduleProgrammeCode}
                  onChange={(event) =>
                    setModuleProgrammeCode(event.target.value)
                  }
                  disabled={loading}
                  className="w-full rounded border px-3 py-2 text-sm"
                >
                  <option value="">All programmes</option>
                  {moduleProgrammeCodes.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="module-report-study-term"
                  className="mb-1 block text-sm font-medium"
                >
                  Study Term Filter
                </label>
                <select
                  id="module-report-study-term"
                  value={moduleStudyTerm}
                  onChange={(event) => setModuleStudyTerm(event.target.value)}
                  disabled={loading}
                  className="w-full rounded border px-3 py-2 text-sm"
                >
                  <option value="">All study terms</option>
                  {moduleStudyTerms.map((term) => (
                    <option key={term} value={term}>
                      {term}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeBridging}
                    onChange={(event) =>
                      setIncludeBridging(event.target.checked)
                    }
                    disabled={loading}
                  />
                  Include bridging modules
                </label>
              </div>

              <div className="flex items-end gap-2">
                <button
                  type="button"
                  className="px-4 py-2 rounded-md bg-muted text-sm"
                  onClick={loadReports}
                  disabled={loading}
                >
                  Refresh
                </button>

                <button
                  type="button"
                  className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm disabled:opacity-50"
                  onClick={handleExportModules}
                  disabled={loading || exporting}
                >
                  Export CSV
                </button>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              Total planned module enrollments:{" "}
              <span className="font-medium text-foreground">
                {totalModuleEnrollmentCount}
              </span>
              . Counts only include modules with status planned and a study
              term.
            </p>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-2 text-left">Programme Code</th>
                  <th className="p-2 text-left">Stream</th>
                  <th className="p-2 text-left">Stage</th>
                  <th className="p-2 text-left">Module Code</th>
                  <th className="p-2 text-left">Module Name</th>
                  <th className="p-2 text-left">Study Term</th>
                  <th className="p-2 text-left">Student Count</th>
                </tr>
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td className="p-3" colSpan={7}>
                      Loading...
                    </td>
                  </tr>
                )}

                {!loading && moduleRows.length === 0 && (
                  <tr>
                    <td className="p-3" colSpan={7}>
                      No module enrollment data found.
                    </td>
                  </tr>
                )}

                {!loading &&
                  moduleRows.map((row, index) => (
                    <tr
                      key={`${row.moduleCode}-${row.programmeCode}-${row.programmeStream}-${row.planStage}-${row.studyTerm}-${index}`}
                      className={cn(
                        "border-t",
                        moduleRowBackgroundByIndex[index]
                      )}
                    >
                      <td className="p-2">{row.programmeCode}</td>
                      <td className="p-2">{row.programmeStream}</td>
                      <td className="p-2">{row.planStage}</td>
                      <td className="p-2 font-medium">{row.moduleCode}</td>
                      <td className="p-2">{row.moduleName}</td>
                      <td className="p-2">{row.studyTerm}</td>
                      <td className="p-2 font-semibold">{row.studentCount}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "new_intake" && (
        <div className="space-y-4">
          <div className="rounded-md border bg-white p-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label
                  htmlFor="new-intake-academic-year"
                  className="mb-1 block text-sm font-medium"
                >
                  Academic Year
                </label>
                <select
                  id="new-intake-academic-year"
                  value={newIntakeAcademicYear}
                  onChange={(event) => setNewIntakeAcademicYear(event.target.value)}
                  disabled={loading}
                  className="w-full rounded border px-3 py-2 text-sm"
                >
                  {academicYearOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="new-intake-programme-code"
                  className="mb-1 block text-sm font-medium"
                >
                  Programme
                </label>
                <select
                  id="new-intake-programme-code"
                  value={newIntakeProgrammeCode}
                  onChange={(event) => setNewIntakeProgrammeCode(event.target.value)}
                  disabled={loading}
                  className="w-full rounded border px-3 py-2 text-sm"
                >
                  <option value="">Select programme</option>
                  {newIntakeProgrammeOptions.map((row) => (
                    <option key={row.code} value={row.code}>
                      {row.code}
                      {row.name ? ` — ${row.name}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end gap-2">
                <button
                  type="button"
                  className="px-4 py-2 rounded-md bg-muted text-sm"
                  onClick={loadNewIntakeReport}
                  disabled={loading || !newIntakeProgrammeCode}
                >
                  Refresh
                </button>

                <button
                  type="button"
                  className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm disabled:opacity-50"
                  onClick={handleExportNewIntake}
                  disabled={
                    loading || exporting || !newIntakeProgrammeCode
                  }
                >
                  Export Student List CSV
                </button>
              </div>
            </div>

            {newIntakeReport && (
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>
                  Total new intake:{" "}
                  <span className="font-medium text-foreground">
                    {newIntakeReport.totals.total}
                  </span>{" "}
                  (FT {newIntakeReport.totals.ft}, PT {newIntakeReport.totals.pt})
                </p>
                {newIntakeReport.fromHd && (
                  <p>
                    From articulated HD (year total):{" "}
                    <span className="font-medium text-foreground">
                      {newIntakeReport.fromHd.total}
                    </span>{" "}
                    (FT {newIntakeReport.fromHd.ft}, PT {newIntakeReport.fromHd.pt})
                  </p>
                )}
                {newIntakeReport.fromDegreeBridging && (
                  <p>
                    From degree bridging (year total):{" "}
                    <span className="font-medium text-foreground">
                      {newIntakeReport.fromDegreeBridging.total}
                    </span>{" "}
                    (FT {newIntakeReport.fromDegreeBridging.ft}, PT{" "}
                    {newIntakeReport.fromDegreeBridging.pt})
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-2 text-left">Term</th>
                  <th className="p-2 text-left">Study Term</th>
                  <th className="p-2 text-left">Total FT</th>
                  <th className="p-2 text-left">Total PT</th>
                  <th className="p-2 text-left">From HD FT</th>
                  <th className="p-2 text-left">From HD PT</th>
                  <th className="p-2 text-left">From Degree Bridging FT</th>
                  <th className="p-2 text-left">From Degree Bridging PT</th>
                </tr>
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td className="p-3" colSpan={8}>
                      Loading...
                    </td>
                  </tr>
                )}

                {!loading && !newIntakeReport && (
                  <tr>
                    <td className="p-3" colSpan={8}>
                      Select academic year and programme to view breakdown.
                    </td>
                  </tr>
                )}

                {!loading &&
                  newIntakeReport?.terms.map((row) => (
                    <tr key={row.offeredTerm} className="border-t">
                      <td className="p-2 font-medium">{row.offeredTerm}</td>
                      <td className="p-2">{row.studyTerm}</td>
                      <td className="p-2 font-semibold">{row.totalFt}</td>
                      <td className="p-2 font-semibold">{row.totalPt}</td>
                      <td className="p-2">{row.fromHdFt}</td>
                      <td className="p-2">{row.fromHdPt}</td>
                      <td className="p-2">{row.fromDegreeBridgingFt}</td>
                      <td className="p-2">{row.fromDegreeBridgingPt}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
