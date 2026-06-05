-- Normalize intake_level and module_year to Y1 / Y2 / Y3 style.

update public.study_plan_students
set intake_level = upper(
  case
    when intake_level ~* '^Y[0-9]+$' then intake_level
    when intake_level ~ '[0-9]+' then 'Y' || (regexp_match(intake_level, '([0-9]+)'))[1]
    else intake_level
  end
)
where intake_level is not null
  and trim(intake_level) <> ''
  and intake_level !~* '^Y[0-9]+$';

update public.modules
set module_year = upper(
  case
    when module_year ~* '^Y[0-9]+$' then module_year
    when module_year ~ '[0-9]+' then 'Y' || (regexp_match(module_year, '([0-9]+)'))[1]
    else module_year
  end
)
where module_year is not null
  and trim(module_year) <> ''
  and module_year !~* '^Y[0-9]+$';

update public.module_adjustments
set adjusted_module_year = upper(
  case
    when adjusted_module_year ~* '^Y[0-9]+$' then adjusted_module_year
    when adjusted_module_year ~ '[0-9]+' then 'Y' || (regexp_match(adjusted_module_year, '([0-9]+)'))[1]
    else adjusted_module_year
  end
)
where adjusted_module_year is not null
  and trim(adjusted_module_year) <> ''
  and adjusted_module_year !~* '^Y[0-9]+$';
