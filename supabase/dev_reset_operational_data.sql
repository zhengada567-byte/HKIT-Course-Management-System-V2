/*
  Development only.
  Clears workflow data but keeps users, settings, programmes, teachers, modules.
*/

truncate table public.export_logs restart identity cascade;
truncate table public.teacher_actual_loading restart identity cascade;
truncate table public.teaching_assignments restart identity cascade;
truncate table public.timetable_modules restart identity cascade;
truncate table public.combine_group_modules restart identity cascade;
truncate table public.combine_groups restart identity cascade;
truncate table public.timetable_student_numbers restart identity cascade;
truncate table public.timetable_planning_modules restart identity cascade;
truncate table public.module_adjustments restart identity cascade;
