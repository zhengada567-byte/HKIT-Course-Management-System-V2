-- Normalize academic_year labels to canonical `YYYY/(Y+1)` (e.g. 2026/2027).
-- Merges duplicate rows that only differed by short vs long year (e.g. 2026/27).

create or replace function public.canonical_academic_year(ay text)
returns text
language plpgsql
immutable
as $$
declare
  start_part text;
  end_part text;
  start_year integer;
  end_year integer;
begin
  if ay is null or btrim(ay) = '' then
    return ay;
  end if;

  start_part := split_part(btrim(ay), '/', 1);
  end_part := split_part(btrim(ay), '/', 2);

  if start_part !~ '^\d{4}$' then
    return btrim(ay);
  end if;

  start_year := start_part::integer;

  if end_part is null or btrim(end_part) = '' then
    return start_year::text || '/' || (start_year + 1)::text;
  end if;

  if length(btrim(end_part)) <= 2 then
    end_year := (start_year / 100) * 100 + btrim(end_part)::integer;
  else
    end_year := btrim(end_part)::integer;
  end if;

  if end_year = start_year + 1 then
    return start_year::text || '/' || (start_year + 1)::text;
  end if;

  return start_year::text || '/' || (start_year + 1)::text;
end;
$$;

-- timetable_student_numbers: merge duplicates (delete extras first to avoid unique-key clash)
do $$
declare
  rec record;
  keeper_id uuid;
  merged_expected integer;
  merged_actual integer;
begin
  for rec in
    select
      public.canonical_academic_year(academic_year) as canonical_ay,
      module_code,
      programme_code,
      programme_stream,
      study_term
    from public.timetable_student_numbers
    group by 1, 2, 3, 4, 5
    having count(*) > 1
  loop
    select
      coalesce(max(s.expected_student_number), 0),
      coalesce(max(coalesce(s.actual_student_number, 0)), 0)
    into merged_expected, merged_actual
    from public.timetable_student_numbers s
    where public.canonical_academic_year(s.academic_year) = rec.canonical_ay
      and s.module_code = rec.module_code
      and s.programme_code = rec.programme_code
      and s.programme_stream = rec.programme_stream
      and s.study_term = rec.study_term;

    select s.id
    into keeper_id
    from public.timetable_student_numbers s
    where public.canonical_academic_year(s.academic_year) = rec.canonical_ay
      and s.module_code = rec.module_code
      and s.programme_code = rec.programme_code
      and s.programme_stream = rec.programme_stream
      and s.study_term = rec.study_term
    order by
      case when s.academic_year = rec.canonical_ay then 0 else 1 end,
      s.expected_student_number desc nulls last,
      coalesce(s.actual_student_number, 0) desc,
      s.updated_at desc nulls last,
      s.id
    limit 1;

    delete from public.timetable_student_numbers d
    where public.canonical_academic_year(d.academic_year) = rec.canonical_ay
      and d.module_code = rec.module_code
      and d.programme_code = rec.programme_code
      and d.programme_stream = rec.programme_stream
      and d.study_term = rec.study_term
      and d.id <> keeper_id;

    update public.timetable_student_numbers k
    set
      academic_year = rec.canonical_ay,
      expected_student_number = merged_expected,
      actual_student_number = case
        when merged_actual = 0 then null
        else merged_actual
      end
    where k.id = keeper_id;
  end loop;
end $$;

update public.timetable_student_numbers
set academic_year = public.canonical_academic_year(academic_year)
where academic_year is distinct from public.canonical_academic_year(academic_year);

-- study_plan_actual_student_numbers: same pattern (includes study_mode in unique key)
do $$
declare
  rec record;
  keeper_id uuid;
  merged_actual integer;
begin
  for rec in
    select
      public.canonical_academic_year(academic_year) as canonical_ay,
      study_term,
      module_code,
      programme_code,
      programme_stream,
      study_mode
    from public.study_plan_actual_student_numbers
    group by 1, 2, 3, 4, 5, 6
    having count(*) > 1
  loop
    select coalesce(max(s.actual_student_number), 0)
    into merged_actual
    from public.study_plan_actual_student_numbers s
    where public.canonical_academic_year(s.academic_year) = rec.canonical_ay
      and s.study_term = rec.study_term
      and s.module_code = rec.module_code
      and s.programme_code = rec.programme_code
      and s.programme_stream = rec.programme_stream
      and s.study_mode = rec.study_mode;

    select s.id
    into keeper_id
    from public.study_plan_actual_student_numbers s
    where public.canonical_academic_year(s.academic_year) = rec.canonical_ay
      and s.study_term = rec.study_term
      and s.module_code = rec.module_code
      and s.programme_code = rec.programme_code
      and s.programme_stream = rec.programme_stream
      and s.study_mode = rec.study_mode
    order by
      case when s.academic_year = rec.canonical_ay then 0 else 1 end,
      s.actual_student_number desc nulls last,
      s.updated_at desc nulls last,
      s.id
    limit 1;

    delete from public.study_plan_actual_student_numbers d
    where public.canonical_academic_year(d.academic_year) = rec.canonical_ay
      and d.study_term = rec.study_term
      and d.module_code = rec.module_code
      and d.programme_code = rec.programme_code
      and d.programme_stream = rec.programme_stream
      and d.study_mode = rec.study_mode
      and d.id <> keeper_id;

    update public.study_plan_actual_student_numbers k
    set
      academic_year = rec.canonical_ay,
      actual_student_number = merged_actual
    where k.id = keeper_id;
  end loop;
