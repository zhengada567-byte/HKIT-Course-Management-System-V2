-- Add periodic fee type; annual audit label remains annual_audit (AR to NCR).

alter table public.programme_review_fees
  drop constraint if exists programme_review_fees_fee_type_check;

alter table public.programme_review_fees
  add constraint programme_review_fees_fee_type_check
  check (
    fee_type in (
      'review',
      'registration',
      'annual_audit',
      'periodic'
    )
  );
