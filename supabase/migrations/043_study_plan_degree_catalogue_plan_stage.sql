-- Degree study-plan rows: modules not in the degree programme catalogue
-- should be bridging, not programme (e.g. BS413 on WUBM).

UPDATE public.study_plan_modules AS spm
SET
  plan_stage = 'bridging',
  updated_at = NOW()
FROM public.study_plan_students AS s
INNER JOIN public.programmes AS p
  ON upper(trim(p.programme_code)) = upper(trim(s.programme_code))
WHERE spm.student_profile_id = s.id
  AND spm.plan_stage = 'programme'
  AND lower(trim(coalesce(p.programme_type, ''))) IN (
    'degree',
    'ug',
    'undergraduate'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.modules AS m
    WHERE upper(trim(m.programme_code)) = upper(trim(s.programme_code))
      AND upper(trim(coalesce(m.stream_code, 'nil'))) IN (
        upper(trim(coalesce(nullif(trim(s.programme_stream), ''), 'nil'))),
        'NIL'
      )
      AND (
        upper(trim(m.module_code)) = upper(trim(spm.module_code))
        OR upper(
          regexp_replace(trim(m.module_code), '(FEB|SEP|JUN)$', '', 'i')
        ) = upper(trim(spm.module_code))
      )
  );
