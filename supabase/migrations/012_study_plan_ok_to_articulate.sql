-- HD student profile: include in Degree new-intake report (articulated HD source) when true.
alter table public.study_plan_students
  add column if not exists ok_to_articulate boolean not null default true;

comment on column public.study_plan_students.ok_to_articulate is
  'When false, HD student is excluded from Degree new intake report (articulated HD counts only). Default true.';
