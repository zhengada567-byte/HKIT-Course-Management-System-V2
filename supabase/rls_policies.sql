/*
  HKIT Course Management System V3.5
  Idempotent RLS policies for custom frontend-controlled auth.

  Important:
  Since this system uses custom app_users instead of Supabase Auth,
  DB policies cannot know the current app role unless all writes go through RPC.
*/

alter table public.app_users enable row level security;
alter table public.app_settings enable row level security;
alter table public.programmes enable row level security;
alter table public.teachers enable row level security;
alter table public.modules enable row level security;
alter table public.module_adjustments enable row level security;
alter table public.timetable_planning_modules enable row level security;
alter table public.timetable_student_numbers enable row level security;
alter table public.combine_groups enable row level security;
alter table public.combine_group_modules enable row level security;
alter table public.timetable_modules enable row level security;
alter table public.teaching_assignments enable row level security;
alter table public.teacher_actual_loading enable row level security;
alter table public.approved_loading enable row level security;
alter table public.export_logs enable row level security;

/*
  Drop existing policies first, so this file can run repeatedly.
*/

drop policy if exists "Allow anon read app_users" on public.app_users;
drop policy if exists "Deny direct app_users select" on public.app_users;
drop policy if exists "Deny direct app_users insert" on public.app_users;
drop policy if exists "Deny direct app_users update" on public.app_users;
drop policy if exists "Deny direct app_users delete" on public.app_users;

drop policy if exists "Allow anon read app_settings" on public.app_settings;
drop policy if exists "Allow anon upsert app_settings" on public.app_settings;

drop policy if exists "Allow anon all programmes" on public.programmes;
drop policy if exists "Allow anon all teachers" on public.teachers;
drop policy if exists "Allow anon all modules" on public.modules;
drop policy if exists "Allow anon all module_adjustments" on public.module_adjustments;
drop policy if exists "Allow anon all timetable_planning_modules" on public.timetable_planning_modules;
drop policy if exists "Allow anon all timetable_student_numbers" on public.timetable_student_numbers;
drop policy if exists "Allow anon all combine_groups" on public.combine_groups;
drop policy if exists "Allow anon all combine_group_modules" on public.combine_group_modules;
drop policy if exists "Allow anon all timetable_modules" on public.timetable_modules;
drop policy if exists "Allow anon all teaching_assignments" on public.teaching_assignments;
drop policy if exists "Allow anon all teacher_actual_loading" on public.teacher_actual_loading;
drop policy if exists "Allow anon all approved_loading" on public.approved_loading;
drop policy if exists "Allow anon all export_logs" on public.export_logs;

/*
  app_users:
  Do NOT allow direct read of password_hash.
  Access should be through RPC only.
*/

create policy "Deny direct app_users select"
on public.app_users
for select
to anon
using (false);

create policy "Deny direct app_users insert"
on public.app_users
for insert
to anon
with check (false);

create policy "Deny direct app_users update"
on public.app_users
for update
to anon
using (false)
with check (false);

create policy "Deny direct app_users delete"
on public.app_users
for delete
to anon
using (false);

/*
  app_settings read/write.
  Frontend route restricts writing to Admin.
*/

create policy "Allow anon read app_settings"
on public.app_settings
for select
to anon
using (true);

create policy "Allow anon upsert app_settings"
on public.app_settings
for all
to anon
using (true)
with check (true);

/*
  Generic operational table policies.
  This matches the current custom-login architecture.
*/

create policy "Allow anon all programmes"
on public.programmes
for all
to anon
using (true)
with check (true);

create policy "Allow anon all teachers"
on public.teachers
for all
to anon
using (true)
with check (true);

create policy "Allow anon all modules"
on public.modules
for all
to anon
using (true)
with check (true);

create policy "Allow anon all module_adjustments"
on public.module_adjustments
for all
to anon
using (true)
with check (true);

create policy "Allow anon all timetable_planning_modules"
on public.timetable_planning_modules
for all
to anon
using (true)
with check (true);

create policy "Allow anon all timetable_student_numbers"
on public.timetable_student_numbers
for all
to anon
using (true)
with check (true);

create policy "Allow anon all combine_groups"
on public.combine_groups
for all
to anon
using (true)
with check (true);

create policy "Allow anon all combine_group_modules"
on public.combine_group_modules
for all
to anon
using (true)
with check (true);

create policy "Allow anon all timetable_modules"
on public.timetable_modules
for all
to anon
using (true)
with check (true);

create policy "Allow anon all teaching_assignments"
on public.teaching_assignments
for all
to anon
using (true)
with check (true);

create policy "Allow anon all teacher_actual_loading"
on public.teacher_actual_loading
for all
to anon
using (true)
with check (true);

create policy "Allow anon all approved_loading"
on public.approved_loading
for all
to anon
using (true)
with check (true);

create policy "Allow anon all export_logs"
on public.export_logs
for all
to anon
using (true)
with check (true);

/*
  Table grants.
*/

grant usage on schema public to anon;

grant select, insert, update, delete on public.app_settings to anon;
grant select, insert, update, delete on public.programmes to anon;
grant select, insert, update, delete on public.teachers to anon;
grant select, insert, update, delete on public.modules to anon;
grant select, insert, update, delete on public.module_adjustments to anon;
grant select, insert, update, delete on public.timetable_planning_modules to anon;
grant select, insert, update, delete on public.timetable_student_numbers to anon;
grant select, insert, update, delete on public.combine_groups to anon;
grant select, insert, update, delete on public.combine_group_modules to anon;
grant select, insert, update, delete on public.timetable_modules to anon;
grant select, insert, update, delete on public.teaching_assignments to anon;
grant select, insert, update, delete on public.teacher_actual_loading to anon;
grant select, insert, update, delete on public.approved_loading to anon;
grant select, insert on public.export_logs to anon;

/*
  app_users should be accessed through RPC only.
*/

revoke all on public.app_users from anon;

grant execute on function public.verify_app_user_password(text, text) to anon;
grant execute on function public.change_app_user_password(uuid, text, text) to anon;
