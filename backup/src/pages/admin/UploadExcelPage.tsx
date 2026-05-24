import { useState } from "react";
import * as XLSX from "xlsx";

import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { parseNumberOrNull } from "../../lib/utils";
import { upsertApprovedLoading } from "../../services/approvedLoadingService";
import {
  normalizeTeachingStatus,
  parseTeacherName,
  upsertModuleDefaultAssignments,
} from "../../services/moduleDefaultAssignmentService";
import { upsertModuleEnrollments } from "../../services/moduleEnrollmentService";
import { upsertModule } from "../../services/moduleService";
import { upsertProgramme } from "../../services/programmeService";
import { upsertTeacher } from "../../services/teacherService";
import type { ModuleTerm } from "../../types";

type UploadType = "programme" | "teacher" | "module" | "approved_loading";
type EmploymentType = "FT" | "PT" | "";

async function readExcelFile(file: File) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer);
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

  return XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: "",
  });
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[_\s]+/g, "");
}

function getValue(
  row: Record<string, unknown>,
  key: string,
  aliases: string[] = []
) {
  const possibleKeys = [key, ...aliases];

  for (const possibleKey of possibleKeys) {
    if (Object.prototype.hasOwnProperty.call(row, possibleKey)) {
      return row[possibleKey];
    }
  }

  const normalizedPossibleKeys = possibleKeys.map(normalizeHeader);

  const matchedKey = Object.keys(row).find((rowKey) =>
    normalizedPossibleKeys.includes(normalizeHeader(rowKey))
  );

  if (!matchedKey) {
    return "";
  }

  return row[matchedKey];
}

function getText(
  row: Record<string, unknown>,
  key: string,
  aliases: string[] = []
) {
  return String(getValue(row, key, aliases) ?? "").trim();
}

function getNumberOrNull(
  row: Record<string, unknown>,
  key: string,
  aliases: string[] = []
) {
  return parseNumberOrNull(getValue(row, key, aliases));
}

function normalizeEmploymentType(value: string): EmploymentType {
  const normalized = value.trim().toUpperCase();

  if (normalized === "FT" || normalized === "PT") {
    return normalized;
  }

  return "";
}

function normalizeModuleTerm(value: string): ModuleTerm {
  const normalized = value.trim().replace(/\s+/g, "");

  if (normalized === "Sep" || normalized === "Feb" || normalized === "Jun") {
    return normalized;
  }

  throw new Error(`Invalid Module Term: "${value}"`);
}

function normalizeUploadStream(value: string | null | undefined) {
  const text = String(value ?? "").trim();

  return text === "" ? "nil" : text;
}

function isSkippableModuleRow(row: Record<string, unknown>) {
  const moduleCode = getText(row, "Module Code", [
    "module code",
    "module_code",
  ]);

  const programmeCode = getText(row, "Programme Code", [
    "programme code",
    "programme_code",
    "program code",
    "program_code",
  ]);

  const moduleTerm = getText(row, "Module Term", [
    "module term",
    "module_term",
    "term",
  ]);

  return !moduleCode || !programmeCode || !moduleTerm;
}

