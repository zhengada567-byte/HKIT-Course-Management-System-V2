/*
  ============================================================================
  Module identity migration (run once in Supabase SQL Editor)
  ============================================================================

  Design:

  1) modules
     - module_term (Sep/Feb/Jun) = catalog default offered term (informational)
     - UNIQUE (module_code, programme_code, stream_code)

  2) study_plan_modules
     - study_term (T2025B) = when the student actually takes the module
     - UNIQUE (student_profile_id, module_code, programme_code, programme_stream, plan_stage)

  3) timetable_student_numbers
     - module_term = catalog offered term copied from modules (display)
     - study_term = which intake/run is counted (T2025A / T2025B / T2025C)
     - UNIQUE (academic_year, module_code, programme_code, programme_stream, study_term)

  4) Other tables: drop module_term from UNIQUE keys (enrollment, defaults, teacher loading, etc.)

  After success: update application onConflict to match (separate code change).
*/

begin;

-- ---------------------------------------------------------------------------
-- 0) timetable_student_numbers: columns + backfill study_term
-- ---------------------------------------------------------------------------

alter table if exists public.timetable_student_numbers
  add column if not exists programme_stream text not null default 'nil';

alter table if exists public.timetable_student_numbers
  add column if not exists study_term text;

update public.timetable_student_numbers
set programme_stream = coalesce(nullif(trim(programme_stream), ''), 'nil')
where programme_stream is null
   or trim(programme_stream) = '';

-- study_term already stored as T2025B etc.
update public.timetable_student_numbers
set study_term = upper(trim(module_term))
where study_term is null
  and module_term is not null
  and module_term ~* '^T[0-9]{4}[ABC]$';

-- legacy rows: module_term was Sep / Feb / Jun — map to study term letter
update public.timetable_student_numbers
set study_term =
  'T' || trim(academic_year) ||
  case upper(trim(module_term))
    when 'FEB' then 'A'
    when 'FEBRUARY' then 'A'
    when 'JUN' then 'B'
    when 'JUNE' then 'B'
    when 'SEP' then 'C'
    when 'SEPT' then 'C'
    when 'SEPTEMBER' then 'C'
    when 'A' then 'A'
    when 'B' then 'B'
    when 'C' then 'C'
    else 'A'
  end
where study_term is null
  and module_term is not null
  and module_term !~* '^T[0-9]{4}[ABC]$';

-- remaining nulls: safe fallback (review rows after migration)
update public.timetable_student_numbers
set study_term = 'T' || trim(academic_year) || 'A'
where study_term is null
  and academic_year is not null
  and trim(academic_year) <> '';

-- restore catalog offered term from modules (not study_term)
update public.timetable_student_numbers tsn
set module_term = m.module_term
from public.modules m
where tsn.module_code = m.module_code
  and tsn.programme_code = m.programme_code
  and coalesce(nullif(trim(tsn.programme_stream), ''), 'nil')
    = coalesce(nullif(trim(m.stream_code), ''), 'nil');

-- merge duplicate keys after backfill (sum student numbers, keep oldest row)
with ranked as (
  select
    id,
    academic_year,
    module_code,
    programme_code,
    programme_stream,
    study_term,
    sum(expected_student_number) over w as sum_expected,
    sum(coalesce(actual_student_number, 0)) over w as sum_actual,
    row_number() over (
      partition by academic_year, module_code, programme_code, programme_stream, study_term
      order by created_at nulls last, id
    ) as rn
  from public.timetable_student_numbers
  window w as (
    partition by academic_year, module_code, programme_code, programme_stream, study_term
  )
),
keepers as (
  select id, sum_expected, sum_actual
  from ranked
  where rn = 1
)
update public.timetable_student_numbers t
set
  expected_student_number = k.sum_expected,
  actual_student_number = nullif(k.sum_actual, 0),
  updated_at = now()
from keepers k
where t.id = k.id;

delete from public.timetable_student_numbers t
where t.id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by academic_year, module_code, programme_code, programme_stream, study_term
        order by created_at nulls last, id
      ) as rn
    from public.timetable_student_numbers
  ) x
  where rn > 1
);

alter table public.timetable_student_numbers
  alter column study_term set not null;

