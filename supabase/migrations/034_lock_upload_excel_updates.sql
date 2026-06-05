-- Lock Upload Excel sidebar / page updates (default: locked).
insert into app_settings (setting_key, setting_value)
values
  ('lock_upload_excel_updates', 'true')
on conflict (setting_key) do nothing;
