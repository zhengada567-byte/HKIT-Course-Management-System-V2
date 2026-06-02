-- Teacher not available time blocks (Mon-Sat × AM/PM/EVENING).

create table if not exists public.timetable_teacher_not_available (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  teacher_name text not null,

  -- 1..6 (Mon..Sat)
  weekday integer not null,
  period text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint timetable_teacher_not_available_weekday_check check (weekday >= 1 and weekday <= 6),
  constraint timetable_teacher_not_available_period_check check (period in ('AM', 'PM', 'EVENING'))
);

create unique index if not exists timetable_teacher_not_available_unique
  on public.timetable_teacher_not_available (academic_year, teacher_name, weekday, period);

create index if not exists timetable_teacher_not_available_year_teacher_idx
  on public.timetable_teacher_not_available (academic_year, teacher_name);

alter table public.timetable_teacher_not_available enable row level security;

drop policy if exists "Allow anon all timetable_teacher_not_available"
  on public.timetable_teacher_not_available;

create policy "Allow anon all timetable_teacher_not_available"
  on public.timetable_teacher_not_available
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "Allow authenticated all timetable_teacher_not_available"
  on public.timetable_teacher_not_available;

create policy "Allow authenticated all timetable_teacher_not_available"
  on public.timetable_teacher_not_available
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.timetable_teacher_not_available
  to anon;

grant select, insert, update, delete
  on public.timetable_teacher_not_available
  to authenticated;