end $$;

update public.study_plan_actual_student_numbers
set academic_year = public.canonical_academic_year(academic_year)
where academic_year is distinct from public.canonical_academic_year(academic_year);

-- programme_stream_quotas
do $$
declare
  rec record;
  keeper_id uuid;
  merged_programme_quota integer;
  merged_stream_quota integer;
begin
  for rec in
    select
      public.canonical_academic_year(academic_year) as canonical_ay,
      programme_code,
      programme_stream
    from public.programme_stream_quotas
    group by 1, 2, 3
    having count(*) > 1
  loop
    select
      coalesce(max(s.programme_quota), 0),
      coalesce(max(s.stream_quota), 0)
    into merged_programme_quota, merged_stream_quota
    from public.programme_stream_quotas s
    where public.canonical_academic_year(s.academic_year) = rec.canonical_ay
      and s.programme_code = rec.programme_code
      and s.programme_stream = rec.programme_stream;

    select s.id
    into keeper_id
    from public.programme_stream_quotas s
    where public.canonical_academic_year(s.academic_year) = rec.canonical_ay
      and s.programme_code = rec.programme_code
      and s.programme_stream = rec.programme_stream
    order by
      case when s.academic_year = rec.canonical_ay then 0 else 1 end,
      s.stream_quota desc,
      s.updated_at desc nulls last,
      s.id
    limit 1;

    delete from public.programme_stream_quotas d
    where public.canonical_academic_year(d.academic_year) = rec.canonical_ay
      and d.programme_code = rec.programme_code
      and d.programme_stream = rec.programme_stream
      and d.id <> keeper_id;

    update public.programme_stream_quotas k
    set
      academic_year = rec.canonical_ay,
      programme_quota = merged_programme_quota,
      stream_quota = merged_stream_quota
    where k.id = keeper_id;
  end loop;
end $$;

update public.programme_stream_quotas
set academic_year = public.canonical_academic_year(academic_year)
where academic_year is distinct from public.canonical_academic_year(academic_year);

-- programme_quota_confirmations
do $$
declare
  rec record;
  keeper_id uuid;
  merged_programme_quota integer;
begin
  for rec in
    select
      public.canonical_academic_year(academic_year) as canonical_ay,
      programme_code
    from public.programme_quota_confirmations
    group by 1, 2
    having count(*) > 1
  loop
    select coalesce(max(s.programme_quota), 0)
    into merged_programme_quota
    from public.programme_quota_confirmations s
    where public.canonical_academic_year(s.academic_year) = rec.canonical_ay
      and s.programme_code = rec.programme_code;

    select s.id
    into keeper_id
    from public.programme_quota_confirmations s
    where public.canonical_academic_year(s.academic_year) = rec.canonical_ay
      and s.programme_code = rec.programme_code
    order by
      case when s.academic_year = rec.canonical_ay then 0 else 1 end,
      case when s.confirmed_at is not null then 0 else 1 end,
      s.programme_quota desc,
      s.updated_at desc nulls last,
      s.id
    limit 1;

    delete from public.programme_quota_confirmations d
    where public.canonical_academic_year(d.academic_year) = rec.canonical_ay
      and d.programme_code = rec.programme_code
      and d.id <> keeper_id;

    update public.programme_quota_confirmations k
    set
      academic_year = rec.canonical_ay,
      programme_quota = merged_programme_quota
    where k.id = keeper_id;
  end loop;
end $$;

update public.programme_quota_confirmations
set academic_year = public.canonical_academic_year(academic_year)
where academic_year is distinct from public.canonical_academic_year(academic_year);

-- timetable_planning_modules (unique on academic_year + module_id)
do $$
declare
  rec record;
  keeper_id uuid;
begin
  for rec in
    select
      public.canonical_academic_year(academic_year) as canonical_ay,
      module_id
    from public.timetable_planning_modules
    group by 1, 2
    having count(*) > 1
  loop
    select s.id
    into keeper_id
    from public.timetable_planning_modules s
    where public.canonical_academic_year(s.academic_year) = rec.canonical_ay
      and s.module_id = rec.module_id
    order by
      case when s.academic_year = rec.canonical_ay then 0 else 1 end,
      s.updated_at desc nulls last,
      s.id
    limit 1;

    delete from public.timetable_planning_modules d
    where public.canonical_academic_year(d.academic_year) = rec.canonical_ay
      and d.module_id = rec.module_id
      and d.id <> keeper_id;

    update public.timetable_planning_modules k
    set academic_year = rec.canonical_ay
    where k.id = keeper_id;
  end loop;
end $$;

update public.timetable_planning_modules
set academic_year = public.canonical_academic_year(academic_year)
where academic_year is distinct from public.canonical_academic_year(academic_year);

update public.module_adjustments
set academic_year = public.canonical_academic_year(academic_year)
where academic_year is distinct from public.canonical_academic_year(academic_year);

update public.module_enrollment
set academic_year = public.canonical_academic_year(academic_year)
where academic_year is distinct from public.canonical_academic_year(academic_year);
