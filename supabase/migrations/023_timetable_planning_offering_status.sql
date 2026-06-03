-- Per academic year: mark modules as not offered without deleting modules catalogue rows.

alter table public.timetable_planning_modules
  add column if not exists offering_status text not null default 'active'
    check (offering_status in ('active', 'excluded'));

alter table public.timetable_planning_modules
  add column if not exists excluded_at timestamptz,
  add column if not exists excluded_by uuid references public.app_users(id) on delete set null;

comment on column public.timetable_planning_modules.offering_status is
  'active = on offering list for this academic year; excluded = PL decided not to run (modules row unchanged).';

create index if not exists idx_tpm_academic_programme_offering
  on public.timetable_planning_modules (academic_year, programme_code, offering_status);
