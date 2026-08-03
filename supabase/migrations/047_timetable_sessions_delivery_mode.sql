alter table public.timetable_sessions
  add column if not exists delivery_mode text;

update public.timetable_sessions
set delivery_mode = 'F2F'
where delivery_mode is null
   or btrim(delivery_mode) = '';

alter table public.timetable_sessions
  alter column delivery_mode set default 'F2F';

alter table public.timetable_sessions
  drop constraint if exists timetable_sessions_delivery_mode_check;

alter table public.timetable_sessions
  add constraint timetable_sessions_delivery_mode_check
  check (delivery_mode is null or delivery_mode in ('F2F', 'Online'));
