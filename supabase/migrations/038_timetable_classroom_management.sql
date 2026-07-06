-- Classroom management: location/room number fields + weekly not-available blocks.

alter table public.timetable_classrooms
  add column if not exists location text not null default '';

alter table public.timetable_classrooms
  add column if not exists room_number text not null default '';

update public.timetable_classrooms
set
  location = coalesce(nullif(split_part(room_code, '-', 1), ''), room_code),
  room_number = coalesce(nullif(split_part(room_code, '-', 2), ''), room_code)
where location = '' or room_number = '';

create table if not exists public.timetable_classroom_not_available (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  room_code text not null,

  -- 1..6 (Mon..Sat)
  weekday integer not null,
  period text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint timetable_classroom_not_available_weekday_check check (weekday >= 1 and weekday <= 6),
  constraint timetable_classroom_not_available_period_check check (period in ('AM', 'PM', 'EVENING')),
  constraint timetable_classroom_not_available_room_fk
    foreign key (room_code) references public.timetable_classrooms(room_code) on delete cascade
);

create unique index if not exists timetable_classroom_not_available_unique
  on public.timetable_classroom_not_available (academic_year, room_code, weekday, period);

create index if not exists timetable_classroom_not_available_year_room_idx
  on public.timetable_classroom_not_available (academic_year, room_code);

alter table public.timetable_classroom_not_available enable row level security;

drop policy if exists "Allow anon all timetable_classroom_not_available"
  on public.timetable_classroom_not_available;

create policy "Allow anon all timetable_classroom_not_available"
  on public.timetable_classroom_not_available
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "Allow authenticated all timetable_classroom_not_available"
  on public.timetable_classroom_not_available;

create policy "Allow authenticated all timetable_classroom_not_available"
  on public.timetable_classroom_not_available
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.timetable_classroom_not_available
  to anon;

grant select, insert, update, delete
  on public.timetable_classroom_not_available
  to authenticated;
