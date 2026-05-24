import { useEffect, useState } from "react";

import { getStudyPlanReports } from "../../../../services/studyPlanService";

export default function ReportsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadReports() {
    setLoading(true);

    try {
      const data = await getStudyPlanReports();
      setRows(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReports();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Reports</h2>
        <p className="text-sm text-muted-foreground">
          Student number statistics by programme, stream, intake, level, mode
          and status.
        </p>
      </div>

      <button
        className="px-4 py-2 rounded-md bg-muted text-sm"
        onClick={loadReports}
      >
        Refresh
      </button>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-2 text-left">Programme</th>
              <th className="p-2 text-left">Stream</th>
              <th className="p-2 text-left">Intake Year</th>
              <th className="p-2 text-left">Intake Level</th>
              <th className="p-2 text-left">Study Mode</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Intake Term</th>
              <th className="p-2 text-left">Graduate Term</th>
              <th className="p-2 text-left">Count</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td className="p-3" colSpan={9}>
                  Loading...
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr>
                <td className="p-3" colSpan={9}>
                  No report data found.
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((row, index) => (
                <tr key={index} className="border-t">
                  <td className="p-2">{row.programmeCode}</td>
                  <td className="p-2">{row.programmeStream || "-"}</td>
                  <td className="p-2">{row.intakeYear || "-"}</td>
                  <td className="p-2">{row.intakeLevel || "-"}</td>
                  <td className="p-2">{row.studyMode || "-"}</td>
                  <td className="p-2">{row.studentStatus || "-"}</td>
                  <td className="p-2">{row.intakeTerm || "-"}</td>
                  <td className="p-2">{row.graduateTerm || "-"}</td>
                  <td className="p-2 font-semibold">{row.studentCount}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
