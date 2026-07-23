-- Optional lock for Daily timetable L/T labels after manual kind changes
-- (e.g. promote Tutorial → Lecture). When set, relabel keeps session_kind
-- and only renumbers L1..Ln / T1..Tm by date.

alter table public.timetable_modules
  add column if not exists daily_label_plan_override jsonb;

comment on column public.timetable_modules.daily_label_plan_override is
  'Daily timetable label override, e.g. {"locked":true,"strategy":"preserve_kinds"}.';
