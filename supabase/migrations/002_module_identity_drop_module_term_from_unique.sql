/*
  Module identity without module_term in UNIQUE constraints.

  New rule:
    module_code + programme_code + stream_code   (modules, enrollment, etc.)
    module_code + programme_code + programme_stream (+ context keys per table)

  Prerequisites:
    - You renamed module codes so the same logical module in different
      offered terms (Sep/Feb/Jun) has different module_code values.
    - Run in Supabase SQL Editor (or psql with service role / DB owner).

  After this migration, update application onConflict / buildModuleIdentityKey
  to match (see project docs / team approval).
*/

begin;

-- ---------------------------------------------------------------------------
-- 0) Fail fast if duplicates would block new constraints
-- ---------------------------------------------------------------------------

do $$
declare
  duplicate_count integer;
begin
  select count(*) into duplicate_count
  from (
    select 1
    from public.modules
    group by module_code, programme_code, stream_code
    having count(*) > 1
  ) d;

  if duplicate_count > 0 then
    raise exception
      'modules: duplicate rows for (module_code, programme_code, stream_code). Resolve before migration.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'study_plan_modules'
      and column_name = 'programme_stream'
  ) then
    select count(*) into duplicate_count
    from (
      select 1
      from public.study_plan_modules
      group by
        student_profile_id,
        module_code,
        programme_code,
        programme_stream,
        plan_stage
      having count(*) > 1
    ) d;

    if duplicate_count > 0 then
      raise exception
        'study_plan_modules: duplicate rows for (student_profile_id, module_code, programme_code, programme_stream, plan_stage).';
    end if;
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'module_enrollment'
  ) then
    select count(*) into duplicate_count
    from (
      select 1
      from public.module_enrollment
      group by academic_year, module_code, programme_code, stream_code
      having count(*) > 1
    ) d;

    if duplicate_count > 0 then
      raise exception
        'module_enrollment: duplicate rows for (academic_year, module_code, programme_code, stream_code).';
    end if;
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'module_default_assignments'
  ) then
    select count(*) into duplicate_count
    from (
      select 1
      from public.module_default_assignments
      group by academic_year, module_code, programme_code, stream_code
      having count(*) > 1
    ) d;

    if duplicate_count > 0 then
      raise exception
        'module_default_assignments: duplicate rows for (academic_year, module_code, programme_code, stream_code).';
    end if;
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'timetable_student_numbers'
  ) then
    select count(*) into duplicate_count
    from (
      select 1
      from public.timetable_student_numbers
      group by academic_year, module_code, programme_code
      having count(*) > 1
    ) d;

    if duplicate_count > 0 then
      raise exception
        'timetable_student_numbers: duplicate rows for (academic_year, module_code, programme_code).';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Drop UNIQUE constraints / indexes that include module_term (selected tables)
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  target_tables text[] := array[
    'modules',
    'study_plan_modules',
    'timetable_student_numbers',
    'module_enrollment',
    'module_default_assignments'
  ];
begin
  for r in
    select
      c.conrelid::regclass::text as table_name,
      c.conname as constraint_name,
      pg_get_constraintdef(c.oid) as constraint_def
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public'
      and c.contype = 'u'
      and c.conrelid::regclass::text = any (target_tables)
      and pg_get_constraintdef(c.oid) ilike '%module_term%'
  loop
    raise notice 'Dropping constraint % on %: %',
      r.constraint_name,
      r.table_name,
      r.constraint_def;

    execute format(
      'alter table %s drop constraint if exists %I',
      r.table_name,
      r.constraint_name
    );
  end loop;
end $$;

-- Drop legacy study_plan_modules unique if it omits programme_code/stream
-- (name from studyplan.sql; safe if already dropped)
alter table if exists public.study_plan_modules
  drop constraint if exists study_plan_modules_unique;

-- ---------------------------------------------------------------------------
-- 2) Add new UNIQUE constraints (no module_term)
-- ---------------------------------------------------------------------------

-- modules: module_code + programme_code + stream_code
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'modules'
      and c.conname = 'modules_code_programme_stream_key'
  ) then
    alter table public.modules
      add constraint modules_code_programme_stream_key
      unique (module_code, programme_code, stream_code);
  end if;
end $$;

-- study_plan_modules: per student + programme identity + plan_stage
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'study_plan_modules'
  ) then
    if not exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'study_plan_modules'
        and c.conname = 'study_plan_modules_unique'
    ) then
      alter table public.study_plan_modules
        add constraint study_plan_modules_unique
        unique (
          student_profile_id,
          module_code,
          programme_code,
          programme_stream,
          plan_stage
        );
    end if;
  end if;
end $$;

-- timetable_student_numbers: academic_year + module + programme
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'timetable_student_numbers'
  ) then
    if not exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'timetable_student_numbers'
        and c.conname = 'timetable_student_numbers_academic_module_programme_key'
    ) then
      alter table public.timetable_student_numbers
        add constraint timetable_student_numbers_academic_module_programme_key
        unique (academic_year, module_code, programme_code);
    end if;
  end if;
end $$;

-- module_enrollment
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'module_enrollment'
  ) then
    if not exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'module_enrollment'
        and c.conname = 'module_enrollment_identity_key'
    ) then
      alter table public.module_enrollment
        add constraint module_enrollment_identity_key
        unique (academic_year, module_code, programme_code, stream_code);
    end if;
  end if;
end $$;

-- module_default_assignments
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'module_default_assignments'
  ) then
    if not exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'module_default_assignments'
        and c.conname = 'module_default_assignments_identity_key'
    ) then
      alter table public.module_default_assignments
        add constraint module_default_assignments_identity_key
        unique (academic_year, module_code, programme_code, stream_code);
    end if;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- 3) Verification (run after commit)
-- ---------------------------------------------------------------------------
-- select
--   tc.table_name,
--   tc.constraint_name,
--   pg_get_constraintdef(c.oid) as definition
-- from information_schema.table_constraints tc
-- join pg_constraint c on c.conname = tc.constraint_name
-- where tc.table_schema = 'public'
--   and tc.constraint_type = 'UNIQUE'
--   and tc.table_name in (
--     'modules',
--     'study_plan_modules',
--     'timetable_student_numbers',
--     'module_enrollment',
--     'module_default_assignments'
--   )
-- order by tc.table_name, tc.constraint_name;
