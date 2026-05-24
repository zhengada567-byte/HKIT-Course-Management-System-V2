import type { UserRole } from "./auth";

import type {
  ActualStudentNumberStatus,
  AssignmentStatus,
  CombineGroupType,
  CombineStatus,
  CombineType,
  EmploymentType,
  ModuleTerm,
  SplitStatus,
  TeachingMode,
  TeachingStatus,
} from "./common";

export interface AppUserRow {
  id: string;
  username: string;
  password_hash: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface AppSettingRow {
  id: string;
  setting_key: string;
  setting_value: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgrammeRow {
  id: string;
  programme_type: string;
  programme_code: string;
  programme_name: string | null;
  programme_stream: string;
  stream_abbr: string | null;
  programme_leader: string | null;

  /**
   * Degree articulation rule.
   *
   * Example:
   * HDBC:nil
   * HDBC:nil;HDAI:Artificial Intelligence
   */
  articulation: string | null;

  created_at: string;
  updated_at: string;
}

export interface TeacherRow {
  id: string;
  title: string | null;
  family_name: string;
  other_name: string | null;
  teacher_name: string;
  employment_type: EmploymentType | null;
  academic_year: string;
  created_at: string;
  updated_at: string;
}

export interface ModuleRow {
  id: string;
  module_code: string;
  module_name: string | null;
  module_year: string | null;
  module_term: ModuleTerm;
  programme_code: string;
  stream_code: string;
  created_at: string;
  updated_at: string;
}

export interface ModuleAdjustmentRow {
  id: string;
  module_id: string;
  academic_year: string;
  adjusted_module_year: string | null;
  adjusted_module_term: ModuleTerm | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModuleEnrollmentRow {
  id: string;
  academic_year: string;
  module_code: string;
  module_term: ModuleTerm;
  programme_code: string;
  stream_code: string;
  expected_student_number: number;
  actual_student_number: number | null;
  created_at: string;
  updated_at: string;
}

export interface ModuleDefaultAssignmentRow {
  id: string;
  academic_year: string;
  module_code: string;
  module_term: ModuleTerm;
  programme_code: string;
  stream_code: string;
  teacher_name: string | null;
  teacher_title: string | null;
  teacher_family_name: string | null;
  teacher_other_name: string | null;
  teaching_status: TeachingStatus | null;
  mode: TeachingMode;
  created_at: string;
  updated_at: string;
}

export interface TimetablePlanningModuleRow {
  id: string;
  academic_year: string;
  module_id: string;
  programme_code: string;
  stream_code: string;
  module_code: string;
  module_name: string | null;
  module_year: string | null;
  module_term: ModuleTerm;
  natural_combine_code: string | null;
  manual_combine_group_id: string | null;
  split_status: SplitStatus;
  assignment_status: AssignmentStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimetableStudentNumberRow {
  id: string;
  academic_year: string;
  module_code: string;
  programme_code: string;
  programme_stream: string;
  /** Catalog offered term (Sep / Feb / Jun). */
  module_term: string | null;
  /** Actual run / intake term (T2025A, T2025B, ...). */
  study_term: string;
  expected_student_number: number;
  actual_student_number: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CombineGroupRow {
  id: string;
  academic_year: string;
  combined_code: string;
  combine_type: CombineGroupType;
  module_term: ModuleTerm;
  total_expected_student_number: number | null;
  total_actual_student_number: number | null;
  actual_student_number_status: ActualStudentNumberStatus | null;
  status: CombineStatus;
  created_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CombineGroupModuleRow {
  id: string;
  combine_group_id: string;
  planning_module_id: string;
  created_at: string;
}

export interface TimetableModuleRow {
  id: string;
  academic_year: string;
  planning_module_id: string | null;
  combine_group_id: string | null;
  programme_code: string;
  stream_code: string;
  base_module_code: string | null;
  combined_code: string | null;
  combine_type: CombineType;
  module_instance_code: string;
  module_name: string | null;
  module_year: string | null;
  module_term: ModuleTerm;
  mode: TeachingMode | null;
  expected_student_number: number | null;
  actual_student_number: number | null;
  split_group_size: number | null;
  split_confirmed: boolean;
  assignment_confirmed: boolean;
  confirmed_version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeachingAssignmentRow {
  id: string;
  timetable_module_id: string;
  academic_year: string;
  teacher_name: string;
  teacher_title: string | null;
  teacher_family_name: string | null;
  teacher_other_name: string | null;
  teacher_employment_type: EmploymentType | null;
  teaching_status: TeachingStatus;
  programme_type: string | null;
  combined_code: string | null;
  combine_type: CombineType;
  module_instance_code: string;
  module_term: ModuleTerm;
  assignment_version: number;
  confirmed: boolean;
  confirmed_at: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeacherActualLoadingRow {
  id: string;
  teacher_name: string;
  academic_year: string;
  module_term: ModuleTerm;
  teaching_status: TeachingStatus;
  teacher_employment_type: EmploymentType | null;
  actual_loading: number;
  hd_module_count: number;
  degree_module_count: number;
  source_confirmed_version: number | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  updated_at: string;
}

export interface ApprovedLoadingRow {
  id: string;
  teacher_title: string | null;
  teacher_family_name: string;
  teacher_other_name: string | null;
  teacher_name: string;
  academic_year: string;
  sep_term_approved_max_loading: number | null;
  feb_term_approved_max_loading: number | null;
  jun_term_approved_max_loading: number | null;
  confirmed: boolean;
  confirmed_at: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExportLogRow {
  id: string;
  export_type: "timetable_excel" | "approved_loading_pdf";
  academic_year: string;
  exported_by: string | null;
  exported_at: string;
  metadata: Record<string, unknown>;
}
