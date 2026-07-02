-- One-time repair: align timetable_planning_modules with modules catalog.
-- Fixes stale module_term / name / year when the catalogue was corrected later.

update public.timetable_planning_modules tpm
set
  programme_code = m.programme_code,
  stream_code = case
    when nullif(trim(m.stream_code), '') is null then 'nil'
    else trim(m.stream_code)
  end,
  module_code = m.module_code,
  module_name = m.module_name,
  module_year = m.module_year,
  module_term = m.module_term,
  updated_at = now()
from public.modules m
where tpm.module_id = m.id
  and (
    tpm.programme_code is distinct from m.programme_code
    or tpm.stream_code is distinct from case
      when nullif(trim(m.stream_code), '') is null then 'nil'
      else trim(m.stream_code)
    end
    or tpm.module_code is distinct from m.module_code
    or tpm.module_name is distinct from m.module_name
    or tpm.module_year is distinct from m.module_year
    or tpm.module_term is distinct from m.module_term
  );
