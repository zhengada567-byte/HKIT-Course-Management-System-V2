import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { supabase } from "../lib/supabase";
import {
  formatDateTime,
  sanitizeAcademicYearForFilename,
} from "../lib/utils";
import {
  calculateAnnualApprovedLoading,
  isApprovedLoadingConfirmed,
} from "./approvedLoadingService";
import type {
  ApprovedLoadingRow,
  CombineGroupRow,
  ModuleRow,
  TeachingAssignmentRow,
  TimetableModuleRow,
  TimetableStudentNumberRow,
} from "../types";

const APP_USER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveExportLogUserId(exportedBy?: string | null) {
  const value = String(exportedBy ?? "").trim();
  return APP_USER_UUID_RE.test(value) ? value : null;
}

export async function logExport(params: {
  exportType: "timetable_excel" | "approved_loading_pdf";
  academicYear: string;
  /** app_users.id (UUID). Usernames are stored in metadata.exported_by_label instead. */
  exportedBy?: string | null;
  exportedByLabel?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const exportedByUuid = resolveExportLogUserId(params.exportedBy);
  const label = String(params.exportedByLabel ?? "").trim();
  const metadata: Record<string, unknown> = { ...(params.metadata ?? {}) };

  if (label) {
    metadata.exported_by_label = label;
  } else if (params.exportedBy && !exportedByUuid) {
    metadata.exported_by_label = String(params.exportedBy).trim();
  }

  const { error } = await supabase.from("export_logs").insert({
    export_type: params.exportType,
    academic_year: params.academicYear,
    exported_by: exportedByUuid,
    metadata,
  });

  if (error) {
    console.warn("[export] export_logs insert failed:", error.message);
  }
}

export async function downloadTimetableExcel(params: {
  academicYear: string;
  exportedBy: string;
  programmeCode?: string;
  streamCode?: string;
}) {
  const [
    { data: modules, error: moduleError },
    { data: studentNumbers, error: studentError },
    { data: combineGroups, error: combineError },
    { data: timetableModules, error: timetableError },
    { data: assignments, error: assignmentError },
  ] = await Promise.all([
    supabase.from("modules").select("*"),
    supabase
      .from("timetable_student_numbers")
      .select("*")
      .eq("academic_year", params.academicYear),
    supabase
      .from("combine_groups")
      .select("*")
      .eq("academic_year", params.academicYear),
    supabase
      .from("timetable_modules")
      .select("*")
      .eq("academic_year", params.academicYear),
    supabase
      .from("teaching_assignments")
      .select("*")
      .eq("academic_year", params.academicYear),
  ]);

  if (moduleError) throw moduleError;
  if (studentError) throw studentError;
  if (combineError) throw combineError;
  if (timetableError) throw timetableError;
  if (assignmentError) throw assignmentError;

  const timetableRows = (timetableModules ?? []) as TimetableModuleRow[];

  const hasUnconfirmed = timetableRows.some(
    (row) => !row.assignment_confirmed
  );

  if (timetableRows.length === 0 || hasUnconfirmed) {
    throw new Error("Please confirm assignment before downloading timetable Excel.");
  }

  const assignmentRows = (assignments ?? []) as TeachingAssignmentRow[];

  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet([
    {
      "Academic Year": params.academicYear,
      "Programme Code": params.programmeCode ?? "All",
      "Programme Stream": params.streamCode ?? "All",
      "Exported By": params.exportedBy,
      "Exported At": new Date().toISOString(),
      "Assignment Status": "confirmed",
      "Confirmed Version": Math.max(
        ...timetableRows.map((row) => row.confirmed_version)
      ),
    },
  ]);

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  const moduleSheet = XLSX.utils.json_to_sheet(
    ((modules ?? []) as ModuleRow[]).map((row) => ({
      "Programme Code": row.programme_code,
      "Stream Code": row.stream_code,
      "Module Code": row.module_code,
      "Module Name": row.module_name,
      "Original Module Year": row.module_year,
      "Original Module Term": row.module_term,
    }))
  );

  XLSX.utils.book_append_sheet(workbook, moduleSheet, "Modules");

  const studentSheet = XLSX.utils.json_to_sheet(
    ((studentNumbers ?? []) as TimetableStudentNumberRow[]).map((row) => ({
      "Academic Year": row.academic_year,
      "Module Code": row.module_code,
      "Programme Code": row.programme_code,
      "Expected Student Number": row.expected_student_number,
      "Actual Student Number": row.actual_student_number,
    }))
  );

  XLSX.utils.book_append_sheet(workbook, studentSheet, "Student Numbers");

  const combineSheet = XLSX.utils.json_to_sheet(
    ((combineGroups ?? []) as CombineGroupRow[]).map((row) => ({
      "Academic Year": row.academic_year,
      "Combined Code": row.combined_code,
      "Combine Type": row.combine_type,
      "Module Term": row.module_term,
      "Status": row.status,
      "Total Expected Students": row.total_expected_student_number,
      "Total Actual Students": row.total_actual_student_number,
      "Actual Student Number Status": row.actual_student_number_status,
    }))
  );

  XLSX.utils.book_append_sheet(workbook, combineSheet, "Combined Modules");

  const splitSheet = XLSX.utils.json_to_sheet(
    timetableRows.map((row) => ({
      "Academic Year": row.academic_year,
      "Programme Code": row.programme_code,
      "Stream Code": row.stream_code,
      "Base Module Code": row.base_module_code,
      "Combined Code": row.combined_code,
      "Combine Type": row.combine_type,
      "Module Instance Code": row.module_instance_code,
      "Module Name": row.module_name,
      "Module Year": row.module_year,
      "Module Term": row.module_term,
      "Expected Students": row.expected_student_number,
      "Actual Students": row.actual_student_number,
      "Split Group Size": row.split_group_size,
      "Split Confirmed": row.split_confirmed,
    }))
  );

  XLSX.utils.book_append_sheet(workbook, splitSheet, "Split Classes");

  const assignmentSheet = XLSX.utils.json_to_sheet(
    assignmentRows.map((row) => ({
      "Academic Year": row.academic_year,
      "Module Instance Code": row.module_instance_code,
      "Module Term": row.module_term,
      "Teacher Name": row.teacher_name,
      "Teacher Title": row.teacher_title,
      "Teacher Family Name": row.teacher_family_name,
      "Teacher Other Name": row.teacher_other_name,
      "Teacher Employment Status": row.teacher_employment_type,
      "Teaching Status for This Module": row.teaching_status,
      "Programme Type": row.programme_type,
      "Combine Type": row.combine_type,
      "Confirmed": row.confirmed,
      "Confirmed At": row.confirmed_at,
    }))
  );

  XLSX.utils.book_append_sheet(workbook, assignmentSheet, "Teacher Assignments");

  const buffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  });

  const fileName = params.programmeCode
    ? `HKIT_Timetable_${sanitizeAcademicYearForFilename(
        params.academicYear
      )}_${params.programmeCode}_${params.streamCode ?? "nil"}.xlsx`
    : `HKIT_Timetable_${sanitizeAcademicYearForFilename(
        params.academicYear
      )}_All_Programmes.xlsx`;

  saveAs(new Blob([buffer]), fileName);

  await logExport({
    exportType: "timetable_excel",
    academicYear: params.academicYear,
    exportedBy: params.exportedBy,
    metadata: {
      programmeCode: params.programmeCode ?? null,
      streamCode: params.streamCode ?? null,
    },
  });
}

