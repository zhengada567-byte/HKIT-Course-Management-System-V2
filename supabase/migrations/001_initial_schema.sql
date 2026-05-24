create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text,
  role text not null check (role in ('programme_leader', 'admin', 'president')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null unique,
  setting_value text,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists programmes (
  id uuid primary key default gen_random_uuid(),
  programme_type text not null,
  programme_code text not null,
  programme_name text,
  programme_stream text not null default 'nil',
  programme_leader text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (programme_code, programme_stream)
);

create table if not exists teachers (
  id uuid primary key default gen_random_uuid(),
  title text,
  family_name text not null,
  other_name text,
  teacher_name text not null,
  employment_type text check (employment_type in ('FT', 'PT') or employment_type is null or employment_type = ''),
  academic_year text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_name, academic_year)
);

create table if not exists modules (
  id uuid primary key default gen_random_uuid(),
  module_code text not null,
  module_name text,
  module_year text,
  module_term text not null check (module_term in ('Sep', 'Feb', 'Jun')),
  programme_code text not null,
  stream_code text not null default 'nil',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module_code, programme_code, stream_code, module_term)
);

create table if not exists module_adjustments (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references modules(id) on delete cascade,
  academic_year text not null,
  adjusted_module_year text,
  adjusted_module_term text check (adjusted_module_term in ('Sep', 'Feb', 'Jun') or adjusted_module_term is null),
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module_id, academic_year)
);

create table if not exists timetable_planning_modules (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  module_id uuid not null references modules(id) on delete cascade,
  programme_code text not null,
  stream_code text not null default 'nil',
  module_code text not null,
  module_name text,
  module_year text,
  module_term text not null check (module_term in ('Sep', 'Feb', 'Jun')),
  natural_combine_code text,
  manual_combine_group_id uuid,
  split_status text not null default 'not_started' check (split_status in ('not_started', 'no_split', 'split')),
  assignment_status text not null default 'not_started' check (assignment_status in ('not_started', 'assigned', 'confirmed')),
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year, module_id)
);

create table if not exists timetable_student_numbers (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  module_code text not null,
  programme_code text not null,
  expected_student_number integer not null default 0 check (expected_student_number >= 0),
  actual_student_number integer check (actual_student_number >= 0 or actual_student_number is null),
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year, module_code, programme_code)
);

create table if not exists combine_groups (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  combined_code text not null,
  combine_type text not null check (combine_type in ('natural_same_module_code', 'manual')),
  module_term text not null check (module_term in ('Sep', 'Feb', 'Jun')),
  total_expected_student_number integer check (total_expected_student_number >= 0 or total_expected_student_number is null),
  total_actual_student_number integer check (total_actual_student_number >= 0 or total_actual_student_number is null),
  actual_student_number_status text check (actual_student_number_status in ('complete', 'incomplete') or actual_student_number_status is null),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'confirmed', 'auto_confirmed')),
  created_by uuid references app_users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year, combined_code)
);

create table if not exists combine_group_modules (
  id uuid primary key default gen_random_uuid(),
  combine_group_id uuid not null references combine_groups(id) on delete cascade,
  planning_module_id uuid not null references timetable_planning_modules(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (combine_group_id, planning_module_id)
);

create table if not exists timetable_modules (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  planning_module_id uuid references timetable_planning_modules(id) on delete set null,
  combine_group_id uuid references combine_groups(id) on delete set null,
  programme_code text not null,
  stream_code text not null default 'nil',
  base_module_code text,
  combined_code text,
  combine_type text not null default 'none' check (combine_type in ('natural_same_module_code', 'manual', 'none')),
  module_instance_code text not null,
  module_name text,
  module_year text,
  module_term text not null check (module_term in ('Sep', 'Feb', 'Jun')),
  mode text check (mode in ('Day', 'Night', 'Saturday') or mode is null),
  expected_student_number integer check (expected_student_number >= 0 or expected_student_number is null),
  actual_student_number integer check (actual_student_number >= 0 or actual_student_number is null),
  split_group_size integer check (split_group_size > 0 or split_group_size is null),
  split_confirmed boolean not null default false,
  assignment_confirmed boolean not null default false,
  confirmed_version integer not null default 0,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year, module_instance_code)
);

create table if not exists teaching_assignments (
  id uuid primary key default gen_random_uuid(),
  timetable_module_id uuid not null references timetable_modules(id) on delete cascade,
  academic_year text not null,
  teacher_name text not null,
  teacher_title text,
  teacher_family_name text,
  teacher_other_name text,
  teacher_employment_type text check (teacher_employment_type in ('FT', 'PT') or teacher_employment_type is null or teacher_employment_type = ''),
  teaching_status text not null check (teaching_status in ('FT', 'PT')),
  programme_type text,
  combined_code text,
  combine_type text not null default 'none' check (combine_type in ('natural_same_module_code', 'manual', 'none')),
  module_instance_code text not null,
  module_term text not null check (module_term in ('Sep', 'Feb', 'Jun')),
  assignment_version integer not null default 1,
  confirmed boolean not null default false,
  confirmed_at timestamptz,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists teacher_actual_loading (
  id uuid primary key default gen_random_uuid(),
  teacher_name text not null,
  academic_year text not null,
  module_term text not null check (module_term in ('Sep', 'Feb', 'Jun')),
  teaching_status text not null check (teaching_status in ('FT', 'PT')),
  teacher_employment_type text check (teacher_employment_type in ('FT', 'PT') or teacher_employment_type is null or teacher_employment_type = ''),
  actual_loading numeric not null default 0,
  hd_module_count integer not null default 0,
  degree_module_count integer not null default 0,
  source_confirmed_version integer,
  confirmed_by uuid references app_users(id) on delete set null,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (teacher_name, academic_year, module_term, teaching_status)
);

create table if not exists approved_loading (
  id uuid primary key default gen_random_uuid(),
  teacher_title text,
  teacher_family_name text not null,
  teacher_other_name text,
  teacher_name text not null,
  academic_year text not null,
  sep_term_approved_max_loading numeric default 0,
  feb_term_approved_max_loading numeric default 0,
  jun_term_approved_max_loading numeric default 0,
  confirmed boolean not null default false,
  confirmed_at timestamptz,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_name, academic_year)
);

