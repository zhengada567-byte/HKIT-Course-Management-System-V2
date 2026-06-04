-- Daily timetable: L/T labels and session kind on each timetable session row.

alter table public.timetable_sessions
  add column if not exists session_label text,
  add column if not exists session_kind text;

alter table public.timetable_sessions
  drop constraint if exists timetable_sessions_session_kind_check;

alter table public.timetable_sessions
  add constraint timetable_sessions_session_kind_check
  check (session_kind is null or session_kind in ('teaching', 'tutorial'));

comment on column public.timetable_sessions.session_label is
  'Daily plan label e.g. L1, T2. Assigned when admin generates daily timetable; re-ordered on PL edits.';
comment on column public.timetable_sessions.session_kind is
  'teaching or tutorial; mirrors label kind for reporting.';
