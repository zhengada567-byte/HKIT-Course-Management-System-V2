-- Academic calendar configuration + holidays (frontend uses anon key).

create table if not exists public.academic_calendars (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null unique,

  -- Academic year starts on this date (any day of week).
  start_date date not null,

  -- Only these two periods can create "holiday weeks" (must fully cover Mon-Sun week to be excluded).
  christmas_start date,
  christmas_end date,
  cny_start date,
  cny_end date,

  -- Draft vs published.
  published_at timestamptz,
  published_by text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint academic_calendars_christmas_range check (
    (christmas_start is null and christmas_end is null)
    or (christmas_start is not null and christmas_end is not null and christmas_end >= christmas_start)
  ),
  constraint academic_calendars_cny_range check (
    (cny_start is null and cny_end is null)
    or (cny_start is not null and cny_end is not null and cny_end >= cny_start)
  )
);

create index if not exists academic_calendars_year_idx
  on public.academic_calendars (academic_year);

alter table public.academic_calendars enable row level security;

drop policy if exists "Allow anon all academic_calendars"
  on public.academic_calendars;

create policy "Allow anon all academic_calendars"
  on public.academic_calendars
  for all
  to anon
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.academic_calendars
  to anon;


-- Additional school breaks (display only; do NOT affect week counting).
create table if not exists public.academic_calendar_breaks (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  break_name text not null,
  start_date date not null,
  end_date date not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint academic_calendar_breaks_range check (end_date >= start_date)
);

create index if not exists academic_calendar_breaks_year_idx
  on public.academic_calendar_breaks (academic_year);

alter table public.academic_calendar_breaks enable row level security;

drop policy if exists "Allow anon all academic_calendar_breaks"
  on public.academic_calendar_breaks;

create policy "Allow anon all academic_calendar_breaks"
  on public.academic_calendar_breaks
  for all
  to anon
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.academic_calendar_breaks
  to anon;


-- Hong Kong public holidays (display + weekday counts exclude these dates).
create table if not exists public.hk_public_holidays (
  holiday_date date primary key,
  holiday_name text not null,
  source text not null default '1823',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hk_public_holidays_date_idx
  on public.hk_public_holidays (holiday_date);

alter table public.hk_public_holidays enable row level security;

drop policy if exists "Allow anon all hk_public_holidays"
  on public.hk_public_holidays;

create policy "Allow anon all hk_public_holidays"
  on public.hk_public_holidays
  for all
  to anon
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.hk_public_holidays
  to anon;

