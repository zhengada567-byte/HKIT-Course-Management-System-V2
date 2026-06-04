-- Optional PL note per session (e.g. make-up reason).

alter table public.timetable_sessions
  add column if not exists remark text;

comment on column public.timetable_sessions.remark is
  'Programme leader note (e.g. make-up linked to a cancelled L/T slot).';
