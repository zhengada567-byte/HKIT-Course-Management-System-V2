import { useEffect, useMemo, useRef, useState } from "react";

import {
  uploadInitialStudyPlanExcel,
  type InitialStudyPlanUploadResult,
} from "../../../../services/initialStudyPlanUploadService";

import {
  listProgrammeOptions,
  type ProgrammeOption,
} from "../../../../services/studyPlanService";

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
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<InitialStudyPlanUploadResult | null>(
    null
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

  function downloadTemplate() {
    /**
     * Important:
     *
     * Module codes may legally contain underscores "_" and hyphens "-".
     *
     * Examples:
     * - HD403_HDC
     * - CS404_EE
     * - CS408_EE
     * - AF-01
     *
     * These are proper module codes and must be preserved exactly.
     * Do not split them into HD403 / CS404 / CS408 / AF.
     */
    const headers = [
      "student id",
      "student name",
      "intake level",
      "intake term",
      "study mode",
      "sex",
      "programme stream",

      /**
       * Normal examples.
       */
      "HD401",
      "HD402",

      /**
       * Proper module codes with suffixes.
       * These should be preserved as complete module codes.
       */
      "HD403_HDC",
      "CS404_EE",
      "CS408_EE",
      "AF-01",
    ];

    const exampleRows = [
      [
        "S001",
        "Chan Tai Man",
        "",
        "T2026A",
        "FT",
        "",
        "Artificial Intelligence",

        /**
         * Module study term / exemption examples.
         */
        "T2026A",
        "T2026B",
        "Exempted",
        "T2026C",
        "T2027A",
        "",
      ],
    ];

    const csv = [
      headers.join(","),
      ...exampleRows.map((row) => row.join(",")),
    ].join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `initial_study_plan_${
      programmeCode || "programme"
    }_template.csv`;
    link.click();

    URL.revokeObjectURL(url);
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
    setResult(null);

    try {
      const uploadResult = await uploadInitialStudyPlanExcel(file, {
        programmeCode,
      });

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
        errors: [
          {
            message: error?.message || "Failed to upload initial study plan.",
          },
        ],
        warnings: [],
      });
    } finally {
      setUploading(false);

      if (inputRef.current) {
        inputRef.current.value = "";
      }
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

            <p>
              Each module should be placed as a column header. The cell value
              under that module should be the student&apos;s study term, such as{" "}
              <span className="font-medium text-gray-700">T2026A</span>, or an
              exemption value such as{" "}
              <span className="font-medium text-gray-700">Exempted</span>.
            </p>

            <p>
              Module codes containing underscores or hyphens are valid and must
              be preserved exactly. For example:{" "}
              <span className="font-medium text-gray-700">HD403_HDC</span>,{" "}
              <span className="font-medium text-gray-700">CS404_EE</span>,{" "}
              <span className="font-medium text-gray-700">CS408_EE</span>, and{" "}
              <span className="font-medium text-gray-700">AF-01</span>.
            </p>
          </div>

          <div className="mt-3 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
            <div className="font-semibold">Important module code rule</div>
            <div>
              Do not split module codes by underscore{" "}
              <span className="font-mono">_</span> or hyphen{" "}
              <span className="font-mono">-</span>. For example,{" "}
              <span className="font-mono">HD403_HDC</span> should remain{" "}
              <span className="font-mono">HD403_HDC</span>, and{" "}
              <span className="font-mono">AF-01</span> should remain{" "}
              <span className="font-mono">AF-01</span>.
            </div>
          </div>
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
            onClick={downloadTemplate}
            disabled={!programmeCode || uploading}
            className="rounded bg-gray-100 px-3 py-2 text-sm hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download Template
          </button>

          {uploading && (
            <span className="text-sm text-blue-600">
              Uploading and saving study plans...
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

          {result.errors.length === 0 && result.successStudents > 0 && (
            <div className="mt-4 rounded bg-green-50 px-3 py-2 text-green-700">
              Upload completed successfully. Student list has been refreshed.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