export async function downloadApprovedLoadingPdf(params: {
  academicYear: string;
  exportedBy: string;
}) {
  const { data, error } = await supabase
    .from("approved_loading")
    .select("*")
    .eq("academic_year", params.academicYear)
    .order("teacher_name");

  if (error) throw error;

  const rows = (data ?? []) as ApprovedLoadingRow[];

  if (!isApprovedLoadingConfirmed(rows)) {
    throw new Error("Please confirm approved loading before downloading PDF.");
  }

  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });

  doc.setFontSize(14);
  doc.text("HKIT Course Management System", 14, 14);

  doc.setFontSize(12);
  doc.text("Approved Teaching Loading Report", 14, 22);

  doc.setFontSize(10);
  doc.text(`Academic Year: ${params.academicYear}`, 14, 30);
  doc.text(`Exported By: ${params.exportedBy}`, 14, 36);
  doc.text(`Exported At: ${formatDateTime(new Date().toISOString())}`, 14, 42);

  autoTable(doc, {
    startY: 50,
    head: [
      [
        "Teacher Name",
        "Title",
        "Family Name",
        "Other Name",
        "Sep",
        "Feb",
        "Jun",
        "Annual",
        "Confirmed",
        "Confirmed At",
        "Updated By",
        "Updated At",
      ],
    ],
    body: rows.map((row) => [
      row.teacher_name,
      row.teacher_title ?? "",
      row.teacher_family_name,
      row.teacher_other_name ?? "",
      row.sep_term_approved_max_loading ?? 0,
      row.feb_term_approved_max_loading ?? 0,
      row.jun_term_approved_max_loading ?? 0,
      calculateAnnualApprovedLoading(row),
      row.confirmed ? "Yes" : "No",
      formatDateTime(row.confirmed_at),
      row.updated_by ?? "",
      formatDateTime(row.updated_at),
    ]),
    styles: {
      fontSize: 8,
    },
    headStyles: {
      fillColor: [30, 64, 175],
    },
  });

  const fileName = `HKIT_Approved_Loading_${sanitizeAcademicYearForFilename(
    params.academicYear
  )}.pdf`;

  doc.save(fileName);

  await logExport({
    exportType: "approved_loading_pdf",
    academicYear: params.academicYear,
    exportedBy: params.exportedBy,
  });
}
