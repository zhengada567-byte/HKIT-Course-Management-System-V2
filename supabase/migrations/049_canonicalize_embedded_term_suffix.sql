-- Normalize embedded offered-term suffixes in codes to SEP / FEB / JUN.
-- module_term columns remain Sep / Feb / Jun (title case).
-- Example: UWLCFI1Sep -> UWLCFI1SEP, BUS692Feb -> BUS692FEB.

create or replace function public.canonicalize_embedded_term_suffix(code text)
returns text
language sql
immutable
as $$
  select case
    when code is null or btrim(code) = '' then code
    when code ~* '(Sep|Feb|Jun)$'
      and right(code, 3) is distinct from upper(right(code, 3))
    then left(code, length(code) - 3) || upper(right(code, 3))
    else code
  end;
$$;

comment on function public.canonicalize_embedded_term_suffix(text) is
  'Normalize trailing Sep/Feb/Jun (any case) on module/class codes to SEP/FEB/JUN.';

-- modules: skip rows that would collide with an existing canonical code
update public.modules m
set
  module_code = public.canonicalize_embedded_term_suffix(m.module_code),
  updated_at = now()
where m.module_code is distinct from public.canonicalize_embedded_term_suffix(m.module_code)
  and not exists (
    select 1
    from public.modules o
    where o.id <> m.id
      and o.programme_code = m.programme_code
      and o.stream_code = m.stream_code
      and o.module_code = public.canonicalize_embedded_term_suffix(m.module_code)
  );

update public.timetable_planning_modules
set
  module_code = public.canonicalize_embedded_term_suffix(module_code),
  updated_at = now()
where module_code is distinct from public.canonicalize_embedded_term_suffix(module_code);

update public.timetable_modules
set
  module_instance_code = public.canonicalize_embedded_term_suffix(module_instance_code),
  base_module_code = public.canonicalize_embedded_term_suffix(base_module_code),
  updated_at = now()
where module_instance_code is distinct from public.canonicalize_embedded_term_suffix(module_instance_code)
   or base_module_code is distinct from public.canonicalize_embedded_term_suffix(base_module_code);

update public.timetable_module_instances
set
  module_instance_code = public.canonicalize_embedded_term_suffix(module_instance_code),
  module_code = public.canonicalize_embedded_term_suffix(module_code),
  updated_at = now()
where module_instance_code is distinct from public.canonicalize_embedded_term_suffix(module_instance_code)
   or module_code is distinct from public.canonicalize_embedded_term_suffix(module_code);

update public.timetable_sessions
set
  module_instance_code = public.canonicalize_embedded_term_suffix(module_instance_code),
  updated_at = now()
where module_instance_code is distinct from public.canonicalize_embedded_term_suffix(module_instance_code);

update public.module_default_assignments
set
  module_code = public.canonicalize_embedded_term_suffix(module_code),
  updated_at = now()
where module_code is distinct from public.canonicalize_embedded_term_suffix(module_code);

update public.module_enrollment
set
  module_code = public.canonicalize_embedded_term_suffix(module_code),
  updated_at = now()
where module_code is distinct from public.canonicalize_embedded_term_suffix(module_code);

update public.timetable_student_numbers
set
  module_code = public.canonicalize_embedded_term_suffix(module_code),
  updated_at = now()
where module_code is distinct from public.canonicalize_embedded_term_suffix(module_code);

update public.combine_groups
set
  combined_code = public.canonicalize_embedded_term_suffix(combined_code),
  updated_at = now()
where combined_code is distinct from public.canonicalize_embedded_term_suffix(combined_code);

update public.study_plan_modules
set
  module_code = public.canonicalize_embedded_term_suffix(module_code),
  enrolled_module_instance_code =
    public.canonicalize_embedded_term_suffix(enrolled_module_instance_code),
  updated_at = now()
where module_code is distinct from public.canonicalize_embedded_term_suffix(module_code)
   or enrolled_module_instance_code
        is distinct from public.canonicalize_embedded_term_suffix(enrolled_module_instance_code);

update public.study_plan_enrollment_rules
set
  module_code = public.canonicalize_embedded_term_suffix(module_code),
  updated_at = now()
where module_code is distinct from public.canonicalize_embedded_term_suffix(module_code);

do $$
begin
  if to_regclass('public.bridging_module_offerings') is not null then
    update public.bridging_module_offerings
    set
      parent_module_code = public.canonicalize_embedded_term_suffix(parent_module_code),
      bridging_module_code = public.canonicalize_embedded_term_suffix(bridging_module_code),
      updated_at = now()
    where parent_module_code
            is distinct from public.canonicalize_embedded_term_suffix(parent_module_code)
       or bridging_module_code
            is distinct from public.canonicalize_embedded_term_suffix(bridging_module_code);
  end if;
end $$;
