begin;

create table if not exists public.study_plan_students (
  id uuid primary key default gen_random_uuid(),

  student_id text not null,
  student_name text not null,

  intake_year text,
  intake_level text,

  study_mode text not null check (study_mode in ('FT', 'PT')),

  programme_code text not null,
  programme_stream text not null default '',

  student_status text not null default 'potential'
    check (student_status in ('potential', 'bridging', 'in_progress', 'graduated')),

  intake_term text,
  graduate_term text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint study_plan_students_student_id_key unique (student_id)
);

create table if not exists public.study_plan_modules (
  id uuid primary key default gen_random_uuid(),

  student_id text not null,
  student_profile_id uuid not null references public.study_plan_students(id) on delete cascade,

  programme_code text not null,
  programme_stream text not null default '',

  module_code text not null,
  module_name text not null,
  module_year text,
  module_term_pattern text,
  delivery_mode text,
  module_sequence integer,

  plan_stage text not null default 'programme'
    check (plan_stage in ('programme', 'bridging')),

  status text not null default 'planned'
    check (status in ('planned', 'exempted', 'failed')),

  study_term text,

  is_exempted boolean not null default false,
  is_failed boolean not null default false,
  is_locked boolean not null default false,

  remark text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint study_plan_modules_unique
    unique (
      student_profile_id,
      module_code,
      plan_stage
    )
);

create table if not exists public.programme_stream_quotas (
  id uuid primary key default gen_random_uuid(),

  academic_year text not null,
  programme_code text not null,
  programme_stream text not null default '',

  programme_quota integer,
  stream_quota integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint programme_stream_quotas_unique
    unique (
      academic_year,
      programme_code,
      programme_stream
    )
);

create table if not exists public.programme_quota_confirmations (
  id uuid primary key default gen_random_uuid(),

  academic_year text not null,
  programme_code text not null,
  programme_quota integer not null default 0 check (programme_quota >= 0),

  confirmed_at timestamptz,
  confirmed_by text,

  admin_unlocked_until timestamptz,
  admin_unlocked_by text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint programme_quota_confirmations_unique
    unique (academic_year, programme_code)
);

create table if not exists public.degree_hd_affiliations (
  id uuid primary key default gen_random_uuid(),

  hd_programme_code text not null,
  hd_programme_stream text not null default '',

  degree_programme_code text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint degree_hd_affiliations_unique
    unique (
      hd_programme_code,
      hd_programme_stream,
      degree_programme_code
    )
);

create table if not exists public.study_plan_settings (
  id uuid primary key default gen_random_uuid(),

  setting_key text not null unique,
  setting_value text not null,

  updated_at timestamptz not null default now()
);

create table if not exists public.study_plan_actual_student_numbers (
  id uuid primary key default gen_random_uuid(),

  academic_year text not null,
  study_term text not null,

  module_code text not null,
  module_name text,

  programme_code text not null,
  programme_stream text not null default '',
  study_mode text not null default '',

  actual_student_number integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint study_plan_actual_student_numbers_unique
    unique (
      academic_year,
      study_term,
      module_code,
      programme_code,
      programme_stream,
      study_mode
    )
);

insert into public.study_plan_settings (setting_key, setting_value)
values
  ('current_academic_year', '2025/26'),
  ('current_study_term', 'T2026A')
on conflict (setting_key)
do nothing;

alter table public.study_plan_students enable row level security;
alter table public.study_plan_modules enable row level security;
alter table public.programme_stream_quotas enable row level security;
alter table public.programme_quota_confirmations enable row level security;
alter table public.degree_hd_affiliations enable row level security;
alter table public.study_plan_settings enable row level security;
alter table public.study_plan_actual_student_numbers enable row level security;

grant usage on schema public to authenticated;

grant select, insert, update, delete on public.study_plan_students to authenticated;
grant select, insert, update, delete on public.study_plan_modules to authenticated;
grant select, insert, update, delete on public.programme_stream_quotas to authenticated;
grant select, insert, update, delete on public.programme_stream_quotas to anon;
grant select, insert, update, delete on public.programme_quota_confirmations to authenticated;
grant select, insert, update, delete on public.programme_quota_confirmations to anon;
grant select, insert, update, delete on public.degree_hd_affiliations to authenticated;
grant select, insert, update, delete on public.study_plan_settings to authenticated;
grant select, insert, update, delete on public.study_plan_actual_student_numbers to authenticated;

drop policy if exists "Authenticated full access study_plan_students" on public.study_plan_students;
create policy "Authenticated full access study_plan_students"
on public.study_plan_students
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated full access study_plan_modules" on public.study_plan_modules;
create policy "Authenticated full access study_plan_modules"
on public.study_plan_modules
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated full access programme_stream_quotas" on public.programme_stream_quotas;
create policy "Authenticated full access programme_stream_quotas"
on public.programme_stream_quotas
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Allow anon all programme_stream_quotas" on public.programme_stream_quotas;
create policy "Allow anon all programme_stream_quotas"
on public.programme_stream_quotas
for all
to anon
using (true)
with check (true);

drop policy if exists "Authenticated full access programme_quota_confirmations" on public.programme_quota_confirmations;
create policy "Authenticated full access programme_quota_confirmations"
on public.programme_quota_confirmations
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Allow anon all programme_quota_confirmations" on public.programme_quota_confirmations;
create policy "Allow anon all programme_quota_confirmations"
on public.programme_quota_confirmations
for all
to anon
using (true)
with check (true);

drop policy if exists "Authenticated full access degree_hd_affiliations" on public.degree_hd_affiliations;
create policy "Authenticated full access degree_hd_affiliations"
on public.degree_hd_affiliations
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated full access study_plan_settings" on public.study_plan_settings;
create policy "Authenticated full access study_plan_settings"
on public.study_plan_settings
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated full access study_plan_actual_student_numbers" on public.study_plan_actual_student_numbers;
create policy "Authenticated full access study_plan_actual_student_numbers"
on public.study_plan_actual_student_numbers
for all
to authenticated
using (true)
with check (true);

commit;