create table if not exists export_logs (
  id uuid primary key default gen_random_uuid(),
  export_type text not null check (export_type in ('timetable_excel', 'approved_loading_pdf')),
  academic_year text not null,
  exported_by uuid references app_users(id) on delete set null,
  exported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_programmes_code_stream
  on programmes (programme_code, programme_stream);

create index if not exists idx_teachers_academic_year
  on teachers (academic_year);

create index if not exists idx_modules_programme_stream
  on modules (programme_code, stream_code);

create index if not exists idx_modules_code_term
  on modules (module_code, module_term);

create index if not exists idx_module_adjustments_academic_year
  on module_adjustments (academic_year);

create index if not exists idx_timetable_planning_academic_year
  on timetable_planning_modules (academic_year);

create index if not exists idx_timetable_planning_module_code_term
  on timetable_planning_modules (module_code, module_term);

create index if not exists idx_student_numbers_academic_year
  on timetable_student_numbers (academic_year);

create index if not exists idx_combine_groups_academic_year
  on combine_groups (academic_year);

create index if not exists idx_timetable_modules_academic_year
  on timetable_modules (academic_year);

create index if not exists idx_timetable_modules_term
  on timetable_modules (module_term);

create index if not exists idx_teaching_assignments_academic_year
  on teaching_assignments (academic_year);

create index if not exists idx_teaching_assignments_teacher
  on teaching_assignments (teacher_name);

create index if not exists idx_teacher_actual_loading_academic_year
  on teacher_actual_loading (academic_year);

create index if not exists idx_approved_loading_academic_year
  on approved_loading (academic_year);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_app_users_updated_at on app_users;
create trigger trg_app_users_updated_at
before update on app_users
for each row execute function set_updated_at();

drop trigger if exists trg_app_settings_updated_at on app_settings;
create trigger trg_app_settings_updated_at
before update on app_settings
for each row execute function set_updated_at();

drop trigger if exists trg_programmes_updated_at on programmes;
create trigger trg_programmes_updated_at
before update on programmes
for each row execute function set_updated_at();

drop trigger if exists trg_teachers_updated_at on teachers;
create trigger trg_teachers_updated_at
before update on teachers
for each row execute function set_updated_at();

drop trigger if exists trg_modules_updated_at on modules;
create trigger trg_modules_updated_at
before update on modules
for each row execute function set_updated_at();

drop trigger if exists trg_module_adjustments_updated_at on module_adjustments;
create trigger trg_module_adjustments_updated_at
before update on module_adjustments
for each row execute function set_updated_at();

drop trigger if exists trg_timetable_planning_modules_updated_at on timetable_planning_modules;
create trigger trg_timetable_planning_modules_updated_at
before update on timetable_planning_modules
for each row execute function set_updated_at();

drop trigger if exists trg_timetable_student_numbers_updated_at on timetable_student_numbers;
create trigger trg_timetable_student_numbers_updated_at
before update on timetable_student_numbers
for each row execute function set_updated_at();

drop trigger if exists trg_combine_groups_updated_at on combine_groups;
create trigger trg_combine_groups_updated_at
before update on combine_groups
for each row execute function set_updated_at();

drop trigger if exists trg_timetable_modules_updated_at on timetable_modules;
create trigger trg_timetable_modules_updated_at
before update on timetable_modules
for each row execute function set_updated_at();

drop trigger if exists trg_teaching_assignments_updated_at on teaching_assignments;
create trigger trg_teaching_assignments_updated_at
before update on teaching_assignments
for each row execute function set_updated_at();

drop trigger if exists trg_approved_loading_updated_at on approved_loading;
create trigger trg_approved_loading_updated_at
before update on approved_loading
for each row execute function set_updated_at();

insert into app_users (username, role)
values
  ('pl', 'programme_leader'),
  ('admin', 'admin'),
  ('president', 'president')
on conflict (username) do nothing;

insert into app_settings (setting_key, setting_value)
values
  ('current_academic_year', '2026/2027')
on conflict (setting_key) do nothing;

grant usage on schema public to anon;

grant select on public.app_users to anon;
grant select on public.app_settings to anon;

alter table public.app_users enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists "Allow anon read app_users" on public.app_users;

create policy "Allow anon read app_users"
on public.app_users
for select
to anon
using (true);

drop policy if exists "Allow anon read app_settings" on public.app_settings;

create policy "Allow anon read app_settings"
on public.app_settings
for select
to anon
using (true);
