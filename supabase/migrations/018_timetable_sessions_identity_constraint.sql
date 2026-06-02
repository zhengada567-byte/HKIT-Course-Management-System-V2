-- Optional: named unique constraint for future upsert APIs.
-- Auto-schedule uses delete-then-insert and works with the unique index from 013 alone.
drop index if exists public.timetable_sessions_identity_unique;

alter table public.timetable_sessions
  drop constraint if exists timetable_sessions_identity_unique;

alter table public.timetable_sessions
  add constraint timetable_sessions_identity_unique
  unique (timetable_module_id, session_date, start_time, end_time, room_code);
