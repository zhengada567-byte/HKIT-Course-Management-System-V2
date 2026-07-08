-- Programme-specific allowed instances for timetable enrollment rules.
-- Generalized version of study_plan_core_enrollment_rules.

create table if not exists public.study_plan_enrollment_rules (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  module_term text not null,
  module_code text not null,
  programme_code text not null,
  allowed_instance_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_plan_enrollment_rules_term_check
    check (module_term in ('Sep', 'Feb', 'Jun'))
);

create unique index if not exists study_plan_enrollment_rules_unique
  on public.study_plan_enrollment_rules (
    academic_year,
    module_term,
    module_code,
    programme_code
  );

create index if not exists study_plan_enrollment_rules_year_term_idx
  on public.study_plan_enrollment_rules (academic_year, module_term);

alter table public.study_plan_enrollment_rules enable row level security;

drop policy if exists "Allow anon all study_plan_enrollment_rules"
  on public.study_plan_enrollment_rules;

create policy "Allow anon all study_plan_enrollment_rules"
  on public.study_plan_enrollment_rules
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "Allow authenticated all study_plan_enrollment_rules"
  on public.study_plan_enrollment_rules;

create policy "Allow authenticated all study_plan_enrollment_rules"
  on public.study_plan_enrollment_rules
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.study_plan_enrollment_rules
  to anon;

grant select, insert, update, delete
  on public.study_plan_enrollment_rules
  to authenticated;

