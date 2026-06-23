create extension if not exists pgcrypto with schema extensions;

insert into public.app_users (username, role, password_hash)
values
  ('pl', 'programme_leader', extensions.crypt('pl', extensions.gen_salt('bf'))),
  ('admin', 'admin', extensions.crypt('admin', extensions.gen_salt('bf'))),
  ('staff', 'staff', null)
on conflict (username) do update
set
  role = excluded.role,
  password_hash = coalesce(public.app_users.password_hash, excluded.password_hash);

insert into public.app_settings (setting_key, setting_value)
values
  ('current_academic_year', '2026/2027')
on conflict (setting_key) do nothing;
