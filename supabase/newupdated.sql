create table if not exists public.module_enrollment (
  id uuid primary key default gen_random_uuid(),

  academic_year text not null,
  module_code text not null,
  module_term text not null,
  programme_code text,
  stream_code text,

  expected_student_number integer not null default 0,
  actual_student_number integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (
    academic_year,
    module_code,
    module_term,
    programme_code,
    stream_code
  )
);

create table if not exists public.module_default_assignments (
  id uuid primary key default gen_random_uuid(),

  academic_year text not null,
  module_code text not null,
  module_term text not null,
  programme_code text,
  stream_code text,

  teacher_name text,
  teacher_title text,
  teacher_family_name text,
  teacher_other_name text,
  teaching_status text,

  mode text not null default 'Night',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (
    academic_year,
    module_code,
    module_term,
    programme_code,
    stream_code
  )
);

alter table public.module_enrollment enable row level security;

drop policy if exists "Allow all module_enrollment access" on public.module_enrollment;

create policy "Allow all module_enrollment access"
on public.module_enrollment
for all
to anon, authenticated
using (true)
with check (true);

alter table public.module_default_assignments enable row level security;

drop policy if exists "Allow all module_default_assignments access" on public.module_default_assignments;

create policy "Allow all module_default_assignments access"
on public.module_default_assignments
for all
to anon, authenticated
using (true)
with check (true);

create table if not exists teacher_loading_runs (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  status text not null default 'completed',
  generated_at timestamptz not null default now(),
  generated_by uuid null,
  notes text null
);

create index if not exists teacher_loading_runs_academic_year_idx
on teacher_loading_runs (academic_year);

create index if not exists teacher_loading_runs_status_idx
on teacher_loading_runs (status);

create unique index if not exists teacher_actual_loading_unique_group_idx
on teacher_actual_loading (
  academic_year,
  teacher_name,
  module_term,
  teaching_status,
  coalesce(teacher_employment_type, '')
);

3. Make sure assignment confirmation columns exist
Run these as well:

Copy
alter table teaching_assignments
add column if not exists confirmed_by uuid null;
Copy
alter table timetable_modules
add column if not exists assignment_confirmed boolean not null default false;

begin;

-- 1. Check pending assignment confirmations
do $$
declare
  pending_count integer;
begin
  select count(*)
  into pending_count
  from timetable_modules tm
  where tm.academic_year = '2025/26'
    and coalesce(tm.assignment_confirmed, false) = false;

  if pending_count > 0 then
    raise exception 'Cannot update teacher loading. % module(s) assignment are still pending.', pending_count;
  end if;
end $$;

-- 2. Check confirmed assignments with TBC / empty teacher
do $$
declare
  tbc_count integer;
begin
  select count(*)
  into tbc_count
  from teaching_assignments ta
  join timetable_modules tm
    on tm.id = ta.timetable_module_id
  where ta.academic_year = '2025/26'
    and tm.academic_year = '2025/26'
    and ta.assignment_version = 1
    and ta.confirmed = true
    and tm.assignment_confirmed = true
    and (
      ta.teacher_name is null
      or trim(ta.teacher_name) = ''
      or upper(trim(ta.teacher_name)) = 'TBC'
    );

  if tbc_count > 0 then
    raise exception 'Cannot update teacher loading. % confirmed assignment(s) still have TBC or empty teacher.', tbc_count;
  end if;
end $$;

-- 3. Delete old actual loading for this academic year
delete from teacher_actual_loading
where academic_year = '2025/26';

-- 4. Insert regenerated actual loading
insert into teacher_actual_loading (
  teacher_name,
  academic_year,
  module_term,
  teaching_status,
  teacher_employment_type,
  actual_loading,
  hd_module_count,
  degree_module_count,
  source_confirmed_version,
  confirmed_by,
  confirmed_at,
  updated_at
)
select
  ta.teacher_name,
  ta.academic_year,
  tm.module_term,
  coalesce(ta.teaching_status, 'FT') as teaching_status,
  ta.teacher_employment_type,

  count(*)::numeric as actual_loading,

  count(*) filter (
    where upper(coalesce(ta.programme_type, '')) in ('HD', 'HIGHER DIPLOMA')
  )::integer as hd_module_count,

  count(*) filter (
    where upper(coalesce(ta.programme_type, '')) in ('DEGREE', 'UG', 'UNDERGRADUATE')
  )::integer as degree_module_count,

  max(ta.assignment_version)::integer as source_confirmed_version,
  null::uuid as confirmed_by,
  now() as confirmed_at,
  now() as updated_at
from teaching_assignments ta
join timetable_modules tm
  on tm.id = ta.timetable_module_id
where ta.academic_year = '2025/26'
  and tm.academic_year = '2025/26'
  and ta.assignment_version = 1
  and ta.confirmed = true
  and tm.assignment_confirmed = true
group by
  ta.teacher_name,
  ta.academic_year,
  tm.module_term,
  coalesce(ta.teaching_status, 'FT'),
  ta.teacher_employment_type;

-- 5. Insert generation log
insert into teacher_loading_runs (
  academic_year,
  status,
  generated_by,
  notes
)
values (
  '2025/26',
  'completed',
  null::uuid,
  'Teacher actual loading regenerated from confirmed teaching assignments.'
);

commit;

begin;

-- 1. Add module_term to timetable_student_numbers
alter table public.timetable_student_numbers
add column if not exists module_term text;

-- 2. Backfill module_term from timetable_planning_modules when possible
update public.timetable_student_numbers tsn
set module_term = tpm.module_term
from public.timetable_planning_modules tpm
where tsn.academic_year = tpm.academic_year
  and tsn.module_code = tpm.module_code
  and tsn.programme_code = tpm.programme_code
  and tsn.module_term is null;

-- 3. Drop old unique constraints / indexes that do not include module_term
do $$
declare
  r record;
begin
  for r in
    select
      conname
    from pg_constraint
    where conrelid = 'public.timetable_student_numbers'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%academic_year%'
      and pg_get_constraintdef(oid) ilike '%module_code%'
      and pg_get_constraintdef(oid) ilike '%programme_code%'
      and pg_get_constraintdef(oid) not ilike '%module_term%'
  loop
    execute format(
      'alter table public.timetable_student_numbers drop constraint if exists %I',
      r.conname
    );
  end loop;
end $$;

do $$
declare
  r record;
begin
  for r in
    select
      indexname
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'timetable_student_numbers'
      and indexdef ilike '%unique%'
      and indexdef ilike '%academic_year%'
      and indexdef ilike '%module_code%'
      and indexdef ilike '%programme_code%'
      and indexdef not ilike '%module_term%'
  loop
    execute format(
      'drop index if exists public.%I',
      r.indexname
    );
  end loop;
end $$;

-- 4. For PostgreSQL unique index, null values are treated as distinct.
-- To make onConflict work reliably, use an expression unique index with coalesce.
-- But Supabase upsert onConflict needs real columns, so we should avoid null module_term.
-- Backfill remaining null module_term to 'Unknown' as a safety fallback.
update public.timetable_student_numbers
set module_term = 'Unknown'
where module_term is null;

-- 5. Make module_term not null after backfill
alter table public.timetable_student_numbers
alter column module_term set not null;

-- 6. Create new unique constraint including module_term
alter table public.timetable_student_numbers
add constraint timetable_student_numbers_academic_module_programme_term_key
unique (
  academic_year,
  module_code,
  programme_code,
  module_term
);

commit;
