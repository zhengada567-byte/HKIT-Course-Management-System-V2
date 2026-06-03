import { useEffect, useMemo, useRef, useState } from "react";

import {
  uploadInitialStudyPlanExcel,
  type InitialStudyPlanUploadResult,
} from "../../../../services/initialStudyPlanUploadService";

import {
  listProgrammeOptions,
  syncStudyPlanPostSave,
  type ProgrammeOption,
} from "../../../../services/studyPlanService";
import { buildInitialStudyPlanTemplateCsv } from "../../../../services/studyPlanTemplateService";

import { isDegreeProgramme } from "../helpers";

interface InitialStudyPlanUploadProps {
  onUploaded?: () => void | Promise<void>;
}

export function InitialStudyPlanUpload({
  onUploaded,
}: InitialStudyPlanUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [programmeOptions, setProgrammeOptions] = useState<ProgrammeOption[]>(
    []
  );
  const [programmeCode, setProgrammeCode] = useState("");

  const [loadingOptions, setLoadingOptions] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [syncingTimetable, setSyncingTimetable] = useState(false);
  const [syncTimetableAfterUpload, setSyncTimetableAfterUpload] = useState(
    true
  );
  const [result, setResult] = useState<InitialStudyPlanUploadResult | null>(
    null
  );

  const selectedProgrammeType = useMemo(() => {
    return programmeOptions.find((item) => item.programmeCode === programmeCode)
      ?.programmeType;
  }, [programmeOptions, programmeCode]);

  const isDegree = useMemo(
    () => isDegreeProgramme(programmeCode, selectedProgrammeType),
    [programmeCode, selectedProgrammeType]
  );

  useEffect(() => {
    async function loadOptions() {
      setLoadingOptions(true);

      try {
        const options = await listProgrammeOptions();
        setProgrammeOptions(options);
      } catch (error) {
        console.error(
          "[InitialStudyPlanUpload] Failed to load programmes:",
          error
        );
      } finally {
        setLoadingOptions(false);
      }
    }

    void loadOptions();
  }, []);

  const programmeCodes = useMemo(() => {
    return Array.from(
      new Set(
        programmeOptions
          .map((item) => item.programmeCode)
          .filter(Boolean)
      )
    ).sort();
  }, [programmeOptions]);

  async function downloadTemplate() {
    if (!programmeCode) return;

    setTemplateLoading(true);

    try {
      const csv = await buildInitialStudyPlanTemplateCsv({
        programmeCode,
        isDegree,
      });

      const blob = new Blob([csv], {
        type: "text/csv;charset=utf-8;",
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${
        isDegree ? "degree" : "initial"
      }_study_plan_${programmeCode}_template.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("[InitialStudyPlanUpload] Template download failed:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Failed to download study plan template."
      );
    } finally {
      setTemplateLoading(false);
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    if (!programmeCode) {
      setResult({
        totalRows: 0,
        totalStudents: 0,
        successStudents: 0,
        failedStudents: 0,
        skippedModuleCells: 0,
        savedStudentIds: [],
        errors: [
          {
            message: "Please select programme code first.",
          },
        ],
        warnings: [],
      });

      if (inputRef.current) {
        inputRef.current.value = "";
      }

      return;
    }

    setUploading(true);
    setUploadStatus("正在解析 Excel…");
    setResult(null);

    try {
      setUploadStatus("正在保存學生修課計劃…");

      const uploadResult = await uploadInitialStudyPlanExcel(
        file,
        { programmeCode },
        {
          relaxed: isDegree,
          skipTimetableSync: !syncTimetableAfterUpload,
        }
      );

      if (syncTimetableAfterUpload && uploadResult.successStudents > 0) {
        setUploadStatus("正在同步課表人數（全庫掃描，可能需數分鐘）…");
      }

      setResult(uploadResult);

      if (uploadResult.successStudents > 0) {
        await onUploaded?.();
      }
    } catch (error: any) {
      setResult({
        totalRows: 0,
        totalStudents: 0,
        successStudents: 0,
        failedStudents: 0,
        skippedModuleCells: 0,
        savedStudentIds: [],
        errors: [
          {
            message: error?.message || "Failed to upload initial study plan.",
          },
        ],
        warnings: [],
      });
    } finally {
      setUploading(false);
      setUploadStatus("");

      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  async function handleSyncTimetable() {
    setSyncingTimetable(true);

    try {
      await syncStudyPlanPostSave();
      setResult((previous) =>
        previous
          ? { ...previous, timetableSyncSkipped: false }
          : previous
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Timetable sync failed.";

      setResult((previous) => ({
        totalRows: previous?.totalRows ?? 0,
        totalStudents: previous?.totalStudents ?? 0,
        successStudents: previous?.successStudents ?? 0,
        failedStudents: (previous?.failedStudents ?? 0) + 1,
        skippedModuleCells: previous?.skippedModuleCells ?? 0,
        savedStudentIds: previous?.savedStudentIds ?? [],
        warnings: previous?.warnings ?? [],
        errors: [
          ...(previous?.errors ?? []),
          { message: `Timetable sync failed: ${message}` },
        ],
      }));
    } finally {
      setSyncingTimetable(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">
            Initial Study Plan Excel Upload
          </h2>

          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Select a programme, then upload its initial study plan Excel file.
              Student information is read from the Excel file.
            </p>

            {!isDegree && (
              <>
                <p>
                  Template and upload use the same CSV layout as{" "}
                  <span className="font-medium text-gray-700">Export CSV</span>:
                  student profile columns, then repeating{" "}
                  <span className="font-medium text-gray-700">
                    Module code
                  </span>{" "}
                  /{" "}
                  <span className="font-medium text-gray-700">Study term</span>{" "}
                  pairs. Study term may be e.g.{" "}
                  <span className="font-medium text-gray-700">T2026A</span> or{" "}
                  <span className="font-medium text-gray-700">Exempted</span>.
                </p>

                <p>
                  Optional columns:{" "}
                  <span className="font-medium text-gray-700">Articulation</span>{" "}
                  (Yes/No), <span className="font-medium text-gray-700">remark1</span>,{" "}
                  <span className="font-medium text-gray-700">remark2</span>.
                  Module codes with underscores or hyphens must stay exact
                  (e.g. HD403_HDC, AF-01).
                </p>
              </>
            )}

            {isDegree && (
              <>
                <p>
                  Template matches Export CSV: student profile columns, then{" "}
                  <span className="font-medium text-gray-700">
                    Module code / Study term
                  </span>{" "}
                  pairs for bridging modules only. Degree modules are generated
                  by the system after upload.
                </p>

                <p>
                  Use up to{" "}
                  <span className="font-medium text-gray-700">7 bridging pairs</span>{" "}
                  (or more columns if the template lists more codes). Leave all
                  module cells empty if no bridging is required.
                </p>

                <p>
                  Bridging module codes must belong to the articulated HD
                  programme and stream configured in{" "}
                  <span className="font-medium text-gray-700">
                    programmes.articulation
                  </span>
                  . Common modules with{" "}
                  <span className="font-medium text-gray-700">
                    programme stream = nil
                  </span>{" "}
                  are also allowed.
                </p>

                <p>
                  If all 7 bridging module fields are empty, the system treats
                  the student as not requiring bridging modules. Degree modules
                  will start from the student&apos;s intake term.
                </p>
              </>
            )}
          </div>

          {!isDegree && (
            <div className="mt-3 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
              <div className="font-semibold">Template columns (same as export)</div>
              <div>
                student ID, Student Name, Intake term, Intake Level, study mode,
                programme code, programme stream, Articulation, remark1, remark2,
                then Module code / Study term pairs for each programme module.
              </div>
            </div>
          )}

          {isDegree && (
            <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <div className="font-semibold">Degree programme upload rule</div>

              <div className="mt-1 space-y-1">
                <div>
                  Upload bridging modules only. Degree modules are generated by
                  the system.
                </div>

                <div>
                  If the last bridging study term is{" "}
                  <span className="font-mono">T2027A</span> or{" "}
                  <span className="font-mono">T2027B</span>, Degree modules
                  start from <span className="font-mono">T2027C</span>.
                </div>

                <div>
                  If the last bridging study term is{" "}
                  <span className="font-mono">T2027C</span>, Degree modules
                  start from <span className="font-mono">T2028A</span>.
                </div>

                <div>
                  If all bridging module fields are empty, or all Module
                  code / Study term pairs are empty, degree modules start from
                  the Excel intake term.
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Programme Code
            </label>

            <select
              value={programmeCode}
              onChange={(event) => {
                setProgrammeCode(event.target.value);
                setResult(null);
              }}
              disabled={loadingOptions || uploading}
              className="w-full rounded border px-3 py-2 text-sm"
            >
              <option value="">
                {loadingOptions ? "Loading..." : "Select programme"}
              </option>

              {programmeCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>

            {programmeCodes.length === 0 && !loadingOptions && (
              <p className="mt-1 text-xs text-yellow-700">
                No programme options found. Please check Study Plan Settings.
              </p>
            )}

            {programmeCode && (
              <p className="mt-1 text-xs text-muted-foreground">
                Upload mode:{" "}
                <span className="font-medium">
                  {isDegree
                    ? "Degree programme bridging upload"
                    : "Programme module study plan upload"}
                </span>
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Excel File
            </label>

            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              disabled={uploading || !programmeCode}
              className="block w-full text-sm"
            />

            <p className="mt-1 text-xs text-muted-foreground">
              Supported file types: .xlsx, .xls, .csv
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void downloadTemplate()}
            disabled={!programmeCode || uploading || templateLoading}
            className="rounded bg-gray-100 px-3 py-2 text-sm hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {templateLoading ? "Preparing template..." : "Download Template"}
          </button>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={syncTimetableAfterUpload}
              onChange={(event) =>
                setSyncTimetableAfterUpload(event.target.checked)
              }
              disabled={uploading}
              className="rounded"
            />
            上傳完成後同步課表人數（較慢，會掃描全部修課計劃）
          </label>

          {uploading && (
            <span className="text-sm text-blue-600">
              {uploadStatus || "Uploading and saving study plans..."}
            </span>
          )}
        </div>
      </div>

      {result && (
        <div className="rounded-md border bg-gray-50 p-3 text-sm">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <div>
              <div className="text-gray-500">Total Rows</div>
              <div className="font-semibold">{result.totalRows}</div>
            </div>

            <div>
              <div className="text-gray-500">Students</div>
              <div className="font-semibold">{result.totalStudents}</div>
            </div>

            <div>
              <div className="text-gray-500">Success</div>
              <div className="font-semibold text-green-600">
                {result.successStudents}
              </div>
            </div>

            <div>
              <div className="text-gray-500">Failed</div>
              <div className="font-semibold text-red-600">
                {result.failedStudents}
              </div>
            </div>

            <div>
              <div className="text-gray-500">Skipped Cells</div>
              <div className="font-semibold text-yellow-700">
                {result.skippedModuleCells}
              </div>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 font-semibold text-red-600">Errors</div>

              <div className="max-h-56 overflow-auto rounded border bg-white">
                {result.errors.map((error, index) => (
                  <div
                    key={`error-${index}`}
                    className="border-b px-3 py-2 last:border-b-0"
                  >
                    {error.row && (
                      <span className="mr-2 font-medium">
                        Row {error.row}:
                      </span>
                    )}

                    {error.studentId && (
                      <span className="mr-2 font-medium">
                        Student {error.studentId}:
                      </span>
                    )}

                    <span>{error.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.warnings.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 font-semibold text-yellow-700">
                Warnings
              </div>

              <div className="max-h-56 overflow-auto rounded border bg-white">
                {result.warnings.map((warning, index) => (
                  <div
                    key={`warning-${index}`}
                    className="border-b px-3 py-2 last:border-b-0"
                  >
                    {warning.row && (
                      <span className="mr-2 font-medium">
                        Row {warning.row}:
                      </span>
                    )}

                    {warning.studentId && (
                      <span className="mr-2 font-medium">
                        Student {warning.studentId}:
                      </span>
                    )}

                    {warning.moduleCode && (
                      <span className="mr-2 font-medium">
                        Module {warning.moduleCode}:
                      </span>
                    )}

                    <span>{warning.message}</span>

                    {warning.value && (
                      <span className="ml-2 text-gray-500">
                        Value: {warning.value}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.timetableSyncSkipped && result.successStudents > 0 && (
            <div className="mt-4 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900">
              <p>
                學生已保存。為加快上傳，此次未同步課表人數。需要更新課表時請按下方按鈕。
              </p>
              <button
                type="button"
                onClick={() => void handleSyncTimetable()}
                disabled={syncingTimetable}
                className="mt-2 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {syncingTimetable ? "正在同步課表…" : "立即同步課表人數"}
              </button>
            </div>
          )}

          {result.successStudents > 0 && result.errors.length === 0 && (
            <div className="mt-4 rounded bg-green-50 px-3 py-2 text-green-700">
              Upload completed successfully. Student list has been refreshed.
              {!result.timetableSyncSkipped &&
                syncTimetableAfterUpload &&
                " Timetable student numbers were synced."}
            </div>
          )}

          {result.successStudents > 0 && result.errors.length > 0 && (
            <div className="mt-4 rounded bg-green-50 px-3 py-2 text-green-700">
              Partial upload: {result.successStudents} student(s) saved.
              Review errors for rows that were not imported.
            </div>
          )}

          {result.savedStudentIds.length > 0 &&
            result.totalStudents > result.successStudents && (
              <div className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                <div className="font-medium">
                  {result.totalStudents - result.successStudents} student(s) were
                  not saved. Check Errors above (e.g. Row 22).
                </div>
                <div className="mt-1 text-xs">
                  Saved IDs: {result.savedStudentIds.join(", ")}
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
