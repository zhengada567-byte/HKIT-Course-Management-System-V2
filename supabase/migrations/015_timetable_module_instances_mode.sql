alter table public.timetable_module_instances
  add column if not exists instance_mode text;

alter table public.timetable_module_instances
  drop constraint if exists timetable_module_instances_instance_mode_check;

alter table public.timetable_module_instances
  add constraint timetable_module_instances_instance_mode_check
  check (instance_mode is null or instance_mode in ('Day', 'Night', 'Saturday'));

