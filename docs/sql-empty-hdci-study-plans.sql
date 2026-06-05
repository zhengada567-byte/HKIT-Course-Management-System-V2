-- Empty HDCI study-plan data only (does NOT delete HDCCI student profiles).
-- Run in Supabase Dashboard → SQL Editor.
-- Preview first, then uncomment DELETE blocks.

-- ---------------------------------------------------------------------------
-- 1) Preview
-- ---------------------------------------------------------------------------
select 'study_plan_students (HDCI profiles)' as item, count(*)::int as n
from public.study_plan_students
where programme_code = 'HDCI';

select 'study_plan_modules (HDCI module rows)' as item, count(*)::int as n
from public.study_plan_modules
where programme_code = 'HDCI';

select 'study_plan_actual_student_numbers (HDCI)' as item, count(*)::int as n
from public.study_plan_actual_student_numbers
where programme_code = 'HDCI';

-- HDCCI profiles that only have HDCI module rows (leftover shells after module wipe)
select count(distinct s.id)::int as hdcci_profiles_with_hdci_modules_only
from public.study_plan_students s
where s.programme_code = 'HDCCI'
  and exists (
    select 1 from public.study_plan_modules m
    where m.student_profile_id = s.id and m.programme_code = 'HDCI'
  )
  and not exists (
    select 1 from public.study_plan_modules m2
    where m2.student_profile_id = s.id and m2.programme_code <> 'HDCI'
  );

-- ---------------------------------------------------------------------------
-- 2) Delete HDCI data (modules cascade is NOT used here — modules are the target)
-- ---------------------------------------------------------------------------
-- delete from public.study_plan_modules
-- where programme_code = 'HDCI';

-- delete from public.study_plan_actual_student_numbers
-- where programme_code = 'HDCI';

-- delete from public.study_plan_students
-- where programme_code = 'HDCI';

-- ---------------------------------------------------------------------------
-- 3) Verify
-- ---------------------------------------------------------------------------
-- select 'remaining HDCI modules' as item, count(*)::int as n
-- from public.study_plan_modules where programme_code = 'HDCI';
