-- Remap timetable study_term to match academic-year calendar (2026/2027 -> T2026C, T2027A, T2027B).
-- Run after 007. Safe to re-run.

create or replace function public.study_term_for_academic_module(
  ay text,
  module_term text,
  current_study_term text default null
)
returns text
language plpgsql
immutable
as $$
declare
  canonical_ay text;
  start_year integer;
  offered text;
  letter text;
  term_year integer;
  existing text;
begin
  existing := upper(btrim(coalesce(current_study_term, '')));

  if existing ~ '^T\d{4}[ABC]$' then
    return existing;
  end if;

  if to_regprocedure('public.canonical_academic_year(text)') is not null then
    canonical_ay := public.canonical_academic_year(ay);
  else
    canonical_ay := btrim(ay);
  end if;

  start_year := split_part(canonical_ay, '/', 1)::integer;

  if start_year is null or start_year < 1900 then
    return coalesce(nullif(existing, ''), 'T2000A');
  end if;

  offered := upper(btrim(coalesce(module_term, '')));

  if offered in ('FEB', 'FEBRUARY', 'A') then
    letter := 'A';
  elsif offered in ('JUN', 'JUNE', 'B') then
    letter := 'B';
  elsif offered in ('SEP', 'SEPT', 'SEPTEMBER', 'C') then
    letter := 'C';
  else
    letter := 'A';
  end if;

  term_year := case when letter = 'C' then start_year else start_year + 1 end;

  return 'T' || term_year::text || letter;
end;
$$;

update public.timetable_student_numbers t
set study_term = public.study_term_for_academic_module(
  t.academic_year,
  t.module_term,
  t.study_term
)
where t.study_term is distinct from public.study_term_for_academic_module(
  t.academic_year,
  t.module_term,
  t.study_term
);
