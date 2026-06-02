-- Timetable scheduling: classrooms + daily sessions (PL scheduling).

create table if not exists public.timetable_classrooms (
  room_code text primary key,
  room_size integer not null,
  room_type text not null default 'normal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timetable_classrooms_room_size_check check (room_size > 0),
  constraint timetable_classrooms_room_type_check check (room_type in ('normal', 'computer'))
);

create index if not exists timetable_classrooms_size_idx
  on public.timetable_classrooms (room_size);

alter table public.timetable_classrooms enable row level security;

drop policy if exists "Allow anon all timetable_classrooms"
  on public.timetable_classrooms;

create policy "Allow anon all timetable_classrooms"
  on public.timetable_classrooms
  for all
  to anon
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.timetable_classrooms
  to anon;


create table if not exists public.timetable_sessions (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  timetable_module_id uuid not null,
  module_instance_code text not null,
  module_code text not null,
  module_name text,

  session_date date not null,
  start_time time not null,
  end_time time not null,
  room_code text not null,

  status text not null default 'normal',
  session_number integer,

  -- Snapshots / overrides for testing stage (do not write back to assignments).
  teacher_name text,
  module_size integer,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint timetable_sessions_status_check check (status in ('normal', 'cancel', 'make_up')),
  constraint timetable_sessions_time_order check (end_time > start_time),
  constraint timetable_sessions_session_number_check check (session_number is null or session_number > 0),
  constraint timetable_sessions_module_size_check check (module_size is null or module_size >= 0),
  constraint timetable_sessions_module_fk foreign key (timetable_module_id) references public.timetable_modules(id) on delete cascade,
  constraint timetable_sessions_room_fk foreign key (room_code) references public.timetable_classrooms(room_code) on delete restrict
);

create index if not exists timetable_sessions_year_idx
  on public.timetable_sessions (academic_year);

create index if not exists timetable_sessions_module_idx
  on public.timetable_sessions (timetable_module_id, session_date);

create index if not exists timetable_sessions_room_time_idx
  on public.timetable_sessions (room_code, session_date, start_time, end_time);

-- Prevent duplicated rows for the exact same module session slot.
create unique index if not exists timetable_sessions_identity_unique
  on public.timetable_sessions (timetable_module_id, session_date, start_time, end_time, room_code);

alter table public.timetable_sessions enable row level security;

drop policy if exists "Allow anon all timetable_sessions"
  on public.timetable_sessions;

create policy "Allow anon all timetable_sessions"
  on public.timetable_sessions
  for all
  to anon
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.timetable_sessions
  to anon;