async function uploadModuleRows(params: {
  rows: Record<string, unknown>[];
  academicYear: string;
}) {
  const enrollmentPayload = [];
  const defaultAssignmentPayload = [];
  const teacherMap = new Map<
    string,
    {
      title: string;
      family_name: string;
      other_name: string;
      employment_type: EmploymentType;
      academic_year: string;
    }
  >();

  let moduleCount = 0;

  for (const row of params.rows) {
    if (isSkippableModuleRow(row)) {
      continue;
    }

    const moduleTerm = normalizeModuleTerm(
      getText(row, "Module Term", [
        "module term",
        "module_term",
        "term",
      ])
    );

    const moduleCode = getText(row, "Module Code", [
      "module code",
      "module_code",
    ]);

    const moduleName = getText(row, "Module Name", [
      "module name",
      "module_name",
    ]);

    const moduleYear = getText(row, "Module Year", [
      "module year",
      "module_year",
      "year",
    ]);

    const programmeCode = getText(row, "Programme Code", [
      "programme code",
      "programme_code",
      "program code",
      "program_code",
    ]);

    const streamCode = normalizeUploadStream(
      getText(row, "Stream Code", [
        "stream code",
        "stream_code",
        "stream",
      ])
    );

    const expectedStudentNumber =
      getNumberOrNull(row, "Enrollment Student Number", [
        "enrollment student number",
        "expected student number",
        "expected_student_number",
      ]) ?? 0;

    const actualStudentNumber = getNumberOrNull(row, "Actual Student Number", [
      "actual student number",
      "actual_student_number",
    ]);

    const proposedTeacher = getText(row, "Proposed Teacher", [
      "proposed teacher",
      "proposed_teacher",
      "teacher",
    ]);

    const teachingStatus = normalizeTeachingStatus(
      getText(row, "Teaching Status", [
        "teaching status",
        "teaching_status",
        "ft/pt",
      ])
    );

    await upsertModule({
      module_code: moduleCode,
      module_name: moduleName,
      module_year: moduleYear,
      module_term: moduleTerm,
      programme_code: programmeCode,
      stream_code: streamCode,
    });

    moduleCount += 1;

    enrollmentPayload.push({
      academic_year: params.academicYear,
      module_code: moduleCode,
      module_term: moduleTerm,
      programme_code: programmeCode,
      stream_code: streamCode,
      expected_student_number: expectedStudentNumber,
      actual_student_number: actualStudentNumber,
    });

    const parsedTeacher = parseTeacherName(proposedTeacher);

    defaultAssignmentPayload.push({
      academic_year: params.academicYear,
      module_code: moduleCode,
      module_term: moduleTerm,
      programme_code: programmeCode,
      stream_code: streamCode,
      teacher_name: parsedTeacher.teacher_name,
      teacher_title: parsedTeacher.teacher_title,
      teacher_family_name: parsedTeacher.teacher_family_name,
      teacher_other_name: parsedTeacher.teacher_other_name,
      teaching_status: teachingStatus,
      mode: "Night",
    });

    if (
      parsedTeacher.teacher_name &&
      parsedTeacher.teacher_name.toLowerCase() !== "tbc"
    ) {
      teacherMap.set(parsedTeacher.teacher_name, {
        title: parsedTeacher.teacher_title ?? "",
        family_name: parsedTeacher.teacher_family_name ?? "",
        other_name: parsedTeacher.teacher_other_name ?? "",
        employment_type: (teachingStatus ?? "") as EmploymentType,
        academic_year: params.academicYear,
      });
    }
  }

  for (const teacher of teacherMap.values()) {
    await upsertTeacher(teacher);
  }

  await upsertModuleEnrollments(enrollmentPayload);
  await upsertModuleDefaultAssignments(defaultAssignmentPayload);

  return {
    modules: moduleCount,
    enrollments: enrollmentPayload.length,
    defaultAssignments: defaultAssignmentPayload.length,
    teachers: teacherMap.size,
  };
}

