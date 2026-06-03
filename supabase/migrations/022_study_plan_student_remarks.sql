-- Optional PL remarks per student profile (import/export via study plan CSV).

alter table public.study_plan_students
  add column if not exists remark1 text,
  add column if not exists remark2 text;

comment on column public.study_plan_students.remark1 is
  'Optional remark field 1 for programme leader notes.';
comment on column public.study_plan_students.remark2 is
  'Optional remark field 2 for programme leader notes.';
