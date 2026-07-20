-- Academic calendar time-slot breaks (Daily timetable only)
-- Used to block specific date + time ranges (e.g. mid-autumn evening).

create table if not exists public.academic_calendar_time_breaks (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  break_name text not null,

  start_date date not null,
  end_date date not null,

  start_time time not null,
  end_time time not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint academic_calendar_time_breaks_date_range check (
    end_date >= start_date
  ),

  -- For v1 we assume the time range does not cross midnight.
  constraint academic_calendar_time_breaks_time_range check (
    end_time > start_time
  )
);

create index if not exists academic_calendar_time_breaks_year_idx
  on public.academic_calendar_time_breaks (academic_year);

alter table public.academic_calendar_time_breaks enable row level security;

drop policy if exists "Allow anon all academic_calendar_time_breaks"
  on public.academic_calendar_time_breaks;

create policy "Allow anon all academic_calendar_time_breaks"
  on public.academic_calendar_time_breaks
  for all
  to anon
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.academic_calendar_time_breaks
  to anon;

