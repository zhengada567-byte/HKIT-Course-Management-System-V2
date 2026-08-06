-- Upgrade older programme_review_fees (without fee_type) to support
-- review / registration / annual_audit tabs.

alter table public.programme_review_fees
  add column if not exists fee_type text;

update public.programme_review_fees
set fee_type = 'review'
where fee_type is null or trim(fee_type) = '';

alter table public.programme_review_fees
  alter column fee_type set default 'review';

alter table public.programme_review_fees
  alter column fee_type set not null;

alter table public.programme_review_fees
  drop constraint if exists programme_review_fees_fee_type_check;

alter table public.programme_review_fees
  add constraint programme_review_fees_fee_type_check
  check (fee_type in ('review', 'registration', 'annual_audit', 'periodic'));

-- Drop legacy unique (academic_year, programme_code) if present.
alter table public.programme_review_fees
  drop constraint if exists programme_review_fees_academic_year_programme_code_key;

do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.programme_review_fees'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) like '%(academic_year, programme_code)%'
  limit 1;

  if cname is not null then
    execute format(
      'alter table public.programme_review_fees drop constraint %I',
      cname
    );
  end if;
end $$;

alter table public.programme_review_fees
  drop constraint if exists programme_review_fees_academic_year_programme_code_fee_type_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.programme_review_fees'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%fee_type%'
  ) then
    alter table public.programme_review_fees
      add constraint programme_review_fees_academic_year_programme_code_fee_type_key
      unique (academic_year, programme_code, fee_type);
  end if;
end $$;

create index if not exists programme_review_fees_year_type_idx
  on public.programme_review_fees (academic_year, fee_type);