export function UploadExcelPage() {
  const { user } = useAuth();
  const { academicYear } = useAcademicYear();
  const { t } = useLanguage();

  const [uploadType, setUploadType] = useState<UploadType>("programme");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  async function handleUpload() {
    if (!file) {
      setMessage("Please select an Excel file.");
      return;
    }

    if (!user) {
      setMessage("Please login before uploading.");
      return;
    }

    setUploading(true);
    setMessage("");

    try {
      const rows = await readExcelFile(file);

      if (uploadType === "programme") {
        for (const row of rows) {
          await upsertProgramme({
            programme_type: getText(row, "Programme Type", [
              "programme type",
              "program type",
            ]),
            programme_code: getText(row, "Programme Code", [
              "programme code",
              "program code",
            ]),
            programme_name: getText(row, "Programme Name", [
              "programme name",
              "program name",
            ]),
            programme_stream: getText(row, "Programme Stream", [
              "programme stream",
              "program stream",
              "stream",
              "stream code",
              "stream_code",
            ]),
            stream_abbr: getText(row, "Stream Abbr", [
              "stream abbr",
              "stream_abbr",
              "stream abbreviation",
              "stream_abbreviation",
              "abbr",
            ]),
            programme_leader: getText(row, "Programme Leader", [
              "programme leader",
              "program leader",
            ]),
          });
        }

        setMessage(`Upload completed. ${rows.length} programme rows processed.`);
      }

      if (uploadType === "teacher") {
        for (const row of rows) {
          const employmentType = normalizeEmploymentType(
            getText(row, "Employment Type", [
              "employment type",
              "employment_type",
            ])
          );

          await upsertTeacher({
            title: getText(row, "Title", ["title"]),
            family_name: getText(row, "Family Name", [
              "family name",
              "family_name",
              "surname",
            ]),
            other_name: getText(row, "Other Name", [
              "other name",
              "other_name",
              "given name",
              "given_name",
            ]),
            employment_type: employmentType,
            academic_year:
              getText(row, "Academic Year", [
                "academic year",
                "academic_year",
              ]) || academicYear,
          });
        }

        setMessage(`Upload completed. ${rows.length} teacher rows processed.`);
      }

      if (uploadType === "module") {
        const result = await uploadModuleRows({
          rows,
          academicYear,
        });

        setMessage(
          `Upload completed. Modules: ${result.modules}, enrollments: ${result.enrollments}, default assignments: ${result.defaultAssignments}, teachers: ${result.teachers}.`
        );
      }

      if (uploadType === "approved_loading") {
        for (const row of rows) {
          await upsertApprovedLoading({
            teacher_title: getText(row, "Title", ["title"]),
            teacher_family_name: getText(row, "Family Name", [
              "family name",
              "family_name",
              "surname",
            ]),
            teacher_other_name: getText(row, "Other Name", [
              "other name",
              "other_name",
              "given name",
              "given_name",
            ]),
            academic_year:
              getText(row, "Academic Year", [
                "academic year",
                "academic_year",
              ]) || academicYear,
            sep_term_approved_max_loading: getNumberOrNull(
              row,
              "Sep Term Approved Max Loading",
              [
                "sep term approved max loading",
                "sep_term_approved_max_loading",
                "september term approved max loading",
                "september_term_approved_max_loading",
              ]
            ),
            feb_term_approved_max_loading: getNumberOrNull(
              row,
              "Feb Term Approved Max Loading",
              [
                "feb term approved max loading",
                "feb_term_approved_max_loading",
                "february term approved max loading",
                "february_term_approved_max_loading",
              ]
            ),
            jun_term_approved_max_loading: getNumberOrNull(
              row,
              "Jun Term Approved Max Loading",
              [
                "jun term approved max loading",
                "jun_term_approved_max_loading",
                "june term approved max loading",
                "june_term_approved_max_loading",
              ]
            ),
            updated_by: user.id,
          });
        }

        setMessage(
          `Upload completed. ${rows.length} approved loading rows processed.`
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.uploadExcel}
        description="Admin upload supports Programme, Teacher, Module and Approved Loading."
      />

      <div className="card max-w-3xl">
        <div className="card-body space-y-4">
          <div>
            <label className="form-label">Upload Type</label>
            <select
              className="form-select"
              value={uploadType}
              onChange={(event) =>
                setUploadType(event.target.value as UploadType)
              }
            >
              <option value="programme">Programme</option>
              <option value="teacher">Teacher</option>
              <option value="module">Module</option>
              <option value="approved_loading">Approved Loading</option>
            </select>
          </div>

          <div>
            <label className="form-label">Excel File</label>
            <input
              className="form-input"
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>

          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Current Academic Year: <strong>{academicYear}</strong>
          </div>

          {message && (
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
              {message}
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={handleUpload}
            disabled={uploading}
          >
            {uploading ? t.loading : t.uploadExcel}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="card-header font-semibold">Expected Excel Headers</div>

          <div className="card-body space-y-3 text-sm text-slate-600">
            <p>
              <strong>Programme:</strong> Programme Type, Programme Code,
              Programme Name, Programme Stream, Stream Abbr, Programme Leader
            </p>

            <p>
              <strong>Teacher:</strong> Title, Family Name, Other Name,
              Employment Type
            </p>

            <p>
              <strong>Module:</strong> Module Code, Module Name, Module Year,
              Module Term, Programme Code, Stream Code, Enrollment Student
              Number, Actual Student Number, Proposed Teacher, Teaching Status
            </p>

            <p>
              <strong>Approved Loading:</strong> Title, Family Name, Other Name,
              Sep Term Approved Max Loading, Feb Term Approved Max Loading, Jun
              Term Approved Max Loading
            </p>

            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Lowercase and underscore headers are also accepted, for example:
              <br />
              <code>programme_code</code>, <code>programme_stream</code>,{" "}
              <code>stream_abbr</code>, <code>module code</code>,{" "}
              <code>module term</code>, <code>stream</code>,{" "}
              <code>proposed teacher</code>, <code>teaching status</code>,{" "}
              <code>enrollment student number</code>,{" "}
              <code>actual_student_number</code>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