-- ---------------------------------------------------------------------------
-- 0b) module_enrollment: remove obsolete rows + delete duplicates
--     (keep newest row per academic_year + module + programme + stream)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'module_enrollment'
  ) then
    update public.module_enrollment
    set stream_code = coalesce(nullif(trim(stream_code), ''), 'nil')
    where stream_code is null
       or trim(stream_code) = '';

    -- drop enrollment for module codes no longer in modules master table
    delete from public.module_enrollment me
    where not exists (
      select 1
      from public.modules m
      where m.module_code = me.module_code
        and coalesce(m.programme_code, '') = coalesce(me.programme_code, '')
        and coalesce(nullif(trim(m.stream_code), ''), 'nil')
          = coalesce(nullif(trim(me.stream_code), ''), 'nil')
    );

    -- delete duplicate rows (e.g. old Sep/Feb split); keep latest created_at
    delete from public.module_enrollment t
    where t.id in (
      select id
      from (
        select
          id,
          row_number() over (
            partition by
              academic_year,
              module_code,
              coalesce(programme_code, ''),
              coalesce(nullif(trim(stream_code), ''), 'nil')
            order by created_at desc nulls last, id desc
          ) as rn
        from public.module_enrollment
      ) x
      where rn > 1
    );

    update public.module_enrollment me
    set module_term = m.module_term
    from public.modules m
    where me.module_code = m.module_code
      and coalesce(me.programme_code, '') = coalesce(m.programme_code, '')
      and coalesce(nullif(trim(me.stream_code), ''), 'nil')
        = coalesce(nullif(trim(m.stream_code), ''), 'nil');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 0c) module_default_assignments: remove obsolete rows + delete duplicates
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'module_default_assignments'
  ) then
    update public.module_default_assignments
    set stream_code = coalesce(nullif(trim(stream_code), ''), 'nil')
    where stream_code is null
       or trim(stream_code) = '';

    delete from public.module_default_assignments mda
    where not exists (
      select 1
      from public.modules m
      where m.module_code = mda.module_code
        and coalesce(m.programme_code, '') = coalesce(mda.programme_code, '')
        and coalesce(nullif(trim(m.stream_code), ''), 'nil')
          = coalesce(nullif(trim(mda.stream_code), ''), 'nil')
    );

    delete from public.module_default_assignments t
    where t.id in (
      select id
      from (
        select
          id,
          row_number() over (
            partition by
              academic_year,
              module_code,
              coalesce(programme_code, ''),
              coalesce(nullif(trim(stream_code), ''), 'nil')
            order by updated_at desc nulls last, id desc
          ) as rn
        from public.module_default_assignments
      ) x
      where rn > 1
    );

    update public.module_default_assignments mda
    set module_term = m.module_term
    from public.modules m
    where mda.module_code = m.module_code
      and coalesce(mda.programme_code, '') = coalesce(m.programme_code, '')
      and coalesce(nullif(trim(mda.stream_code), ''), 'nil')
        = coalesce(nullif(trim(m.stream_code), ''), 'nil');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A) Pre-check: duplicates under NEW keys
-- ---------------------------------------------------------------------------

do $$
declare
  n integer;
begin
  select count(*) into n from (
    select 1 from public.modules
    group by module_code, programme_code, stream_code
    having count(*) > 1
  ) t;
  if n > 0 then
    raise exception 'DUPLICATE modules (module_code, programme_code, stream_code): % groups', n;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'study_plan_modules'
      and column_name = 'programme_stream'
  ) then
    select count(*) into n from (
      select 1 from public.study_plan_modules
      group by student_profile_id, module_code, programme_code, programme_stream, plan_stage
      having count(*) > 1
    ) t;
    if n > 0 then
      raise exception 'DUPLICATE study_plan_modules: % groups', n;
    end if;
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'timetable_student_numbers'
  ) then
    select count(*) into n from (
      select 1 from public.timetable_student_numbers
      group by academic_year, module_code, programme_code, programme_stream, study_term
      having count(*) > 1
    ) t;
    if n > 0 then
      raise exception 'DUPLICATE timetable_student_numbers (year, module, programme, stream, study_term): % groups', n;
    end if;
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'module_enrollment'
  ) then
    select count(*) into n from (
      select 1 from public.module_enrollment
      group by
        academic_year,
        module_code,
        coalesce(programme_code, ''),
        coalesce(nullif(trim(stream_code), ''), 'nil')
      having count(*) > 1
    ) t;
    if n > 0 then
      raise exception 'DUPLICATE module_enrollment: % groups', n;
    end if;
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'module_default_assignments'
  ) then
    select count(*) into n from (
      select 1 from public.module_default_assignments
      group by
        academic_year,
        module_code,
        coalesce(programme_code, ''),
        coalesce(nullif(trim(stream_code), ''), 'nil')
      having count(*) > 1
    ) t;
    if n > 0 then
      raise exception 'DUPLICATE module_default_assignments: % groups', n;
    end if;
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'teacher_actual_loading'
  ) then
    select count(*) into n from (
      select 1 from public.teacher_actual_loading
      group by teacher_name, academic_year, teaching_status, coalesce(teacher_employment_type, '')
      having count(*) > 1
    ) t;
    if n > 0 then
      raise exception 'DUPLICATE teacher_actual_loading: % groups', n;
    end if;
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'combine_groups'
  ) then
    select count(*) into n from (
      select 1 from public.combine_groups
      group by academic_year, combined_code
      having count(*) > 1
    ) t;
    if n > 0 then
      raise exception 'DUPLICATE combine_groups: % groups', n;
    end if;
  end if;

  raise notice 'Pre-check passed.';
