-- Canonicalize teachers.teacher_name to Title + Given + Family, then backfill
-- downstream tables that still store legacy name variants.
--
-- IMPORTANT: Run this ENTIRE file in one go (Ctrl+A then Run).
-- Do NOT use "Run selected" on individual statements.

do $migration$
begin
  drop table if exists _migration_teacher_name_map;

  create table _migration_teacher_name_map as
  select
    id,
    academic_year,
    teacher_name as old_teacher_name,
    trim(
      regexp_replace(
        concat_ws(
          ' ',
          nullif(trim(coalesce(title, '')), ''),
          nullif(trim(coalesce(other_name, '')), ''),
          nullif(trim(coalesce(family_name, '')), '')
        ),
        '\s+',
        ' ',
        'g'
      )
    ) as new_teacher_name
  from teachers
  where trim(coalesce(family_name, '')) <> ''
    and teacher_name is distinct from trim(
      regexp_replace(
        concat_ws(
          ' ',
          nullif(trim(coalesce(title, '')), ''),
          nullif(trim(coalesce(other_name, '')), ''),
          nullif(trim(coalesce(family_name, '')), '')
        ),
        '\s+',
        ' ',
        'g'
      )
    );

  delete from teachers legacy
  using _migration_teacher_name_map m
  where legacy.academic_year = m.academic_year
    and legacy.teacher_name = m.old_teacher_name
    and legacy.id <> m.id
    and exists (
      select 1
      from teachers canonical
      where canonical.academic_year = legacy.academic_year
        and canonical.teacher_name = m.new_teacher_name
        and canonical.id <> legacy.id
    );

  update teachers t
  set
    teacher_name = m.new_teacher_name,
    updated_at = now()
  from _migration_teacher_name_map m
  where t.id = m.id
    and m.old_teacher_name <> m.new_teacher_name;

  delete from teacher_actual_loading legacy
  using _migration_teacher_name_map m
  where legacy.academic_year = m.academic_year
    and legacy.teacher_name = m.old_teacher_name
    and exists (
      select 1
      from teacher_actual_loading canonical
      where canonical.academic_year = legacy.academic_year
        and canonical.teacher_name = m.new_teacher_name
        and canonical.teaching_status = legacy.teaching_status
        and coalesce(canonical.teacher_employment_type, '') =
          coalesce(legacy.teacher_employment_type, '')
        and canonical.id <> legacy.id
    );

  update teacher_actual_loading tal
  set
    teacher_name = m.new_teacher_name,
    updated_at = now()
  from _migration_teacher_name_map m
  where tal.academic_year = m.academic_year
    and tal.teacher_name = m.old_teacher_name;

  delete from approved_loadings legacy
  using _migration_teacher_name_map m
  where legacy.academic_year = m.academic_year
    and legacy.teacher_name = m.old_teacher_name
    and exists (
      select 1
      from approved_loadings canonical
      where canonical.academic_year = legacy.academic_year
        and canonical.teacher_name = m.new_teacher_name
        and canonical.id <> legacy.id
    );

  update approved_loadings al
  set
    teacher_name = m.new_teacher_name,
    updated_at = now()
  from _migration_teacher_name_map m
  where al.academic_year = m.academic_year
    and al.teacher_name = m.old_teacher_name;

  update teaching_assignments ta
  set
    teacher_name = m.new_teacher_name,
    updated_at = now()
  from _migration_teacher_name_map m
  where ta.academic_year = m.academic_year
    and ta.teacher_name = m.old_teacher_name;

  update module_default_assignments mda
  set
    teacher_name = m.new_teacher_name,
    updated_at = now()
  from _migration_teacher_name_map m
  where mda.academic_year = m.academic_year
    and mda.teacher_name = m.old_teacher_name;

  update timetable_module_instances tmi
  set
    instance_teacher_name = m.new_teacher_name,
    updated_at = now()
  from _migration_teacher_name_map m
  where tmi.academic_year = m.academic_year
    and tmi.instance_teacher_name = m.old_teacher_name;

  update timetable_sessions ts
  set
    teacher_name = m.new_teacher_name,
    updated_at = now()
  from _migration_teacher_name_map m
  where ts.academic_year = m.academic_year
    and ts.teacher_name = m.old_teacher_name;

  delete from timetable_teacher_not_available legacy
  using _migration_teacher_name_map m
  where legacy.academic_year = m.academic_year
    and legacy.teacher_name = m.old_teacher_name
    and exists (
      select 1
      from timetable_teacher_not_available canonical
      where canonical.academic_year = legacy.academic_year
        and canonical.teacher_name = m.new_teacher_name
        and canonical.weekday = legacy.weekday
        and canonical.period = legacy.period
        and canonical.id <> legacy.id
    );

  update timetable_teacher_not_available tna
  set
    teacher_name = m.new_teacher_name,
    updated_at = now()
  from _migration_teacher_name_map m
  where tna.academic_year = m.academic_year
    and tna.teacher_name = m.old_teacher_name;

  insert into timetable_teacher_availability_saved (
    academic_year,
    teacher_name,
    saved_at,
    updated_at
  )
  select
    s.academic_year,
    m.new_teacher_name,
    s.saved_at,
    now()
  from timetable_teacher_availability_saved s
  join _migration_teacher_name_map m
    on s.academic_year = m.academic_year
   and s.teacher_name = m.old_teacher_name
  on conflict (academic_year, teacher_name) do update
  set updated_at = excluded.updated_at;

  delete from timetable_teacher_availability_saved s
  using _migration_teacher_name_map m
  where s.academic_year = m.academic_year
    and s.teacher_name = m.old_teacher_name;

  drop table _migration_teacher_name_map;
end
$migration$;
