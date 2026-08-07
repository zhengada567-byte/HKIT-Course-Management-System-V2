-- Review fee: optional validity period (from month/year to month/year), manual entry.

alter table public.programme_review_fees
  add column if not exists validity_from_month smallint;

alter table public.programme_review_fees
  add column if not exists validity_from_year integer;

alter table public.programme_review_fees
  add column if not exists validity_to_month smallint;

alter table public.programme_review_fees
  add column if not exists validity_to_year integer;

alter table public.programme_review_fees
  drop constraint if exists programme_review_fees_validity_from_month_check;

alter table public.programme_review_fees
  add constraint programme_review_fees_validity_from_month_check
  check (
    validity_from_month is null
    or (validity_from_month >= 1 and validity_from_month <= 12)
  );

alter table public.programme_review_fees
  drop constraint if exists programme_review_fees_validity_to_month_check;

alter table public.programme_review_fees
  add constraint programme_review_fees_validity_to_month_check
  check (
    validity_to_month is null
    or (validity_to_month >= 1 and validity_to_month <= 12)
  );
