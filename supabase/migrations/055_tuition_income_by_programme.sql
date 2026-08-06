-- Tuition income: add programme_code (per programme + term).

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'tuition_income'
  ) then
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'tuition_income'
        and column_name = 'programme_code'
    ) then
      alter table public.tuition_income
        add column programme_code text;

      -- Existing rows (if any) need a placeholder before NOT NULL.
      update public.tuition_income
      set programme_code = 'UNKNOWN'
      where programme_code is null;

      alter table public.tuition_income
        alter column programme_code set not null;
    end if;

    -- Drop old unique (academic_year, module_term) if present.
    alter table public.tuition_income
      drop constraint if exists tuition_income_academic_year_module_term_key;

    -- Also drop unnamed unique via index name variants.
    drop index if exists tuition_income_academic_year_module_term_key;

    -- Ensure new unique key.
    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.tuition_income'::regclass
        and contype = 'u'
        and pg_get_constraintdef(oid) like '%academic_year%programme_code%module_term%'
    ) then
      alter table public.tuition_income
        add constraint tuition_income_year_programme_term_key
        unique (academic_year, programme_code, module_term);
    end if;

    create index if not exists tuition_income_year_idx
      on public.tuition_income (academic_year, programme_code);
  end if;
end $$;
