-- Admin-controlled locks for PL update/add on selected features.
insert into app_settings (setting_key, setting_value)
values
  ('lock_course_search_updates', 'true'),
  ('lock_module_teacher_updates', 'false')
on conflict (setting_key) do nothing;
