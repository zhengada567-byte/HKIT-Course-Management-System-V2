-- Per-instance scheduling preferences (e.g. Day/Saturday start time).

create table if not exists public.timetable_instance_preferences (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  module_instance_code text not null,

  -- Preferred start time for Day/Saturday (Night is fixed at 18:30).
  preferred_start_time time,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists timetable_instance_preferences_unique
  on public.timetable_instance_preferences (academic_year, module_instance_code);

create index if not exists timetable_instance_preferences_year_idx
  on public.timetable_instance_preferences (academic_year);

alter table public.timetable_instance_preferences enable row level security;

drop policy if exists "Allow anon all timetable_instance_preferences"
  on public.timetable_instance_preferences;

create policy "Allow anon all timetable_instance_preferences"
  on public.timetable_instance_preferences
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "Allow authenticated all timetable_instance_preferences"
  on public.timetable_instance_preferences;

create policy "Allow authenticated all timetable_instance_preferences"
  on public.timetable_instance_preferences
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.timetable_instance_preferences
  to anon;

grant select, insert, update, delete
  on public.timetable_instance_preferences
  to authenticated;