end $$;

-- ---------------------------------------------------------------------------
-- B) Drop UNIQUE constraints that mention module_term
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select
      n.nspname as schema_name,
      t.relname as table_name,
      c.conname as constraint_name,
      pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ilike '%module_term%'
  loop
    raise notice 'DROP CONSTRAINT %.% : %', r.table_name, r.constraint_name, r.def;
    execute format(
      'alter table %I.%I drop constraint %I',
      r.schema_name,
      r.table_name,
      r.constraint_name
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- C) Drop UNIQUE indexes that mention module_term
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select indexname, tablename, indexdef
    from pg_indexes
    where schemaname = 'public'
      and indexdef ilike '%unique%'
      and indexdef ilike '%module_term%'
  loop
    raise notice 'DROP INDEX % on %', r.indexname, r.tablename;
    execute format('drop index if exists public.%I', r.indexname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- D) study_plan_modules: rebuild unique (no module_term)
-- ---------------------------------------------------------------------------

alter table if exists public.study_plan_modules
  drop constraint if exists study_plan_modules_unique;

do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'study_plan_modules'
      and c.contype = 'u'
  loop
    execute format(
      'alter table public.study_plan_modules drop constraint %I',
      r.conname
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- E) New UNIQUE constraints
-- ---------------------------------------------------------------------------

alter table public.modules
  drop constraint if exists modules_code_programme_stream_key;

alter table public.modules
  drop constraint if exists modules_module_code_programme_code_stream_code_module_term_key;

alter table public.modules
  add constraint modules_code_programme_stream_key
  unique (module_code, programme_code, stream_code);

do $$
begin
  alter table public.study_plan_modules
    add constraint study_plan_modules_unique
    unique (
      student_profile_id,
      module_code,
      programme_code,
      programme_stream,
      plan_stage
    );
exception
  when duplicate_object then
    raise notice 'study_plan_modules_unique already exists';
end $$;

alter table public.timetable_student_numbers
  drop constraint if exists timetable_student_numbers_academic_module_programme_term_key;

alter table public.timetable_student_numbers
  drop constraint if exists timetable_student_numbers_academic_module_programme_key;

alter table public.timetable_student_numbers
  drop constraint if exists timetable_student_numbers_academic_module_programme_stream_key;

alter table public.timetable_student_numbers
  drop constraint if exists timetable_student_numbers_identity_key;

alter table public.timetable_student_numbers
  add constraint timetable_student_numbers_identity_key
  unique (
    academic_year,
    module_code,
    programme_code,
    programme_stream,
    study_term
  );

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'module_enrollment'
  ) then
    alter table public.module_enrollment
      drop constraint if exists module_enrollment_identity_key;

    alter table public.module_enrollment
      add constraint module_enrollment_identity_key
      unique (academic_year, module_code, programme_code, stream_code);
  end if;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'module_default_assignments'
  ) then
    alter table public.module_default_assignments
      drop constraint if exists module_default_assignments_identity_key;

    alter table public.module_default_assignments
      add constraint module_default_assignments_identity_key
      unique (academic_year, module_code, programme_code, stream_code);
  end if;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'teacher_actual_loading'
  ) then
    alter table public.teacher_actual_loading
      drop constraint if exists teacher_actual_loading_teacher_name_academic_year_module_term_teaching_status_key;

    alter table public.teacher_actual_loading
      drop constraint if exists teacher_actual_loading_teacher_name_academic_year_teaching_status_key;

    drop index if exists public.teacher_actual_loading_unique_group_idx;

    create unique index teacher_actual_loading_unique_group_idx
      on public.teacher_actual_loading (
        academic_year,
        teacher_name,
        teaching_status,
        coalesce(teacher_employment_type, '')
      );
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'combine_groups'
  ) then
    alter table public.combine_groups
      drop constraint if exists combine_groups_academic_year_combined_code_module_term_key;

    begin
      alter table public.combine_groups
        add constraint combine_groups_academic_year_combined_code_key
        unique (academic_year, combined_code);
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- Verification (run separately)
-- ---------------------------------------------------------------------------
/*
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.timetable_student_numbers'::regclass
  and contype = 'u';

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.modules'::regclass
  and contype = 'u';
*/
