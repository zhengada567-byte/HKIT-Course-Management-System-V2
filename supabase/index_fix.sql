create index if not exists idx_teaching_assignments_module
  on public.teaching_assignments (timetable_module_id);

create index if not exists idx_teaching_assignments_confirmed_version
  on public.teaching_assignments (academic_year, confirmed, assignment_version);

create index if not exists idx_timetable_student_numbers_key
  on public.timetable_student_numbers (academic_year, module_code, programme_code);

create index if not exists idx_combine_groups_code
  on public.combine_groups (academic_year, combined_code);

create index if not exists idx_combine_group_modules_group
  on public.combine_group_modules (combine_group_id);

create index if not exists idx_combine_group_modules_planning
  on public.combine_group_modules (planning_module_id);
