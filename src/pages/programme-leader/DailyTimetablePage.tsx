import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";

import { DailyModuleEditor } from "../../components/daily-timetable/DailyModuleEditor";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { downloadWeeklyDailyTimetableExcel } from "../../services/dailyTimetableExportService";
import {
  loadProgrammeDailyTimetable,
  type DailyTimetableBuildResult,
} from "../../services/dailyTimetableService";
import { listProgrammes } from "../../services/programmeService";
import {
  listTimetableClassrooms,
  type TimetableClassroomRow,
  type TimetableScheduleTerm,
} from "../../services/timetableScheduleService";
import {
  formatProgrammeCodeOptionLabel,
  isMixedProgrammeCode,
  MIXED_PROGRAMME_CODE,
  MIXED_STREAM_CODE,
} from "../../lib/timetableProgramme";
import { normalizeStream } from "../../lib/utils";
import type { ProgrammeRow } from "../../types";
import { displayStream } from "./make-timetable/helpers";

const termOptions: TimetableScheduleTerm[] = ["Sep", "Feb"];

export function DailyTimetablePage() {
  const { academicYear } = useAcademicYear();
  const { user } = useAuth();
  const { t } = useLanguage();

  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [programmeCode, setProgrammeCode] = useState("");
  const [streamCode, setStreamCode] = useState("");
  const [term, setTerm] = useState<TimetableScheduleTerm>("Sep");
  const [classrooms, setClassrooms] = useState<TimetableClassroomRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<DailyTimetableBuildResult | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void listProgrammes().then(setProgrammes);
    void listTimetableClassrooms().then(setClassrooms);
  }, []);

  const programmeCodes = useMemo(
    () =>
      [
        ...new Set(
          programmes.map((row) => String(row.programme_code ?? "").trim()).filter(Boolean)
        ),
      ].sort(),
    [programmes]
  );

  const programmeCodeOptions = useMemo(
    () => [...programmeCodes, MIXED_PROGRAMME_CODE],
    [programmeCodes]
  );

  const streamOptions = useMemo(() => {
    if (!programmeCode) return [];

    if (isMixedProgrammeCode(programmeCode)) {
      return [MIXED_STREAM_CODE];
    }

    const streams = programmes
      .filter((row) => row.programme_code === programmeCode)
      .map((row) => normalizeStream(row.programme_stream));

    return [...new Set(streams)].sort((a, b) => {
      if (a === "nil") return -1;
      if (b === "nil") return 1;
      return a.localeCompare(b);
    });
  }, [programmeCode, programmes]);

  async function reload() {
    if (!programmeCode) return;

    const data = await loadProgrammeDailyTimetable({
      academicYear,
      term,
      programmeCode,
      streamCode: streamCode || undefined,
      knownProgrammeCodes: programmeCodes,
    });

    setResult(data);
  }

  async function handleLoad() {
    if (!programmeCode) {
      setMessage("Please select a programme code.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const data = await loadProgrammeDailyTimetable({
        academicYear,
        term,
        programmeCode,
        streamCode: streamCode || undefined,
        knownProgrammeCodes: programmeCodes,
      });

      setResult(data);

      setMessage(
        data.modules.length === 0
          ? "No daily timetable found. Ask admin to generate daily labels first."
          : `Loaded daily timetable for ${data.modules.length} module(s).`
      );
    } catch (error) {
      setResult(null);
      setMessage(error instanceof Error ? error.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExportExcel() {
    if (!user) {
      setMessage("Please login before exporting.");
      return;
    }

    setExporting(true);
    setMessage("");

    try {
      await downloadWeeklyDailyTimetableExcel({
        academicYear,
        term,
        exportedByUserId: user.id,
        exportedByLabel: user.username,
      });
      setMessage("Weekly and daily timetable Excel downloaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.plDailyTimetable}
        description={t.plDailyTimetableDescription}
        actions={
          <button
            type="button"
            className="btn btn-primary inline-flex items-center gap-2"
            disabled={exporting}
            onClick={() => void handleExportExcel()}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {exporting ? t.loading : t.exportWeeklyDailyTimetableExcel}
          </button>
        }
      />

      <div className="card mb-4">
        <div className="card-body flex flex-wrap items-end gap-3">
          <div>
            <label className="form-label">{t.academicYear}</label>
            <input className="form-input bg-slate-50" value={academicYear} readOnly />
          </div>

          <div>
            <label className="form-label">{t.programmeCode}</label>
            <select
              className="form-select min-w-32"
              value={programmeCode}
              onChange={(event) => {
                setProgrammeCode(event.target.value);
                setStreamCode("");
              }}
            >
              <option value="">—</option>
              {programmeCodeOptions.map((code) => (
                <option key={code} value={code}>
                  {formatProgrammeCodeOptionLabel(code)}
                </option>
              ))}
            </select>
            {isMixedProgrammeCode(programmeCode) && (
              <p className="mt-1 text-xs text-slate-500">{t.mixedProgrammeHint}</p>
            )}
          </div>

          <div>
            <label className="form-label">{t.programmeStream}</label>
            <select
              className="form-select min-w-36"
              value={streamCode}
              onChange={(event) => setStreamCode(event.target.value)}
              disabled={!programmeCode}
            >
              <option value="">All</option>
              {streamOptions.map((stream) => (
                <option key={stream} value={stream}>
                  {isMixedProgrammeCode(stream)
                    ? formatProgrammeCodeOptionLabel(stream)
                    : displayStream(stream)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">{t.moduleTerm}</label>
            <select
              className="form-select"
              value={term}
              onChange={(event) =>
                setTerm(event.target.value as TimetableScheduleTerm)
              }
            >
              {termOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="btn btn-secondary inline-flex items-center gap-2"
            disabled={exporting}
            onClick={() => void handleExportExcel()}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {exporting ? t.loading : t.exportWeeklyDailyTimetableExcel}
          </button>

          <button
            type="button"
            className="btn btn-primary inline-flex items-center gap-2"
            disabled={loading || !programmeCode}
            onClick={() => void handleLoad()}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {loading ? t.loading : t.loadDailyTimetable}
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700 whitespace-pre-line">
          {message}
        </div>
      )}

      {result && result.warnings.length > 0 && (
        <div className="mb-4 max-h-32 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <ul className="list-disc pl-4">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {loading && <LoadingState />}

      {!loading && result && result.modules.length > 0 && (
        <DailyModuleEditor
          academicYear={academicYear}
          term={term}
          result={result}
          modulePlans={result.modules}
          classrooms={classrooms}
          changedBy={user?.username ?? null}
          onRefreshPlan={async () => {
            await reload();
          }}
          onMessage={setMessage}
        />
      )}

      {!loading && result && result.modules.length === 0 && <EmptyState />}
    </div>
  );
}
