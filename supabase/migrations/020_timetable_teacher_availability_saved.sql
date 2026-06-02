-- Records that a PL has saved/confirmed teacher availability (including "all available").

create table if not exists public.timetable_teacher_availability_saved (
  academic_year text not null,
  teacher_name text not null,
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (academic_year, teacher_name)
);

create index if not exists timetable_teacher_availability_saved_year_idx
  on public.timetable_teacher_availability_saved (academic_year);

alter table public.timetable_teacher_availability_saved enable row level security;

drop policy if exists "Allow anon all timetable_teacher_availability_saved"
  on public.timetable_teacher_availability_saved;

create policy "Allow anon all timetable_teacher_availability_saved"
  on public.timetable_teacher_availability_saved
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "Allow authenticated all timetable_teacher_availability_saved"
  on public.timetable_teacher_availability_saved;

create policy "Allow authenticated all timetable_teacher_availability_saved"
  on public.timetable_teacher_availability_saved
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.timetable_teacher_availability_saved
  to anon;

grant select, insert, update, delete
  on public.timetable_teacher_availability_saved
  to authenticated;

-- Backfill: teachers with existing NA rows were saved before this migration.
insert into public.timetable_teacher_availability_saved (academic_year, teacher_name, saved_at, updated_at)
select distinct academic_year, teacher_name, now(), now()
from public.timetable_teacher_not_available
on conflict (academic_year, teacher_name) do nothing;
